// 出题服务：读词书阶段词池 → 按比例抽词 → 义项轮换 → 易混补抽 → 生成 Question 列表
import { Injectable, NotFoundException } from '@nestjs/common';
import type { DifficultyTier, GameMode, Question, Session } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { allocMix, buildQuestion, rotateSense } from './question-builder';

const SESSION_SIZE = 30;

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

  // 生成一次战斗会话的完整题目（不落库，落库归结算模块）
  async buildSession(opts: {
    userId: number;
    bankCode: string;
    stageId: number;
    mode: GameMode;
  }): Promise<SessionPlan> {
    const { userId, bankCode, stageId, mode } = opts;

    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const pool = (await this.prisma.bankWord.findMany({
      where: { bankId: bank.id, stage: stageId },
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

    // 词级进度 → 划分新词 / 复习 / 错题本
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));

    const fresh: typeof pool = [];
    const review: typeof pool = [];
    const wrongbook: typeof pool = [];
    for (const bw of pool) {
      const p = progressByWord.get(bw.wordId);
      if (p?.inWrongBook) wrongbook.push(bw);
      else if (p && p.reviewStage > 0) review.push(bw);
      else fresh.push(bw);
    }

    // SRS 掺入：复习池按到期优先（nextReviewAt 越早越优先，未到期最后）
    const dueFirst = (bw: (typeof pool)[number]): number => {
      const p = progressByWord.get(bw.wordId);
      if (!p?.nextReviewAt) return 0;
      return p.nextReviewAt.getTime() - Date.now();
    };
    review.sort((a, b) => dueFirst(a) - dueFirst(b));

    // 空白池兜底：错题本空则补新词
    const mix = allocMix(SESSION_SIZE);
    let { new: n, review: r, wrongbook: wb } = mix;
    if (wrongbook.length === 0) {
      wb = 0;
      n += mix.wrongbook;
    }
    if (review.length === 0) {
      r = 0;
      n += mix.review;
    }

    const pick = <T>(arr: T[], k: number): T[] => {
      const c = [...arr];
      shuffle(c);
      return c.slice(0, k);
    };

    // 复习池：优先取已到期（nextReviewAt <= now）的词，不足则取最早
    const pickReview = (k: number): PoolWord[] => {
      if (k <= 0) return [];
      const now = Date.now();
      const overdue = review.filter((bw) => {
        const p = progressByWord.get(bw.wordId);
        return p?.nextReviewAt && p.nextReviewAt.getTime() <= now;
      });
      const source = overdue.length >= k ? overdue : review;
      return pick(source, k);
    };

    const chosen: typeof pool = [
      ...pick(wrongbook, wb),
      ...pickReview(r),
      ...pick(fresh, n),
    ];
    shuffle(chosen);

    // 记录每题来源（结算时写 item.type）
    const sourceOf = new Map<string, 'new' | 'review' | 'wrongbook'>(
      [...fresh, ...review, ...wrongbook].map((bw) => [
        bw.wordId,
        fresh.includes(bw)
          ? 'new'
          : review.includes(bw)
            ? 'review'
            : 'wrongbook',
      ]),
    );

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
      const confusable = pairIndex.get(w.text);
      const promptBase =
        mode === 'dictation' ? (w.phoneticAm ?? w.phoneticEn ?? '') : (sense?.meaning ?? w.text);
      return buildQuestion({
        seq,
        wordId: w.id,
        senseIdx,
        text: w.text,
        promptBase,
        example: sense?.example,
        tier: w.tier as DifficultyTier,
        mode,
        confusable,
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
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
}