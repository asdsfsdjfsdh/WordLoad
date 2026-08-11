// 会话结算：落库会话+逐题 → 计算评级/经验/金币/掉落 → 更新词级+义项级 SRS → 角色经验/材料
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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
  async createSession(opts: { userId: number; bankCode: string; stageId: number; mode: string }) {
    const plan: SessionPlan = await this.questions.buildSession({
      userId: opts.userId,
      bankCode: opts.bankCode,
      stageId: opts.stageId,
      mode: opts.mode as 'zh2en' | 'dictation',
    });

    const bank = await this.prisma.wordBank.findUnique({
      where: { code: opts.bankCode },
    });
    if (!bank) throw new Error(`词书不存在: ${opts.bankCode}`);

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
    // 幂等保护：已结算的会话禁止重复提交（防刷 XP/金币/材料）
    if (session.result) throw new BadRequestException('会话已结算');

    // 用真实词集合 + 现有义项数校验 senseIdx 上限
    const answerBySeq = new Map(answers.map((a) => [a.seq, a]));

    const itemUpdates: {
      seq: number;
      correct: boolean;
      elapsedMs: number;
    }[] = [];
    let correct = 0;
    let elapsedTotal = 0;
    for (const item of session.items) {
      const a = answerBySeq.get(item.seq);
      const isCorrect = a?.correct ?? false;
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
    const coins = computeCoins(
      session.items.map((it) => ({
        seq: it.seq,
        correct: answerBySeq.get(it.seq)?.correct ?? false,
        elapsedMs: answerBySeq.get(it.seq)?.elapsedMs ?? 0,
      })),
      rating,
    );
    const drops = rollDrops(rating);

    // 逐题落库
    await this.prisma.$transaction([
      this.prisma.learningSession.update({
        where: { id: session.id },
        data: {
          result: true,
          rating,
          xpEarned: xp,
          coinsEarned: coins,
          damageTaken: total - correct,
          monstersCleared: correct,
          bossCleared: perfectBonus,
        },
      }),
      ...itemUpdates.map((u) =>
        this.prisma.learningSessionItem.updateMany({
          where: { sessionId: session.id, seq: u.seq },
          data: { answered: true, correct: u.correct, elapsedMs: u.elapsedMs },
        }),
      ),
    ]);

    // 词级 + 义项级进度更新
    let newMastered = 0;
    const mastered: string[] = [];
    for (const item of session.items) {
      const a = answerBySeq.get(item.seq);
      const correctNow = a?.correct ?? false;

      const cur = await this.prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId: item.wordId } },
      });
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
      const next = new Date(Date.now() + intervalDays(srs.reviewStage) * 86400000);

      await this.prisma.userWordProgress.upsert({
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
          nextReviewAt: srs.reviewStage > 0 ? next : null,
          ease: srs.ease,
        },
        update: {
          correctCount: { increment: correctNow ? 1 : 0 },
          wrongCount: { increment: correctNow ? 0 : 1 },
          inWrongBook: correctNow ? false : true,
          inVocabBook: true,
          mastery,
          reviewStage: srs.reviewStage,
          nextReviewAt: srs.reviewStage > 0 ? next : null,
          ease: srs.ease,
        },
      });

      // 义项级 SRS
      await this.prisma.userSenseProgress.upsert({
        where: {
          userId_wordId_senseIdx: { userId, wordId: item.wordId, senseIdx: item.senseIdx },
        },
        create: {
          userId,
          wordId: item.wordId,
          senseIdx: item.senseIdx,
          reviewStage: srs.reviewStage,
          nextReviewAt: srs.reviewStage > 0 ? next : null,
          ease: srs.ease,
          correctCount: correctNow ? 1 : 0,
        },
        update: {
          reviewStage: srs.reviewStage,
          nextReviewAt: srs.reviewStage > 0 ? next : null,
          ease: srs.ease,
          correctCount: { increment: correctNow ? 1 : 0 },
        },
      });
    }

    // 角色经验 + 金币 + 材料
    const materialRows = await this.prisma.material.findMany({
      where: { code: { in: drops.map((d) => d.materialCode) } },
    });
    const materialIdByCode = new Map(materialRows.map((m) => [m.code, m.id]));
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { coins: { increment: coins } },
      }),
      this.prisma.userCharacter.upsert({
        where: { userId },
        create: { userId, exp: xp },
        update: { exp: { increment: xp } },
      }),
      ...drops
        .filter((d) => materialIdByCode.has(d.materialCode))
        .map((d) =>
          this.prisma.userMaterial.upsert({
            where: {
              userId_materialId: {
                userId,
                materialId: materialIdByCode.get(d.materialCode) as number,
              },
            },
            create: {
              userId,
              materialId: materialIdByCode.get(d.materialCode) as number,
              count: d.count,
            },
            update: { count: { increment: d.count } },
          }),
        ),
    ]);

    return {
      rating,
      xp,
      coins,
      drops: drops.map((d) => ({ materialCode: d.materialCode, tier: d.tier as 1 | 2 | 3 | 4, count: d.count })),
      newMastered,
      reviewedWords: total,
      progressDelta: total ? mastered.length / total : 0,
    };
  }
}