// 出题服务：读词书阶段词池 → 按比例抽词 → 义项轮换 → 易混补抽 → 生成 Question 列表
import { Injectable } from '@nestjs/common';
import type { DifficultyTier, GameMode, Question, Session } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { allocMix, buildQuestion } from './question-builder';

const SESSION_SIZE = 30;

// 出题结果：会话 + 每题来源标记（结算落库用）
export interface SessionPlan {
  session: Session;
  items: { seq: number; wordId: string; senseIdx: number; source: 'new' | 'review' | 'wrongbook' }[];
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
    if (!bank) throw new Error(`词书不存在: ${bankCode}`);

    const pool = await this.prisma.bankWord.findMany({
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
    });
    if (pool.length === 0) throw new Error(`阶段 ${stageId} 无词池`);

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

    const chosen = [...pick(wrongbook, wb), ...pick(review, r), ...pick(fresh, n)];
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

    const questions: Question[] = chosen.map((bw, seq) => {
      const w = bw.word;
      const senses = w.senses;
      // 义项轮换：暂取义项 0；鉴权接入后按 user_sense_progress 的 reviewStage/lastTestedAt 轮换
      const senseIdx = 0;
      const sense = senses[0];
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
      senseIdx: 0,
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