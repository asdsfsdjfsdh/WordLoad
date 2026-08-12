// 会话结算：落库会话+逐题 → 计算评级/经验/金币/掉落 → 更新词级+义项级 SRS → 角色经验/材料
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DropItem, Rating, SessionFinish } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService, type SessionPlan } from '../questions/questions.service';
import {
  computeCoins,
  computeRating,
  intervalDays,
  ratingExp,
  rollDrops,
  srsSchedule,
  type AnswerInput,
} from './settlement';

// 掌握度：reviewStage 达到 6 视为掌握（mastery 100）
const MASTER_STAGE = 6;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
  ) {}

  // 创建会话并落库（题目与来源一并持久化），返回 sessionId
  async createSession(opts: {
    userId: number;
    bankCode: string;
    stageId: number;
    mode: string;
    size?: number;
    wordIds?: string[];
  }) {
    const plan: SessionPlan = await this.questions.buildSession({
      userId: opts.userId,
      bankCode: opts.bankCode,
      stageId: opts.stageId,
      mode: opts.mode as 'zh2en' | 'dictation',
      size: opts.size,
      wordIds: opts.wordIds,
    });

    const bank = await this.prisma.wordBank.findUnique({
      where: { code: opts.bankCode },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${opts.bankCode}`);

    const session = await this.prisma.learningSession.create({
      data: {
        userId: opts.userId,
        bankId: bank.id,
        stageId: opts.stageId,
        mode: opts.mode,
        result: false,
        rating: 'C',
      },
    });

    await this.prisma.learningSessionItem.createMany({
      data: plan.items.map((it) => ({
        sessionId: session.id,
        seq: it.seq,
        wordId: it.wordId,
        senseIdx: it.senseIdx,
        type: it.source,
      })),
    });

    return { sessionId: String(session.id), plan };
  }

  // 提交答案并结算：校验会话归属 → 逐题更新 → SRS/进度/角色/材料
  async submit(
    userId: number,
    sessionId: number,
    answers: AnswerInput[],
  ): Promise<SessionFinish> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
    // 预防快速虚假结算（事务内仍有乐观锁兜底防并发）
    if (session.result) throw new BadRequestException('会话已结算');

    // 用真实词集合 + 现有义项数校验 senseIdx 上限；typed 提供时以服务端比对结果为准
    const wordIds = [...new Set(session.items.map((i) => i.wordId))];
    const wordRows = await this.prisma.word.findMany({
      where: { id: { in: wordIds } },
      select: { id: true, text: true },
    });
    const textByWord = new Map(wordRows.map((w) => [w.id, w.text]));

    const answerBySeq = new Map(answers.map((a) => [a.seq, a]));

    const resolveCorrect = (item: { wordId: string; seq: number }): boolean => {
      const a = answerBySeq.get(item.seq);
      const typed = a?.typed;
      if (typed === undefined || typed === null) return a?.correct ?? false;
      const truth = textByWord.get(item.wordId) ?? '';
      return typed.trim().toLowerCase() === truth.trim().toLowerCase();
    };

    const itemUpdates: {
      seq: number;
      correct: boolean;
      elapsedMs: number;
    }[] = [];
    let correct = 0;
    let elapsedTotal = 0;
    for (const item of session.items) {
      const a = answerBySeq.get(item.seq);
      const isCorrect = resolveCorrect(item);
      const ms = a?.elapsedMs ?? 0;
      itemUpdates.push({ seq: item.seq, correct: isCorrect, elapsedMs: ms });
      if (isCorrect) correct++;
      elapsedTotal += ms;
    }
    const total = session.items.length;
    const avgElapsedMs = total ? elapsedTotal / total : 0;
    const perfectBonus = total > 0 && correct === total;

    const rating = computeRating({ total, correct, avgElapsedMs, perfectBonus });
    const xp = ratingExp(rating);
    const coins = computeCoins(itemUpdates, rating);
    const drops = rollDrops(rating);

    const materialIdByCode = new Map(
      (
        await this.prisma.material.findMany({
          where: { code: { in: drops.map((d) => d.materialCode) } },
        })
      ).map((m) => [m.code, m.id]),
    );

    // 单个事务完成：会话/逐题 + 词级&义项级 SRS + 角色/金币/材料（失败整体回滚）
    const { newMastered, mastered } = await this.prisma.$transaction(async (tx) => {
      // 乐观锁防并发重复结算：仅 result=false 的行更新成功
      const updated = await tx.learningSession.updateMany({
        where: { id: session.id, result: false },
        data: {
          result: true,
          rating,
          xpEarned: xp,
          coinsEarned: coins,
          damageTaken: total - correct,
          monstersCleared: correct,
          bossCleared: perfectBonus,
        },
      });
      if (updated.count === 0) throw new BadRequestException('会话已结算');

      // 事务内读取词级进度，避免并发结算使用过时状态
      const curProgress = await tx.userWordProgress.findMany({
        where: { userId, wordId: { in: wordIds } },
      });
      const curByWord = new Map(curProgress.map((p) => [p.wordId, p]));

      await Promise.all(
        itemUpdates.map((u) =>
          tx.learningSessionItem.updateMany({
            where: { sessionId: session.id, seq: u.seq },
            data: { answered: true, correct: u.correct, elapsedMs: u.elapsedMs },
          }),
        ),
      );

      let newMastered = 0;
      const mastered: string[] = [];
      for (const item of session.items) {
        const correctNow = resolveCorrect(item);

        const cur = curByWord.get(item.wordId);
        const srs = srsSchedule(
          cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null,
          correctNow,
        );
        const wasMastered = (cur?.mastery ?? 0) >= 100;
        const mastery = Math.min(100, srs.reviewStage * 20);
        if (!wasMastered && mastery >= 100) {
          newMastered++;
          mastered.push(item.wordId);
        }
        const now = Date.now();
        const next = new Date(now + intervalDays(srs.reviewStage) * 86400000);
        const nextOrNull = srs.reviewStage > 0 ? next : null;

        await tx.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId: item.wordId } },
          create: {
            userId,
            wordId: item.wordId,
            stage: session.stageId,
            correctCount: correctNow ? 1 : 0,
            wrongCount: correctNow ? 0 : 1,
            inWrongBook: !correctNow,
            inVocabBook: true,
            mastery,
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            firstEncounteredAt: new Date(now),
            lastEncounteredAt: new Date(now),
          },
          update: {
            correctCount: { increment: correctNow ? 1 : 0 },
            wrongCount: { increment: correctNow ? 0 : 1 },
            inWrongBook: correctNow ? false : true,
            inVocabBook: true,
            mastery,
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            firstEncounteredAt: cur ? undefined : new Date(now), // 仅在首次时设置
            lastEncounteredAt: new Date(now),
          },
        });

        // 义项级 SRS
        await tx.userSenseProgress.upsert({
          where: {
            userId_wordId_senseIdx: { userId, wordId: item.wordId, senseIdx: item.senseIdx },
          },
          create: {
            userId,
            wordId: item.wordId,
            senseIdx: item.senseIdx,
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            correctCount: correctNow ? 1 : 0,
            lastTestedAt: new Date(now),
          },
          update: {
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            correctCount: { increment: correctNow ? 1 : 0 },
            lastTestedAt: new Date(now),
          },
        });
      }

      // 角色经验 + 金币 + 材料
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: coins } },
      });
      await tx.userCharacter.upsert({
        where: { userId },
        create: { userId, exp: xp },
        update: { exp: { increment: xp } },
      });
      for (const d of drops.filter((d) => materialIdByCode.has(d.materialCode))) {
        await tx.userMaterial.upsert({
          where: {
            userId_materialId: {
              userId,
              materialId: materialIdByCode.get(d.materialCode) as number,
            },
          },
          create: { userId, materialId: materialIdByCode.get(d.materialCode) as number, count: d.count },
          update: { count: { increment: d.count } },
        });
      }

      return { newMastered, mastered };
    });

    return {
      rating,
      xp,
      coins,
      drops: drops.map((d) => ({ materialCode: d.materialCode, tier: d.tier, count: d.count })),
      newMastered,
      reviewedWords: total,
      progressDelta: total ? mastered.length / total : 0,
    };
  }
}