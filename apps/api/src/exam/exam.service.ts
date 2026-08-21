// 红宝书 Unit 试卷模式服务：出卷（看中填英，标注词性但不标注音标）→ 服务端批改 → 计入统计
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ExamAnswerInput,
  ExamGradedQuestion,
  ExamPaper,
  ExamQuestion,
  ExamSubmitResult,
  Rating,
} from '@word-journey/shared';
import {
  effectiveIntervalDays,
  initialEaseForTier,
  intervalDays,
} from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  appendStageHistory,
  applyWrongbookState,
  computeCoins,
  computeRating,
  isAnswerCorrect,
  levelFromExp,
  masteryFromStage,
  ratingExp,
  srsSchedule,
  type WrongbookState,
} from '../sessions/settlement';
import { levelOf } from '../banks/banks.service';

// 词性前缀 → 独立标签：从释义开头剥离 n. / adj. / vt. & vi. 等，返回 { pos, rest }
// 例："adj. 用尽的" → {pos:"adj.", rest:"用尽的"}；"vt. & vi. 开始" → {pos:"vt. & vi.", rest:"开始"}
export function splitPos(meaning: string): { pos?: string; rest: string } {
  const m = meaning.match(/^((?:(?:[a-z]+\.)\s*(?:&\s*)?)+)\s*(.*)$/is);
  if (!m || !m[1]) return { rest: meaning.trim() };
  return { pos: m[1].trim(), rest: (m[2] ?? '').trim() };
}

// 归一化编辑距离（拼写接近检测：typo vs 不认识）
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

interface ExamWord {
  id: string;
  text: string;
  phoneticAm: string | null;
  phoneticEn: string | null;
  tier: string;
  senses: { idx: number; meaning: string; example: string }[];
}

@Injectable()
export class ExamService {
  constructor(private readonly prisma: PrismaService) {}

  // 出卷：该 Unit 全部单词（看中填英，标注词性，不标注音标；英文答案与音标不随卷下发育）
  async buildPaper(
    userId: number,
    opts: { bankCode: string; stageId: number },
  ): Promise<ExamPaper> {
    const { bankCode, stageId } = opts;
    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const rows = (await this.prisma.bankWord.findMany({
      where: { bankId: bank.id, stage: stageId },
      orderBy: [{ word: { difficultyScore: 'asc' } }, { wordId: 'asc' }],
      include: { word: { include: { senses: { orderBy: { idx: 'asc' } } } } },
    })) as { wordId: string; word: ExamWord }[];
    if (rows.length === 0) throw new NotFoundException(`Unit ${stageId} 无词可考`);

    const questions: ExamQuestion[] = rows.map((r, seq) => {
      const primary = r.word.senses[0];
      const { pos, rest } = splitPos(primary?.meaning ?? r.word.text);
      return { seq, wordId: r.word.id, pos, meaning: rest || r.word.text };
    });

    const paperId = `exam-${bankCode}-${stageId}-${Date.now()}`;
    return {
      paperId,
      bankCode,
      stageId,
      total: questions.length,
      title: `Unit ${levelOf(stageId)} 试卷`,
      questions,
    };
  }

  // 批改 + 计入统计
  async submit(
    userId: number,
    opts: {
      bankCode: string;
      stageId: number;
      paperId: string;
      answers: ExamAnswerInput[];
    },
  ): Promise<ExamSubmitResult> {
    const { bankCode, stageId, answers } = opts;
    const bank = await this.prisma.wordBank.findUnique({ where: { code: bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const rows = (await this.prisma.bankWord.findMany({
      where: { bankId: bank.id, stage: stageId },
      orderBy: [{ word: { difficultyScore: 'asc' } }, { wordId: 'asc' }],
      include: { word: { include: { senses: { orderBy: { idx: 'asc' } } } } },
    })) as { wordId: string; word: ExamWord }[];
    if (rows.length === 0) throw new NotFoundException(`Unit ${stageId} 无词可考`);

    const answerBySeq = new Map(answers.map((a) => [a.seq, a]));

    // 逐题批改：服务端用 typed 与标准答案比对（与主战斗同原则）
    const graded: ExamGradedQuestion[] = rows.map((r, seq) => {
      const primary = r.word.senses[0];
      const { pos, rest } = splitPos(primary?.meaning ?? r.word.text);
      const ans = answerBySeq.get(seq);
      const typed = (ans?.typed ?? '').trim();
      const correct = isAnswerCorrect(typed, r.word.text);
      const phonetic = r.word.phoneticAm ?? r.word.phoneticEn ?? undefined;
      const misspelled = !correct && typed !== '' && levenshtein(typed, r.word.text) <= 2;
      return {
        seq,
        wordId: r.word.id,
        pos,
        meaning: rest || r.word.text,
        text: r.word.text,
        phonetic: correct ? undefined : phonetic, // 仅答错的题展示音标
        typed,
        correct,
        misspelled: !correct ? misspelled : undefined,
      };
    });

    const total = graded.length;
    const correctCount = graded.filter((q) => q.correct).length;
    const wrongCount = total - correctCount;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    const timed = answers.filter((a) => a.elapsedMs > 0);
    const avgElapsedMs =
      timed.length > 0
        ? timed.reduce((s, a) => s + a.elapsedMs, 0) / timed.length
        : 8000;
    const rating: Rating = computeRating({
      total: Math.max(1, total),
      correct: correctCount,
      avgElapsedMs,
      perfectBonus: total > 0 && accuracy === 100,
    });
    const xp = ratingExp(rating);
    const coins = computeCoins(graded.map((q) => ({ seq: q.seq, correct: q.correct, elapsedMs: 0 })), rating);

    // ── 计入统计（事务）：Run + RunItem（总正确率）+ 词级/义项 SRS（掌握度/错题本）──
    const wrongbookAdded = await this.recordStats(userId, bank.id, stageId, graded, avgElapsedMs);

    return {
      paperId: opts.paperId,
      bankCode,
      stageId,
      total,
      correct: correctCount,
      wrong: wrongCount,
      accuracy,
      rating,
      xp,
      coins,
      wrongbookAdded,
      questions: graded,
    };
  }

  // 写库：试卷按一次"Unit Run"计（kind='unit', mode='exam'），
  // RunItem 逐题落库 → 直接计入统计页总答题/正确数；词级/义项 SRS 与主战斗同口径。
  private async recordStats(
    userId: number,
    bankId: number,
    stageId: number,
    graded: ExamGradedQuestion[],
    avgElapsedMs: number,
  ): Promise<number> {
    const now = new Date();
    const correctCount = graded.filter((q) => q.correct).length;
    const total = graded.length;
    const rating = computeRating({
      total: Math.max(1, total),
      correct: correctCount,
      avgElapsedMs,
      perfectBonus: total > 0 && correctCount === total,
    });
    const xp = ratingExp(rating);
    const coins = computeCoins(graded.map((q) => ({ seq: q.seq, correct: q.correct, elapsedMs: 0 })), rating);

    return this.prisma.$transaction(async (tx) => {
      // 1) Run 记录（kind=unit, mode=exam, 当天即结算为 finished）
      const run = await tx.run.create({
        data: {
          userId,
          bankId,
          stageId,
          mode: 'exam',
          kind: 'unit',
          day: 1,
          hp: 1,
          maxHp: 1,
          status: 'finished',
          cleared: false,
          rating,
          xpEarned: xp,
          coinsEarned: coins,
          createdAt: now,
          updatedAt: now,
        },
      });

      // 2) RunItem 逐题（计入统计页总答题/正确数；seq 即题号）
      await tx.runItem.createMany({
        data: graded.map((q, idx) => ({
          runId: run.id,
          seq: idx,
          wordId: q.wordId,
          senseIdx: 0,
          type: 'new',
          answered: true,
          correct: q.correct,
          elapsedMs: 0,
        })),
      });

      // 3) 词级 SRS + 错题本（与 runs.commitWaveSrs 同口径，识别=zh2en 回忆）
      const byWord = new Map<string, ExamGradedQuestion[]>();
      for (const q of graded) {
        const list = byWord.get(q.wordId) ?? [];
        list.push(q);
        byWord.set(q.wordId, list);
      }
      const wordIds = [...byWord.keys()];
      const progress = await tx.userWordProgress.findMany({ where: { userId, wordId: { in: wordIds } } });
      const progressByWord = new Map(progress.map((p) => [p.wordId, p]));
      const wordRows = await tx.word.findMany({ where: { id: { in: wordIds } }, select: { id: true, tier: true } });
      const tierByWord = new Map(wordRows.map((w) => [w.id, w.tier]));

      let wrongbookAdded = 0;
      for (const [wordId, list] of byWord) {
        const cur = progressByWord.get(wordId);
        const srsBase = cur
          ? { reviewStage: cur.reviewStage, ease: cur.ease }
          : { reviewStage: 0, ease: initialEaseForTier(tierByWord.get(wordId)) };
        let srs = srsBase;
        const wb: WrongbookState = cur
          ? { inWrongBook: cur.inWrongBook, wrongStreak: cur.wrongStreak }
          : { inWrongBook: false, wrongStreak: 0 };
        for (const q of list) {
          srs = srsSchedule(srs, q.correct);
          const next = applyWrongbookState(wb, [{ correct: q.correct }]);
          wb.inWrongBook = next.inWrongBook;
          wb.wrongStreak = next.wrongStreak;
        }
        if (wb.inWrongBook && !cur?.inWrongBook) wrongbookAdded++;
        const s = srs;
        const next = wb.inWrongBook
          ? new Date(now.getTime() + intervalDays(1) * 86400000)
          : s.reviewStage > 0
            ? new Date(now.getTime() + effectiveIntervalDays(s.reviewStage, s.ease) * 86400000)
            : null;
        const mastery = masteryFromStage(s.reviewStage);
        const newlyMastered = mastery >= 100 && (cur?.mastery ?? 0) < 100;

        await tx.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId, wordId,
            correctCount: list.filter((q) => q.correct).length,
            wrongCount: list.filter((q) => !q.correct).length,
            inWrongBook: wb.inWrongBook,
            wrongStreak: wb.wrongStreak,
            inVocabBook: true,
            mastery,
            reviewStage: s.reviewStage,
            nextReviewAt: next,
            ease: s.ease,
            firstEncounteredAt: now,
            lastEncounteredAt: now,
            srsHistory: [{ stage: s.reviewStage, at: now.toISOString() }],
            masteredAt: newlyMastered ? now : null,
          },
          update: {
            correctCount: { increment: list.filter((q) => q.correct).length },
            wrongCount: { increment: list.filter((q) => !q.correct).length },
            inWrongBook: wb.inWrongBook,
            wrongStreak: wb.wrongStreak,
            inVocabBook: true,
            mastery,
            reviewStage: s.reviewStage,
            nextReviewAt: next,
            ease: s.ease,
            firstEncounteredAt: cur ? undefined : now,
            lastEncounteredAt: now,
            srsHistory: appendStageHistory(cur?.srsHistory, cur?.reviewStage ?? 0, s.reviewStage, now),
            masteredAt: newlyMastered ? now : undefined,
          },
        });
      }

      // 4) 义项级 SRS（senseIdx 0 主义项）
      for (const [wordId, list] of byWord) {
        const base = await tx.userSenseProgress.findUnique({
          where: { userId_wordId_senseIdx: { userId, wordId, senseIdx: 0 } },
        });
        let srs = base
          ? { reviewStage: base.reviewStage, ease: base.ease }
          : { reviewStage: 0, ease: initialEaseForTier(tierByWord.get(wordId)) };
        for (const q of list) srs = srsSchedule(srs, q.correct);
        await tx.userSenseProgress.upsert({
          where: { userId_wordId_senseIdx: { userId, wordId, senseIdx: 0 } },
          create: {
            userId, wordId, senseIdx: 0,
            reviewStage: srs.reviewStage, ease: srs.ease,
            correctCount: list.filter((q) => q.correct).length,
            lastTestedAt: now,
          },
          update: {
            reviewStage: srs.reviewStage, ease: srs.ease,
            correctCount: { increment: list.filter((q) => q.correct).length },
            lastTestedAt: now,
          },
        });
      }

      // 5) 金币 + 角色经验/等级
      await tx.user.update({ where: { id: userId }, data: { coins: { increment: coins } } });
      const char = await tx.userCharacter.findUnique({ where: { userId } });
      if (char) {
        const newExp = char.exp + xp;
        await tx.userCharacter.update({
          where: { userId },
          data: { exp: newExp, level: levelFromExp(newExp) },
        });
      }

      return wrongbookAdded;
    });
  }
}
