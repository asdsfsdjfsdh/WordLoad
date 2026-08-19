// 出题服务：读词书阶段词池 → 按关卡固定词集 → 义项轮换 → 易混补抽 → 生成 Question 列表
import { Injectable, NotFoundException } from '@nestjs/common';
import type { DifficultyTier, GameMode, LevelWord, Question, Session } from '@word-journey/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocSessionMix, buildFoilPool, buildQuestion, hintLevelFor, rotateSense } from './question-builder';
import { appendStageHistory } from '../sessions/settlement';

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
    mnemonic: string | null;
    senses: { idx: number; meaning: string; example: string }[];
    confusableA: { wordB: { text: string }; type: string }[];
    confusableB: { wordA: { text: string }; type: string }[];
  };
}

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  // 标记单词为已掌握（一键斩）：设为 mastery 100、skipped=true，以后不再常规出题；
  // 但保留 180 天长尾抽测（记忆学：主观"会了"≠长期记忆，防止斩后永久遗忘）。
  async skipWord(userId: number, wordId: string): Promise<void> {
    const now = new Date();
    const longTailAt = new Date(now.getTime() + 180 * 86400000);
    const cur = await this.prisma.userWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });
    await this.prisma.userWordProgress.upsert({
      where: { userId_wordId: { userId, wordId } },
      create: {
        userId, wordId,
        mastery: 100, reviewStage: 6,
        correctCount: 1, inVocabBook: true,
        skipped: true, inWrongBook: false, wrongStreak: 0,
        nextReviewAt: longTailAt,
        firstEncounteredAt: now, lastEncounteredAt: now,
        srsHistory: [{ stage: 6, at: now.toISOString() }],
        masteredAt: now,
      },
      update: {
        mastery: 100, reviewStage: 6,
        skipped: true, inWrongBook: false, wrongStreak: 0,
        nextReviewAt: longTailAt,
        lastEncounteredAt: now,
        srsHistory: appendStageHistory(cur?.srsHistory, cur?.reviewStage ?? 0, 6, now),
        masteredAt: cur?.masteredAt ?? now,
      },
    });
    // 生存 Run 预览斩词：该词在 active Run 的待答题一并标为已答（正确），本波不再出战
    await this.prisma.runItem.updateMany({
      where: {
        wordId,
        answered: false,
        run: { userId, status: 'active' },
      },
      data: { answered: true, correct: true },
    });
  }

  // 反斩：完全重置回未学状态（mastery 0 / reviewStage 0 / skipped false，重新纳入出题）
  async unskipWord(userId: number, wordId: string): Promise<void> {
    const now = new Date();
    await this.prisma.userWordProgress.upsert({
      where: { userId_wordId: { userId, wordId } },
      create: {
        userId, wordId,
        mastery: 0, reviewStage: 0, ease: 2.5,
        skipped: false, inWrongBook: false, wrongStreak: 0,
        inVocabBook: false,
        firstEncounteredAt: now, lastEncounteredAt: now,
        srsHistory: [],
        masteredAt: null,
      },
      update: {
        mastery: 0, reviewStage: 0, ease: 2.5,
        skipped: false, inWrongBook: false, wrongStreak: 0,
        inVocabBook: false,
        nextReviewAt: null,
        lastEncounteredAt: now,
        srsHistory: [],
        masteredAt: null,
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
      if (p?.skipped) return 'new'; // 已斩词排除出题，但归类兜底为 new（不进入任何池）
      if (p?.inWrongBook) return 'wrongbook';
      if (p && p.reviewStage > 0) return 'review';
      return 'new';
    };

    // 已斩词从候选池整体剔除（不参与抽词/易混/foilPool）
    const activePool = pool.filter((bw) => !progressByWord.get(bw.wordId)?.skipped);

    // 如果提供了 wordIds，优先使用指定词（确保战斗单词和预习一致）
    let chosen: PoolWord[];
    if (opts.wordIds && opts.wordIds.length > 0) {
      const wordIdSet = new Set(opts.wordIds);
      chosen = activePool.filter((bw) => wordIdSet.has(bw.wordId));
      if (chosen.length < sessionSize) {
        const chosenIdSet = new Set(chosen.map((c) => c.wordId));
        const fill = activePool.filter((bw) => !chosenIdSet.has(bw.wordId));
        chosen = [...chosen, ...fill.slice(0, sessionSize - chosen.length)];
      }
    } else {
      // 按 7:2:1 比例抽词：新词 70% / 复习 20% / 错题 10%（allocSessionMix 纯函数，缺额新词补足）
      //
      // 复习到期纪律（与复习战 createReviewSession 的"错题本→到期→毕业词兜底"同口径）：
      // - dueReviewPool：已到期（nextReviewAt ≤ now），严格最优先占 20% 复习位
      // - futureReviewPool：未到期复习词（reviewStage > 0），仅在新词+到期复习不足时兜底占位
      // - 已掌握词（mastery ≥ 100 未斩）也在 review 池尾部，nextReviewAt 长间隔 → 最后兜底，与"毕业词长间隔重考"一致
      // allocSessionMix 按数组顺序取头（due 在前），缺口先新词、再未到期复习，保证到期词永不被未到期词挤占
      const now = Date.now();
      const isDueReview = (bw: PoolWord): boolean => {
        const p = progressByWord.get(bw.wordId);
        return !!p?.nextReviewAt && p.nextReviewAt.getTime() <= now;
      };
      const byNextReview = (a: PoolWord, b: PoolWord): number => {
        const pa = progressByWord.get(a.wordId)?.nextReviewAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const pb = progressByWord.get(b.wordId)?.nextReviewAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      };

      const newPool = [...activePool.filter((bw) => classify(bw) === 'new')].sort(() => Math.random() - 0.5);
      const dueReviewPool = activePool.filter((bw) => classify(bw) === 'review' && isDueReview(bw)).sort(byNextReview);
      const futureReviewPool = activePool.filter((bw) => classify(bw) === 'review' && !isDueReview(bw)).sort(byNextReview);
      const wrongPool = [...activePool.filter((bw) => classify(bw) === 'wrongbook')].sort(() => Math.random() - 0.5);

      chosen = allocSessionMix({
        fresh: newPool,
        review: [...dueReviewPool, ...futureReviewPool],
        wrongbook: wrongPool,
        size: sessionSize,
      });
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
        source: sourceOf.get(w.id),
        hintLevel:
          sourceOf.get(w.id) === 'new'
            ? 0
            : hintLevelFor(progressByWord.get(w.id)?.mastery, progressByWord.get(w.id)?.reviewStage),
        confusable: pairIndex.get(w.text),
        mnemonic: w.mnemonic ?? undefined,
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
        // 选中文模式：一次性下发候选池（首义项 + 易混词形），前端据此生成 4 选项，服务端不再逐题出选项
        // 与已选词构成易混关系的优先保留，其余随机，总量截断到 80 项控制传输体积
        foilPool:
          mode === 'choice'
            ? (() => {
                const chosenTexts = new Set(chosen.map((c) => c.word.text));
                const entries = pool.map((bw) => ({
                  text: bw.word.text,
                  meaning: bw.word.senses[0]?.meaning ?? bw.word.text,
                  meanings: bw.word.senses.map((s) => s.meaning),
                  confusableTexts: [
                    ...bw.word.confusableA.map((p) => p.wordB.text),
                    ...bw.word.confusableB.map((p) => p.wordA.text),
                  ],
                }));
                entries.sort((a, b) => {
                  const priA = a.confusableTexts.some((t) => chosenTexts.has(t)) ? 0 : 1;
                  const priB = b.confusableTexts.some((t) => chosenTexts.has(t)) ? 0 : 1;
                  return priA - priB || Math.random() - 0.5;
                });
                return buildFoilPool(entries.slice(0, 80));
              })()
            : undefined,
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
      word: { id: string; text: string; phoneticAm: string | null; phoneticEn: string | null; tier: string; mnemonic: string | null; senses: { meaning: string; example: string }[] };
    }[];
    if (pool.length === 0) throw new NotFoundException(`阶段 ${stageId} 无词池`);

    // 查询用户进度以确定每个词的状态和排序优先级
    let progressByWord = new Map<string, { reviewStage: number; inWrongBook: boolean; mastery: number; nextReviewAt: Date | null; skipped: boolean }>();
    if (userId) {
      const progress = await this.prisma.userWordProgress.findMany({
        where: { userId, wordId: { in: pool.map((p) => p.wordId) } },
      });
      progressByWord = new Map(progress.map((p) => [p.wordId, p]));
    }

    const statusOf = (wordId: string): LevelWord['status'] => {
      const p = progressByWord.get(wordId);
      if (!p) return 'new';
      if (p.skipped) return 'mastered'; // 已斩词永久不再出题，预览按已掌握处理（不重复学习）
      if (p.mastery >= 100) return 'mastered';
      if (p.inWrongBook) return 'wrongbook';
      if (p.reviewStage > 0) return 'review';
      return 'new';
    };

    // 到期复习词：nextReviewAt ≤ now 且未掌握、非错题本、非已斩
    const now = new Date();
    const dueReviewPool = pool.filter((bw) => {
      const p = progressByWord.get(bw.wordId);
      if (!p) return false;
      if (p.skipped) return false;
      if (p.mastery >= 100) return false;
      if (p.inWrongBook) return false;
      return p.nextReviewAt != null && p.nextReviewAt.getTime() <= now.getTime();
    });
    // 最久未复习的优先
    dueReviewPool.sort((a, b) => {
      const da = progressByWord.get(a.wordId)?.nextReviewAt?.getTime() ?? 0;
      const db = progressByWord.get(b.wordId)?.nextReviewAt?.getTime() ?? 0;
      return da - db;
    });
    const reviewReserve = Math.min(dueReviewPool.length, Math.ceil(size * 0.25));
    const reservedIds = new Set(dueReviewPool.slice(0, reviewReserve).map((bw) => bw.wordId));

    // 其余词按 new/wrongbook 优先 → 复习次之 → 已掌握最后，同类内随机
    const remaining = pool.filter((bw) => !reservedIds.has(bw.wordId));
    remaining.sort((a, b) => {
      const priority = { new: 0, wrongbook: 0, review: 1, mastered: 2 } as const;
      const pa = priority[statusOf(a.wordId)];
      const pb = priority[statusOf(b.wordId)];
      return pa - pb || Math.random() - 0.5;
    });

    const selected = [
      ...dueReviewPool.slice(0, reviewReserve),
      ...remaining.slice(0, size - reviewReserve),
    ];

    return selected.map((bw) => ({
      wordId: bw.word.id,
      text: bw.word.text,
      phonetic: bw.word.phoneticAm ?? bw.word.phoneticEn ?? undefined,
      tier: bw.word.tier,
      status: statusOf(bw.wordId),
      meanings: bw.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
      mnemonic: bw.word.mnemonic ?? undefined,
    }));
  }

  // 获取一个替换词（斩之后补词用）：优先未掌握词，其次任意未排除词（难度升序确定性取）
  async getReplacementWord(
    bankCode: string,
    stageId: number,
    excludeIds: string[],
    userId?: number,
  ): Promise<LevelWord | null> {
    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException('词书不存在');

    const include = {
      word: { include: { senses: { orderBy: { idx: 'asc' } } } },
    } satisfies Prisma.BankWordInclude;
    // 确定性排序：难度升序（易→难），同级按词 id，避免 findFirst 任意取行
    const orderBy = [
      { word: { difficultyScore: 'asc' } },
      { wordId: 'asc' },
    ] satisfies Prisma.BankWordOrderByWithRelationInput[];

    // 已掌握词不再补入预习；若阶段池全为已掌握则回退到任意未排除词
    const row = userId
      ? ((await this.prisma.bankWord.findFirst({
          where: {
            bankId: bank.id,
            stage: stageId,
            wordId: { notIn: excludeIds },
            NOT: { word: { progress: { some: { userId, mastery: { gte: 100 } } } } },
          },
          include,
          orderBy,
        })) ??
        (await this.prisma.bankWord.findFirst({
          where: { bankId: bank.id, stage: stageId, wordId: { notIn: excludeIds } },
          include,
          orderBy,
        })))
      : await this.prisma.bankWord.findFirst({
          where: { bankId: bank.id, stage: stageId, wordId: { notIn: excludeIds } },
          include,
          orderBy,
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
      mnemonic: row.word.mnemonic ?? undefined,
    };
  }
}

// 关卡数：按每关固定词量向上取整
export function levelCountOf(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / LEVEL_SIZE));
}
