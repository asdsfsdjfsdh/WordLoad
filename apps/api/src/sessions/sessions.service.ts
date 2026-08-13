// 会话结算：落库会话+逐题 → 计算评级/经验/金币/掉落 → 更新词级+义项级 SRS → 角色经验/材料
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EnterBossResponse, BossExtendResponse, DropItem, GameMode, Rating, SessionFinish } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService, type SessionPlan } from '../questions/questions.service';
import { allocBossPool, allocExtend, buildQuestion, rotateSense } from '../questions/question-builder';
import {
  computeCoins,
  computeRating,
  intervalDays,
  levelFromExp,
  ratingExp,
  rollDrops,
  srsSchedule,
  type AnswerInput,
} from './settlement';

// 掌握度：reviewStage 达到 MASTER_STAGE 次正确复习视为掌握（mastery 100）
const MASTER_STAGE = 3;

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
      mode: opts.mode as GameMode,
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

  // 创建复习会话：只从到期词中抽题，不经过模式/预习/Boss
  async createReviewSession(opts: {
    userId: number;
    bankCode: string;
    size?: number;
  }) {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: opts.bankCode },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${opts.bankCode}`);

    const sessionSize = Math.min(60, Math.max(10, opts.size ?? 30));
    const now = new Date();

    const dueProgress = await this.prisma.userWordProgress.findMany({
      where: {
        userId: opts.userId,
        nextReviewAt: { lte: now },
        mastery: { lt: 100 },
        inWrongBook: false,
        word: { bankWords: { some: { bankId: bank.id } } },
      },
      include: { word: {
        include: { senses: { orderBy: { idx: 'asc' } } },
      } },
      orderBy: { nextReviewAt: 'asc' },
      take: sessionSize,
    });

    if (dueProgress.length === 0) throw new BadRequestException('暂无需要复习的单词');

    const wordIds = dueProgress.map((p) => p.wordId);
    const chosen = dueProgress.slice(0, sessionSize);
    const mode = 'zh2en';

    const senseProgress = await this.prisma.userSenseProgress.findMany({
      where: { userId: opts.userId, wordId: { in: wordIds } },
    });
    const spByWord = new Map<string, typeof senseProgress>();
    for (const sp of senseProgress) {
      const list = spByWord.get(sp.wordId) ?? [];
      list.push(sp);
      spByWord.set(sp.wordId, list);
    }

    const senseIdxOf = (wordId: string, senseCount: number): number => {
      if (senseCount <= 1) return 0;
      const sps = spByWord.get(wordId) ?? [];
      const states = Array.from({ length: senseCount }, (_, idx) => {
        const sp = sps.find((x) => x.senseIdx === idx);
        return { idx, reviewStage: sp?.reviewStage ?? 0, lastTestedAt: sp ? (sp.lastTestedAt?.getTime() ?? 0) : Number.MIN_SAFE_INTEGER };
      });
      return rotateSense(states);
    };

    const items: { seq: number; wordId: string; senseIdx: number; source: 'review' }[] = [];
    const questions: import('@word-journey/shared').Question[] = [];

    chosen.forEach((p, i) => {
      const w = p.word;
      const seq = i;
      const senseIdx = senseIdxOf(w.id, w.senses.length);
      const sense = w.senses[senseIdx] ?? w.senses[0];
      const q = buildQuestion({
        seq, wordId: w.id, senseIdx, text: w.text,
        promptBase: sense?.meaning ?? w.text,
        example: sense?.example,
        phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
        tier: w.tier as import('@word-journey/shared').DifficultyTier,
        mode,
        source: 'review',
      });
      questions.push(q);
      items.push({ seq, wordId: w.id, senseIdx, source: 'review' as const });
    });

    const session = await this.prisma.learningSession.create({
      data: {
        userId: opts.userId, bankId: bank.id, stageId: 0,
        mode, result: false, rating: 'C', phase: 'study',
      },
    });

    await this.prisma.learningSessionItem.createMany({
      data: items.map((it) => ({
        sessionId: session.id, seq: it.seq, wordId: it.wordId,
        senseIdx: it.senseIdx, type: it.source,
      })),
    });

    return {
      sessionId: String(session.id),
      plan: { session: { sessionId: String(session.id), bankId: String(bank.id), stageId: 0, mode, questions }, items },
    };
  }

  // 进入 Boss 阶段：落库学习段 items 的 answered/correct → 组 Boss 词池 → 返回 Boss 首批评题
  async enterBoss(
    userId: number,
    sessionId: number,
    answers: AnswerInput[],
  ): Promise<EnterBossResponse> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
    if (session.result) throw new BadRequestException('会话已结算');
    if (session.phase !== 'study') throw new BadRequestException('非学习段');

    const mode = session.mode as GameMode;
    const wordRows = await this.prisma.word.findMany({
      where: { id: { in: [...new Set(session.items.map((i) => i.wordId))] } },
      select: { id: true, text: true },
    });
    const textByWord = new Map(wordRows.map((w) => [w.id, w.text]));
    const answerBySeq = new Map(answers.map((a) => [a.seq, a]));

    const resolveCorrect = (item: { wordId: string; seq: number }): boolean => {
      const a = answerBySeq.get(item.seq);
      const typed = a?.typed;
      if (typed !== undefined && typed !== null) {
        const truth = textByWord.get(item.wordId) ?? '';
        return typed.trim().toLowerCase() === truth.trim().toLowerCase();
      }
      return a?.correct ?? false;
    };

    // 落库学习段 items answered/correct
    const wrongIds: string[] = [];
    const passedIds: string[] = [];
    for (const item of session.items) {
      const correct = resolveCorrect(item);
      if (correct) passedIds.push(item.wordId);
      else wrongIds.push(item.wordId);
      await this.prisma.learningSessionItem.updateMany({
        where: { sessionId: session.id, seq: item.seq },
        data: { answered: true, correct, elapsedMs: answerBySeq.get(item.seq)?.elapsedMs ?? 0 },
      });
    }

    // 历史错词（不在本场）
    const usedIds = new Set(session.items.map((i) => i.wordId));
    const history = await this.prisma.userWordProgress.findMany({
      where: { userId, inWrongBook: true, wordId: { notIn: [...usedIds] } },
      select: { wordId: true },
    });
    const historyIds = history.map((h) => h.wordId);

    // Boss 池
    const poolIds = allocBossPool({ wrong: wrongIds, passed: passedIds, history: historyIds });
    if (poolIds.length === 0) {
      await this.prisma.learningSession.update({ where: { id: session.id }, data: { phase: 'boss' } });
      return { questions: [], exhausted: true, bossHp: 0 };
    }

    // 组题
    const { questions, items } = await this.buildQuestionsForWords(userId, mode, session.items[session.items.length - 1]?.seq ?? -1, poolIds, wrongIds);
    await this.prisma.learningSessionItem.createMany({
      data: items.map((it) => ({ ...it, sessionId: session.id })),
    });
    await this.prisma.learningSession.update({ where: { id: session.id }, data: { phase: 'boss' } });

    const bossHp = Math.min(18, 6 + Math.floor((session.items.length + items.length) / 10) * 2);
    return { questions, exhausted: false, bossHp };
  }

  // Boss extend：词尽 Boss 未死 → 续词
  async bossExtend(
    userId: number,
    sessionId: number,
    missedWordIds: string[],
  ): Promise<BossExtendResponse> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: { items: { select: { wordId: true } } },
    });
    if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
    if (session.result) throw new BadRequestException('会话已结算');
    if (session.phase !== 'boss') throw new BadRequestException('非 Boss 段');

    const mode = session.mode as GameMode;
    const usedIds = new Set(session.items.map((i) => i.wordId));

    // 历史错词剩余
    const history = await this.prisma.userWordProgress.findMany({
      where: { userId, inWrongBook: true, wordId: { notIn: [...usedIds] } },
      select: { wordId: true },
    });
    const historyIds = history.map((h) => h.wordId).filter((id) => !usedIds.has(id));

    // 未学词兜底
    const unseen = await this.prisma.bankWord.findMany({
      where: { bankId: session.bankId, stage: session.stageId, wordId: { notIn: [...usedIds] } },
      select: { wordId: true },
    });
    const unseenIds = unseen.map((u) => u.wordId).filter((id) => !usedIds.has(id));

    const poolIds = allocExtend({
      batchWrong: missedWordIds.filter((id) => session.items.some((i) => i.wordId === id)),
      history: historyIds,
      unseen: unseenIds,
      used: usedIds,
    });

    if (poolIds.length === 0) return { questions: [], exhausted: true };

    const maxSeq = await this.prisma.learningSessionItem.findFirst({
      where: { sessionId: session.id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const { questions, items } = await this.buildQuestionsForWords(
      userId, mode, maxSeq?.seq ?? session.items.length - 1, poolIds,
      // extend 批小错词不标 revenge
      [],
    );
    await this.prisma.learningSessionItem.createMany({
      data: items.map((it) => ({ ...it, sessionId: session.id })),
    });

    return { questions, exhausted: false };
  }

  // 内部：给定词 ID 列表生成考题（复用 rotateSense + buildQuestion）
  private async buildQuestionsForWords(
    userId: number,
    mode: GameMode,
    startSeq: number,
    wordIds: string[],
    revengeIds: string[],
  ): Promise<{
    questions: import('@word-journey/shared').Question[];
    items: { seq: number; wordId: string; senseIdx: number; type: string }[];
  }> {
    const revengeSet = new Set(revengeIds);
    const words = await this.prisma.word.findMany({
      where: { id: { in: wordIds } },
      include: { senses: { orderBy: { idx: 'asc' } } },
    });
    const wordById = new Map(words.map((w) => [w.id, w]));

    const senseProgress = await this.prisma.userSenseProgress.findMany({
      where: { userId, wordId: { in: wordIds } },
    });
    const spByWord = new Map<string, typeof senseProgress>();
    for (const sp of senseProgress) {
      const list = spByWord.get(sp.wordId) ?? [];
      list.push(sp);
      spByWord.set(sp.wordId, list);
    }

    const senseIdxOf = (wordId: string, senseCount: number): number => {
      if (senseCount <= 1) return 0;
      const sps = spByWord.get(wordId) ?? [];
      const states = Array.from({ length: senseCount }, (_, idx) => {
        const sp = sps.find((x) => x.senseIdx === idx);
        return { idx, reviewStage: sp?.reviewStage ?? 0, lastTestedAt: sp ? (sp.lastTestedAt?.getTime() ?? 0) : Number.MIN_SAFE_INTEGER };
      });
      return rotateSense(states);
    };

    const questions: import('@word-journey/shared').Question[] = [];
    const items: { seq: number; wordId: string; senseIdx: number; type: string }[] = [];

    wordIds.forEach((wordId, i) => {
      const w = wordById.get(wordId);
      if (!w) return;
      const seq = startSeq + i + 1;
      const senseIdx = senseIdxOf(wordId, w.senses.length);
      const sense = w.senses[senseIdx] ?? w.senses[0];
      const promptBase = mode === 'dictation' ? (w.phoneticAm ?? w.phoneticEn ?? '') : (sense?.meaning ?? w.text);
      const q = buildQuestion({
        seq,
        wordId: w.id,
        senseIdx,
        text: w.text,
        promptBase,
        example: sense?.example,
        phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
        tier: w.tier as import('@word-journey/shared').DifficultyTier,
        mode,
        source: 'boss',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (revengeSet.has(wordId)) (q as any).isRevenge = true;
      questions.push(q);
      items.push({ seq, wordId: w.id, senseIdx, type: 'boss' });
    });

    return { questions, items };
  }

  // 闪卡提交：更新 SRS 进度，不创建会话
  async flashcardSubmit(
    userId: number,
    dto: { knownIds: string[]; unknownIds: string[] },
  ) {
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: [...dto.knownIds, ...dto.unknownIds] } },
    });
    const progByWord = new Map(progress.map((p) => [p.wordId, p]));
    const now = Date.now();

    const updates: Promise<unknown>[] = [];
    for (const wordId of dto.knownIds) {
      const cur = progByWord.get(wordId);
      const srs = srsSchedule(cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null, true);
      const next = new Date(now + intervalDays(srs.reviewStage) * 86400000);
      const mastery = Math.min(100, srs.reviewStage * 20);
      updates.push(
        this.prisma.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId, wordId, mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, correctCount: 1,
            inVocabBook: true, firstEncounteredAt: new Date(now), lastEncounteredAt: new Date(now),
          },
          update: {
            mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, correctCount: { increment: 1 },
            inWrongBook: false, lastEncounteredAt: new Date(now),
          },
        }),
      );
    }
    for (const wordId of dto.unknownIds) {
      const cur = progByWord.get(wordId);
      const srs = srsSchedule(cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null, false);
      const next = new Date(now + intervalDays(srs.reviewStage) * 86400000);
      const mastery = Math.min(100, srs.reviewStage * 20);
      updates.push(
        this.prisma.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId, wordId, mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, wrongCount: 1,
            inWrongBook: true, inVocabBook: true,
            firstEncounteredAt: new Date(now), lastEncounteredAt: new Date(now),
          },
          update: {
            mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, wrongCount: { increment: 1 },
            inWrongBook: true, lastEncounteredAt: new Date(now),
          },
        }),
      );
    }
    await Promise.all(updates);
  }

  // 提交答案并结算：校验会话归属 → 逐题更新 → SRS/进度/角色/材料
  async submit(
    userId: number,
    sessionId: number,
    answers: AnswerInput[],
    bossCleared = false,
  ): Promise<SessionFinish> {
    const session = await this.prisma.learningSession.findUnique({
      where: { id: sessionId },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
    // 预防快速虚假结算（事务内仍有乐观锁兜底防并发）
    if (session.result) throw new BadRequestException('会话已结算');

    const bossFought = session.phase === 'boss';

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
    // 错词转化率统计
    const studyWrongIds = new Set<string>();
    const bossCorrectIds = new Set<string>();
    const wordResults: { text: string; correct: boolean; type: string }[] = [];
    for (const item of session.items) {
      const a = answerBySeq.get(item.seq);
      const isCorrect = resolveCorrect(item);
      const ms = a?.elapsedMs ?? 0;
      itemUpdates.push({ seq: item.seq, correct: isCorrect, elapsedMs: ms });
      const wordText = textByWord.get(item.wordId) ?? '';
      wordResults.push({ text: wordText, correct: isCorrect, type: item.type });
      if (isCorrect) correct++;
      elapsedTotal += ms;
      // 记录学习段错词（type !== 'boss' 的未答 / 错）
      if (item.type !== 'boss' && !isCorrect) studyWrongIds.add(item.wordId);
      // 记录 Boss 段答对的
      if (item.type === 'boss' && isCorrect) bossCorrectIds.add(item.wordId);
    }
    const total = session.items.length;
    // 本局实际作答的词数（按去重单词计，不含未作答/Boss 续战刷出的题）
    const answeredItems = session.items.filter((i) => answerBySeq.has(i.seq));
    const reviewedWords = new Set(answeredItems.map((i) => i.wordId)).size;
    const answeredTotal = itemUpdates.filter((u) => u.elapsedMs > 0).length;
    const avgElapsedMs = answeredTotal ? elapsedTotal / answeredTotal : 0;
    const perfectBonus = total > 0 && correct === total;

    let rating = computeRating({ total, correct, avgElapsedMs, perfectBonus });
    // Boss 段参战但未击败 → 评级封顶 A
    if (bossFought && !bossCleared && (rating === 'SSS' || rating === 'SS' || rating === 'S')) {
      rating = 'A';
    }
    const xp = ratingExp(rating);
    const coins = computeCoins(itemUpdates, rating);
    const drops = rollDrops(rating);

    const wrongConverted = [...studyWrongIds].filter((id) => bossCorrectIds.has(id)).length;
    const totalWrong = studyWrongIds.size;

    const materialIdByCode = new Map(
      (
        await this.prisma.material.findMany({
          where: { code: { in: drops.map((d) => d.materialCode) } },
        })
      ).map((m) => [m.code, m.id]),
    );

    // 单个事务完成：会话/逐题 + 词级&义项级 SRS + 角色/金币/材料（失败整体回滚）
    const { newMastered, mastered, leveledUp } = await this.prisma.$transaction(async (tx) => {
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
          bossCleared: bossFought && bossCleared,
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
      const mastered = new Set<string>();
      for (const item of session.items) {
        const correctNow = resolveCorrect(item);

        const cur = curByWord.get(item.wordId);
        const srs = srsSchedule(
          cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null,
          correctNow,
        );
        const wasMastered = (cur?.mastery ?? 0) >= 100;
        const mastery = Math.min(100, Math.round((srs.reviewStage / MASTER_STAGE) * 100));
        // 同词在会话内重复（如错词→Boss 复仇词）只计一次新掌握
        if (!wasMastered && mastery >= 100 && !mastered.has(item.wordId)) {
          mastered.add(item.wordId);
          newMastered++;
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

      // 角色经验 + 等级 + 金币 + 材料
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: coins } },
      });
      const char = await tx.userCharacter.findUnique({ where: { userId } });
      const prevExp = char?.exp ?? 0;
      const newExp = prevExp + xp;
      const newLevel = levelFromExp(newExp);
      const leveledUp = levelFromExp(newExp) > levelFromExp(prevExp);
      await tx.userCharacter.upsert({
        where: { userId },
        create: { userId, exp: newExp, level: newLevel },
        update: { exp: newExp, level: newLevel },
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

      return { newMastered, mastered, leveledUp };
    });

    // 明天预告：取 3 个到期将复习的词
    const dueProgress = await this.prisma.userWordProgress.findMany({
      where: { userId, nextReviewAt: { lte: new Date(Date.now() + 86400000) }, reviewStage: { gt: 0 } },
      include: { word: { select: { text: true, senses: { take: 1, orderBy: { idx: 'asc' } } } } },
      orderBy: { nextReviewAt: 'asc' },
      take: 3,
    });

    return {
      rating,
      xp,
      coins,
      drops: drops.map((d) => ({ materialCode: d.materialCode, tier: d.tier, count: d.count })),
      newMastered,
      reviewedWords,
      progressDelta: total ? mastered.size / new Set(session.items.map((i) => i.wordId)).size : 0,
      bossCleared: bossFought && bossCleared,
      bossFought,
      wrongConverted,
      totalWrong,
      leveledUp,
      tomorrowPreview: dueProgress
        .filter((p) => p.word)
        .map((p) => ({ text: p.word.text, meaning: p.word.senses[0]?.meaning ?? '' })),
      wordResults,
    };
  }
}