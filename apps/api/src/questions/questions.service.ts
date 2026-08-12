// 出题服务：读词书阶段词池 → 按关卡固定词集 → 义项轮换 → 易混补抽 → 生成 Question 列表
import { Injectable, NotFoundException } from '@nestjs/common';
import type { DifficultyTier, GameMode, LevelWord, Question, Session } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildQuestion, rotateSense } from './question-builder';

// 默认会题数：一关固定词集 + 复习/错题补抽
const DEFAULT_SESSION_SIZE = 30;
// 每关固定词量：关卡系统保证全词覆盖（一关 = 固定词集的一次战斗）
export const LEVEL_SIZE = 20;

// 出题结果：会话 + 每题来源标记（结算落库用）
export interface SessionPlan {
  session: Session;
  items: { seq: number; wordId: string; senseIdx: number; source: 'new' | 'review' | 'wrongbook' }[];
}

// 词池元素：BankWord + 完整 Word（含义项与易混对）
interface PoolWord {
  bankId: number;
  wordId: string;
  stage: number;
  word: {
    id: string;
    text: string;
    phoneticAm: string | null;
    phoneticEn: string | null;
    tier: string;
    senses: { idx: number; meaning: string; example: string }[];
    confusableA: { wordB: { text: string }; type: string }[];
    confusableB: { wordA: { text: string }; type: string }[];
  };
}

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  // 标记单词为已掌握（一键斩）：设为 mastery 100，不再出题
  async skipWord(userId: number, wordId: string): Promise<void> {
    const now = new Date();
    await this.prisma.userWordProgress.upsert({
      where: { userId_wordId: { userId, wordId } },
      create: {
        userId, wordId,
        mastery: 100, reviewStage: 6,
        correctCount: 1, inVocabBook: true,
        firstEncounteredAt: now, lastEncounteredAt: now,
      },
      update: {
        mastery: 100, reviewStage: 6,
        lastEncounteredAt: now,
      },
    });
  }

  // 生成一次战斗会话的完整题目（从阶段词池动态抽词：未学优先 + 到期复习 + 错题本补齐）
  async buildSession(opts: {
    userId: number;
    bankCode: string;
    stageId: number;
    mode: GameMode;
    size?: number;
    wordIds?: string[];
  }): Promise<SessionPlan> {
    const { userId, bankCode, stageId, mode } = opts;
    const sessionSize = Math.min(60, Math.max(10, opts.size ?? 20));

    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    // 阶段词池：按难度升序（易→难）保证关卡分区确定、进度由易到难
    const pool = (await this.prisma.bankWord.findMany({
      where: { bankId: bank.id, stage: stageId },
      orderBy: [{ word: { difficultyScore: 'asc' } }, { wordId: 'asc' }],
      include: {
        word: {
          include: {
            senses: { orderBy: { idx: 'asc' } },
            confusableA: { include: { wordB: true } },
            confusableB: { include: { wordA: true } },
          },
        },
      },
    })) as PoolWord[];
    if (pool.length === 0) throw new NotFoundException(`阶段 ${stageId} 无词池`);

    // 词级进度 → 划分未学 / 复习 / 错题本（仅加载本阶段词池相关进度）
    const poolWordIds = pool.map((w) => w.wordId);
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: poolWordIds } },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));

    // 分类函数（if/else 分支共用）
    const classify = (bw: PoolWord): 'new' | 'review' | 'wrongbook' => {
      const p = progressByWord.get(bw.wordId);
      if (p?.inWrongBook) return 'wrongbook';
      if (p && p.reviewStage > 0) return 'review';
      return 'new';
    };

    // 如果提供了 wordIds，优先使用指定词（确保战斗单词和预习一致）
    let chosen: PoolWord[];
    if (opts.wordIds && opts.wordIds.length > 0) {
      const wordIdSet = new Set(opts.wordIds);
      chosen = pool.filter((bw) => wordIdSet.has(bw.wordId));
      if (chosen.length < sessionSize) {
        const chosenIdSet = new Set(chosen.map((c) => c.wordId));
        const fill = pool.filter((bw) => !chosenIdSet.has(bw.wordId));
        chosen = [...chosen, ...fill.slice(0, sessionSize - chosen.length)];
      }
    } else {
      // 按 7:2:1 比例抽词：新词 70% / 复习 20% / 错题 10%
      const dueFirst = (bw: PoolWord): number => {
        const p = progressByWord.get(bw.wordId);
        if (!p?.nextReviewAt) return 0;
        return p.nextReviewAt.getTime() - Date.now();
      };

      const newPool = [...pool.filter((bw) => classify(bw) === 'new')].sort(() => Math.random() - 0.5);
      const reviewPool = pool.filter((bw) => classify(bw) === 'review').sort((a, b) => dueFirst(a) - dueFirst(b));
      const wrongPool = [...pool.filter((bw) => classify(bw) === 'wrongbook')].sort(() => Math.random() - 0.5);

      const wantNew = Math.round(sessionSize * 0.7);
      const wantReview = Math.round(sessionSize * 0.2);
      let wantWrong = sessionSize - wantNew - wantReview;

      const takeNew = Math.min(wantNew, newPool.length);
      const takeReview = Math.min(wantReview, reviewPool.length);
      let takeWrong = Math.min(wantWrong, wrongPool.length);

      // 某类不够时，缺口由新词补足（其次复习）
      let deficit = (wantNew - takeNew) + (wantReview - takeReview) + (wantWrong - takeWrong);
      const extraNew = Math.min(deficit, newPool.length - takeNew);
      deficit -= extraNew;
      const extraReview = Math.min(deficit, reviewPool.length - takeReview);
      deficit -= extraReview;
      takeWrong += deficit; // 最后缺口由错题兜底

      chosen = [
        ...newPool.slice(0, takeNew + extraNew),
        ...reviewPool.slice(0, takeReview + extraReview),
        ...wrongPool.slice(0, takeWrong),
      ];
    }

    // 记录每题来源（结算时写 item.type）
    const sourceOf = new Map(chosen.map((bw) => [bw.wordId, classify(bw)]));

    // 词对索引：同关内互为易混补抽候选
    const pairIndex = new Map<string, { counterpart: string; note: string }>();
    for (const bw of pool) {
      for (const p of bw.word.confusableA) {
        pairIndex.set(bw.word.text, {
          counterpart: p.wordB.text,
          note: p.type === 'homophone' ? '音近' : '形近',
        });
      }
      for (const p of bw.word.confusableB) {
        pairIndex.set(bw.word.text, {
          counterpart: p.wordA.text,
          note: p.type === 'homophone' ? '音近' : '形近',
        });
      }
    }

    // 易混对比：会话内互为易混的词尽量相邻排布（利于形成对比记忆）
    {
      const set = new Set(chosen.map((c) => c.word.text));
      const visited = new Set<string>();
      const reordered: PoolWord[] = [];
      for (const bw of chosen) {
        if (visited.has(bw.word.text)) continue;
        visited.add(bw.word.text);
        reordered.push(bw);
        // 若搭档也在本关且未排入，立即紧邻其后
        const pair = pairIndex.get(bw.word.text);
        if (pair && set.has(pair.counterpart) && !visited.has(pair.counterpart)) {
          const mate = chosen.find((c) => c.word.text === pair.counterpart);
          if (mate) {
            visited.add(pair.counterpart);
            reordered.push(mate);
          }
        }
      }
      chosen.splice(0, chosen.length, ...reordered);
    }

    // 义项级进度 → 义项轮换（多义词均匀覆盖各义项）
    const senseProgress = await this.prisma.userSenseProgress.findMany({
      where: { userId, wordId: { in: chosen.map((c) => c.word.id) } },
    });
    const senseProgressByWord = new Map<string, typeof senseProgress>();
    for (const sp of senseProgress) {
      const list = senseProgressByWord.get(sp.wordId) ?? [];
      list.push(sp);
      senseProgressByWord.set(sp.wordId, list);
    }

    const senseIdxOf = (wordId: string, senseCount: number): number => {
      if (senseCount <= 1) return 0;
      const sps = senseProgressByWord.get(wordId) ?? [];
      // 未测义项最优先；已测的按 reviewStage 低优先，同级按 lastTestedAt（越久未考越优先）
      const states = Array.from({ length: senseCount }, (_, idx) => {
        const sp = sps.find((x) => x.senseIdx === idx);
        return {
          idx,
          reviewStage: sp?.reviewStage ?? 0,
          lastTestedAt: sp ? (sp.lastTestedAt?.getTime() ?? 0) : Number.MIN_SAFE_INTEGER,
        };
      });
      return rotateSense(states);
    };

    // 每题确定的义项（义项轮换）
    const senseIdxOfQuestion = chosen.map(
      (bw) => senseIdxOf(bw.word.id, bw.word.senses.length) as number,
    );

    const questions: Question[] = chosen.map((bw, seq) => {
      const w = bw.word;
      const senses = w.senses;
      const senseIdx = senseIdxOfQuestion[seq] ?? 0;
      const sense = senses[senseIdx] ?? senses[0];
      const promptBase =
        mode === 'dictation' ? (w.phoneticAm ?? w.phoneticEn ?? '') : (sense?.meaning ?? w.text);
      return buildQuestion({
        seq,
        wordId: w.id,
        senseIdx,
        text: w.text,
        promptBase,
        example: sense?.example,
        phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
        tier: w.tier as DifficultyTier,
        mode,
      });
    });

    const items = chosen.map((bw, seq) => ({
      seq,
      wordId: bw.word.id,
      senseIdx: senseIdxOfQuestion[seq] ?? 0,
      source: sourceOf.get(bw.word.id) ?? ('new' as const),
    }));

    return {
      session: {
        sessionId: `${bankCode}-${stageId}-${Date.now()}`,
        bankId: String(bank.id),
        stageId,
        mode,
        questions,
      },
      items,
    };
  }

  // 阶段词池预览：战斗前的学习页数据（未学词优先，含学习状态）
  async listStageWords(opts: {
    bankCode: string;
    stageId: number;
    size?: number;
    userId?: number;
  }): Promise<LevelWord[]> {
    const { bankCode, stageId, size = 30, userId } = opts;
    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const pool = (await this.prisma.bankWord.findMany({
      where: { bankId: bank.id, stage: stageId },
      include: {
        word: {
          include: {
            senses: { orderBy: { idx: 'asc' } },
          },
        },
      },
    })) as {
      wordId: string;
      word: { id: string; text: string; phoneticAm: string | null; phoneticEn: string | null; tier: string; senses: { meaning: string; example: string }[] };
    }[];
    if (pool.length === 0) throw new NotFoundException(`阶段 ${stageId} 无词池`);

    // 查询用户进度以确定每个词的状态和排序优先级
    let progressByWord = new Map<string, { reviewStage: number; inWrongBook: boolean; mastery: number; nextReviewAt: Date | null }>();
    if (userId) {
      const progress = await this.prisma.userWordProgress.findMany({
        where: { userId, wordId: { in: pool.map((p) => p.wordId) } },
      });
      progressByWord = new Map(progress.map((p) => [p.wordId, p]));
    }

    const statusOf = (wordId: string): LevelWord['status'] => {
      const p = progressByWord.get(wordId);
      if (!p) return 'new';
      if (p.mastery >= 100) return 'mastered';
      if (p.inWrongBook) return 'wrongbook';
      if (p.reviewStage > 0) return 'review';
      return 'new';
    };

    // 排序：未学/错题优先 → 复习次之 → 已掌握最后，同类内随机
    const sorted = [...pool].sort((a, b) => {
      const priority = { new: 0, wrongbook: 0, review: 1, mastered: 2 } as const;
      const pa = priority[statusOf(a.wordId)];
      const pb = priority[statusOf(b.wordId)];
      return pa - pb || Math.random() - 0.5;
    });

    return sorted.slice(0, size).map((bw) => ({
      wordId: bw.word.id,
      text: bw.word.text,
      phonetic: bw.word.phoneticAm ?? bw.word.phoneticEn ?? undefined,
      tier: bw.word.tier,
      status: statusOf(bw.wordId),
      meanings: bw.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
    }));
  }

  // 获取一个替换词（斩之后补词用）
  async getReplacementWord(
    bankCode: string,
    stageId: number,
    excludeIds: string[],
    userId?: number,
  ): Promise<LevelWord | null> {
    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException('词书不存在');

    const row = await this.prisma.bankWord.findFirst({
      where: { bankId: bank.id, stage: stageId, wordId: { notIn: excludeIds } },
      include: { word: { include: { senses: { orderBy: { idx: 'asc' } } } } },
    });
    if (!row) return null;

    let status: LevelWord['status'] = 'new';
    if (userId) {
      const p = await this.prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId: row.wordId } },
        select: { reviewStage: true, inWrongBook: true, mastery: true },
      });
      if (p) {
        if (p.mastery >= 100) status = 'mastered';
        else if (p.inWrongBook) status = 'wrongbook';
        else if (p.reviewStage > 0) status = 'review';
      }
    }
    return {
      wordId: row.word.id,
      text: row.word.text,
      phonetic: row.word.phoneticAm ?? row.word.phoneticEn ?? undefined,
      tier: row.word.tier,
      status,
      meanings: row.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
    };
  }
}

// 关卡数：按每关固定词量向上取整
export function levelCountOf(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / LEVEL_SIZE));
}
