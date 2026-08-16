// 会话结算：落库会话+逐题 → 计算评级/经验/金币/掉落 → 更新词级+义项级 SRS → 角色经验/材料
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EnterBossResponse, BossExtendResponse, DropItem, GameMode, Rating, SessionFinish } from '@word-journey/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService, type SessionPlan } from '../questions/questions.service';
import { allocBossPool, allocExtend, buildQuestion, rotateSense } from '../questions/question-builder';
import {
  appendStageHistory,
  applyWrongbookState,
  computeCoins,
  computeRating,
  intervalDays,
  isAnswerCorrect,
  levelFromExp,
  masteryFromStage,
  ratingExp,
  rollDrops,
  srsSchedule,
  type AnswerInput,
  type WrongbookState,
} from './settlement';

// 复习会话的词行载荷（含完整义项）
const reviewSessionInclude = {
  word: { include: { senses: { orderBy: { idx: 'asc' as const } } } },
} as const;
type ReviewSessionRow = Prisma.UserWordProgressGetPayload<{ include: typeof reviewSessionInclude }>;

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

  // 创建复习会话：只从到期词中抽题，不经过模式预习/Boss
  // wordIds 提供时（图鉴弱词复习）：精确指定词集，跳过到期抽题
  async createReviewSession(opts: {
    userId: number;
    bankCode: string;
    size?: number;
    wordIds?: string[];
  }) {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: opts.bankCode },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${opts.bankCode}`);

    const sessionSize = Math.min(60, Math.max(10, opts.size ?? 30));
    const now = new Date();

    let chosen: ReviewSessionRow[];
    if (opts.wordIds && opts.wordIds.length > 0) {
      // 图鉴弱词复习：词必须属于该用户且属于该词书（杜绝静默丢词）
      const rows = await this.prisma.userWordProgress.findMany({
        where: {
          userId: opts.userId,
          wordId: { in: opts.wordIds },
          word: { bankWords: { some: { bankId: bank.id } } },
        },
        include: reviewSessionInclude,
      });
      const found = new Set(rows.map((p) => p.wordId));
      const missing = opts.wordIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`${missing.length} 个单词不在该词书或尚未学习，无法加入复习`);
      }
      if (rows.length === 0) throw new BadRequestException('暂无需要复习的单词');
      chosen = rows;
    } else {
      // 三档优先级：①错题本词 ②到期未掌握词 ③到期毕业词（长间隔重考兜底）
      const [wrongbookPool, duePool, graduatedDuePool] = await Promise.all([
        this.prisma.userWordProgress.findMany({
          where: {
            userId: opts.userId,
            inWrongBook: true,
            word: { bankWords: { some: { bankId: bank.id } } },
          },
          include: reviewSessionInclude,
          orderBy: { wrongStreak: 'asc' },
          take: sessionSize,
        }),
        this.prisma.userWordProgress.findMany({
          where: {
            userId: opts.userId,
            nextReviewAt: { lte: now },
            mastery: { lt: 100 },
            inWrongBook: false,
            word: { bankWords: { some: { bankId: bank.id } } },
          },
          include: reviewSessionInclude,
          orderBy: { nextReviewAt: 'asc' },
          take: sessionSize,
        }),
        this.prisma.userWordProgress.findMany({
          where: {
            userId: opts.userId,
            nextReviewAt: { lte: now },
            mastery: { gte: 100 },
            skipped: false,
            word: { bankWords: { some: { bankId: bank.id } } },
          },
          include: reviewSessionInclude,
          orderBy: { nextReviewAt: 'asc' },
          take: sessionSize,
        }),
      ]);

      // 毕业词仅在错题本+到期未掌握不足时兜底补齐
      const fillerSlots = sessionSize - wrongbookPool.length - duePool.length;
      const graduatedFill: ReviewSessionRow[] = fillerSlots > 0 ? graduatedDuePool.slice(0, fillerSlots) : [];
      chosen = [...wrongbookPool, ...duePool, ...graduatedFill];
    }

    if (chosen.length === 0) throw new BadRequestException('暂无需要复习的单词');

    const wordIds = chosen.map((p) => p.wordId);
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

    const items: { seq: number; wordId: string; senseIdx: number; source: 'review' | 'wrongbook' }[] = [];
    const questions: import('@word-journey/shared').Question[] = [];

    chosen.forEach((p, i) => {
      const w = p.word;
      const seq = i;
      const senseIdx = senseIdxOf(w.id, w.senses.length);
      const sense = w.senses[senseIdx] ?? w.senses[0];
      const source = p.inWrongBook ? 'wrongbook' as const : 'review' as const;
      const q = buildQuestion({
        seq, wordId: w.id, senseIdx, text: w.text,
        promptBase: sense?.meaning ?? w.text,
        example: sense?.example,
        phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
        tier: w.tier as import('@word-journey/shared').DifficultyTier,
        mode,
        source,
        mnemonic: w.mnemonic ?? undefined,
      });
      questions.push(q);
      items.push({ seq, wordId: w.id, senseIdx, source });
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

  // 进入 Boss 阶段：落库学习段 items 的 answered/correct → 攒 Boss 词池 → 返回 Boss 首批评题
  async enterBoss(
    userId: number,
    sessionId: number,
    answers: AnswerInput[],
  ): Promise<EnterBossResponse> {
    // 行锁 + 事务：并发进 Boss 串行化，避免重复落库 answers / 重复插入 Boss 题
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT id FROM `LearningSession` WHERE id = ? FOR UPDATE', sessionId);
    const session = await tx.learningSession.findUnique({
      where: { id: sessionId },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
    if (session.result) throw new BadRequestException('会话已结算');
    if (session.phase !== 'study') throw new BadRequestException('非学习段');

    const mode = session.mode as GameMode;
    const wordRows = await tx.word.findMany({
      where: { id: { in: [...new Set(session.items.map((i) => i.wordId))] } },
      select: { id: true, text: true },
    });
    const textByWord = new Map(wordRows.map((w) => [w.id, w.text]));
    const answerBySeq = new Map(answers.map((a) => [a.seq, a]));

    const resolveCorrect = (item: { wordId: string; seq: number }): boolean => {
      const a = answerBySeq.get(item.seq);
      const typed = a?.typed;
      return isAnswerCorrect(typed, textByWord.get(item.wordId) ?? '');
    };

    // 落库学习段 items answered/correct
    const wrongIds: string[] = [];
    const passedIds: string[] = [];
    for (const item of session.items) {
      const correct = resolveCorrect(item);
      if (correct) passedIds.push(item.wordId);
      else wrongIds.push(item.wordId);
      await tx.learningSessionItem.updateMany({
        where: { sessionId: session.id, seq: item.seq },
        data: { answered: true, correct, elapsedMs: answerBySeq.get(item.seq)?.elapsedMs ?? 0 },
      });
    }

    // 历史错词（不在本场）
    const usedIds = new Set(session.items.map((i) => i.wordId));
    const history = await tx.userWordProgress.findMany({
      where: { userId, inWrongBook: true, wordId: { notIn: [...usedIds] } },
      select: { wordId: true },
    });
    const historyIds = history.map((h) => h.wordId);

// Boss 血量
    const poolIds = allocBossPool({ wrong: wrongIds, passed: passedIds, history: historyIds });
    if (poolIds.length === 0) {
      await tx.learningSession.update({ where: { id: session.id }, data: { phase: 'boss', bossHp: 0 } });
      return { questions: [], exhausted: true, bossHp: 0 };
    }

    // 组题
    const { questions, items } = await this.buildQuestionsForWords(userId, mode, session.items[session.items.length - 1]?.seq ?? -1, poolIds, wrongIds, tx);
    await tx.learningSessionItem.createMany({
      data: items.map((it) => ({ ...it, sessionId: session.id })),
    });
    // Boss 血量落库：submit 用它服务端权威判定 bossCleared，杜绝客户端宣称
    const bossHp = Math.min(18, 6 + Math.floor((session.items.length + items.length) / 10) * 2);
    await tx.learningSession.update({ where: { id: session.id }, data: { phase: 'boss', bossHp } });

    return { questions, exhausted: false, bossHp };
    });
  }

  // Boss extend：词穷 Boss 未尽 → 续词
  async bossExtend(
    userId: number,
    sessionId: number,
    missedWordIds: string[],
  ): Promise<BossExtendResponse> {
    // 事务 + 会话行锁：串行化并发 extend/submit，避免重复 seq
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM LearningSession WHERE id = ${sessionId} FOR UPDATE`;

      const session = await tx.learningSession.findUnique({
        where: { id: sessionId },
        include: { items: { select: { wordId: true } } },
      });
      if (!session || session.userId !== userId) throw new UnauthorizedException('会话不存在');
      if (session.result) throw new BadRequestException('会话已结算');
      if (session.phase !== 'boss') throw new BadRequestException('非 Boss 段');

      const mode = session.mode as GameMode;
      const usedIds = new Set(session.items.map((i) => i.wordId));

      // 历史错词剩余
      const history = await tx.userWordProgress.findMany({
        where: { userId, inWrongBook: true, wordId: { notIn: [...usedIds] } },
        select: { wordId: true },
      });
      const historyIds = history.map((h) => h.wordId).filter((id) => !usedIds.has(id));

      // 未学词兜底
      const unseen = await tx.bankWord.findMany({
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

      const maxSeq = await tx.learningSessionItem.findFirst({
        where: { sessionId: session.id },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      const { questions, items } = await this.buildQuestionsForWords(
        userId, mode, maxSeq?.seq ?? session.items.length - 1, poolIds,
        // extend 批小错词不标 revenge
        [],
        tx,
      );
      await tx.learningSessionItem.createMany({
        data: items.map((it) => ({ ...it, sessionId: session.id })),
      });

      return { questions, exhausted: false };
    });
  }

  // 内部：给定词 ID 列表生成考题（复用 rotateSense + buildQuestion）
  private async buildQuestionsForWords(
    userId: number,
    mode: GameMode,
    startSeq: number,
    wordIds: string[],
    revengeIds: string[],
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<{
    questions: import('@word-journey/shared').Question[];
    items: { seq: number; wordId: string; senseIdx: number; type: string }[];
  }> {
    const db = tx ?? this.prisma;
    const revengeSet = new Set(revengeIds);
    const words = await db.word.findMany({
      where: { id: { in: wordIds } },
      include: { senses: { orderBy: { idx: 'asc' } } },
    });
    const wordById = new Map(words.map((w) => [w.id, w]));

    const senseProgress = await db.userSenseProgress.findMany({
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
        mnemonic: w.mnemonic ?? undefined,
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
      const mastery = masteryFromStage(srs.reviewStage);
      updates.push(
        this.prisma.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId, wordId, mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, correctCount: 1,
            inVocabBook: true, firstEncounteredAt: new Date(now), lastEncounteredAt: new Date(now),
            srsHistory: [{ stage: srs.reviewStage, at: new Date(now).toISOString() }],
          },
          update: {
            mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, correctCount: { increment: 1 },
            inWrongBook: false, lastEncounteredAt: new Date(now),
            srsHistory: appendStageHistory(cur?.srsHistory, cur?.reviewStage ?? 0, srs.reviewStage, new Date(now)),
          },
        }),
      );
    }
    for (const wordId of dto.unknownIds) {
      const cur = progByWord.get(wordId);
      const srs = srsSchedule(cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null, false);
      const next = new Date(now + intervalDays(srs.reviewStage) * 86400000);
      const mastery = masteryFromStage(srs.reviewStage);
      updates.push(
        this.prisma.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId, wordId, mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, wrongCount: 1,
            inWrongBook: true, inVocabBook: true,
            firstEncounteredAt: new Date(now), lastEncounteredAt: new Date(now),
            srsHistory: [{ stage: srs.reviewStage, at: new Date(now).toISOString() }],
          },
          update: {
            mastery, reviewStage: srs.reviewStage,
            nextReviewAt: srs.reviewStage > 0 ? next : null,
            ease: srs.ease, wrongCount: { increment: 1 },
            inWrongBook: true, lastEncounteredAt: new Date(now),
            srsHistory: appendStageHistory(cur?.srsHistory, cur?.reviewStage ?? 0, srs.reviewStage, new Date(now)),
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
      return isAnswerCorrect(typed, textByWord.get(item.wordId) ?? '');
    };

    const itemUpdates: {
      seq: number;
      correct: boolean;
      elapsedMs: number;
    }[] = [];
    let correct = 0;
    let elapsedTotal = 0;
    let combo = 0;
    let maxCombo = 0;
    // 错词转化率统计
    const studyWrongIds = new Set<string>();
    const bossCorrectIds = new Set<string>();
    let bossItemCount = 0;
    let bossCorrectCount = 0;
    const wordResults: { text: string; correct: boolean; type: string }[] = [];
    for (const item of session.items) {
      const a = answerBySeq.get(item.seq);
      const isCorrect = resolveCorrect(item);
      const ms = a?.elapsedMs ?? 0;
      itemUpdates.push({ seq: item.seq, correct: isCorrect, elapsedMs: ms });
      const wordText = textByWord.get(item.wordId) ?? '';
      wordResults.push({ text: wordText, correct: isCorrect, type: item.type });
      if (isCorrect) {
        correct++;
        combo += 1;
        if (combo > maxCombo) maxCombo = combo;
      } else {
        combo = 0;
      }
      elapsedTotal += ms;
      // 记录学习段错词（type !== 'boss' 的未答 / 错）
      if (item.type !== 'boss' && !isCorrect) studyWrongIds.add(item.wordId);
      // 记录 Boss 段答对的
      if (item.type === 'boss' && isCorrect) bossCorrectIds.add(item.wordId);
      if (item.type === 'boss') {
        bossItemCount += 1;
        if (isCorrect) bossCorrectCount += 1;
      }
    }
    const total = session.items.length;
    // 本局实际作答的词数（按去重单词计，不含未作答/Boss 续战刷出的题）
    const answeredItems = session.items.filter((i) => answerBySeq.has(i.seq));
    const reviewedWords = new Set(answeredItems.map((i) => i.wordId)).size;
    const answeredTotal = itemUpdates.filter((u) => u.elapsedMs > 0).length;
    const avgElapsedMs = answeredTotal ? elapsedTotal / answeredTotal : 0;
    const perfectBonus = total > 0 && correct === total;

    // Boss 击破：服务端权威判定（答对 Boss 题数 ≥ 落库血量），不再信任客户端宣称
    const bossClearedServer =
      bossFought && (session.bossHp > 0 ? bossCorrectCount >= session.bossHp : bossCorrectCount === bossItemCount);

    let rating = computeRating({ total, correct, avgElapsedMs, perfectBonus });
    // Boss 段参战但未击败 → 评级封顶 A
    if (bossFought && !bossClearedServer && (rating === 'SSS' || rating === 'SS' || rating === 'S')) {
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

    // 单个事务完成：会话逐题 + 词级&义项级 SRS + 角色/金币/材料（失败整体回滚）
    const { newMastered, mastered, leveledUp } = await this.prisma.$transaction(async (tx) => {
      // 乐观锁防并发重复结算：仅 result=false 的行更新成功
      const updated = await tx.learningSession.updateMany({
        where: { id: session.id, result: false },
        data: {
          result: true,
          rating,
          maxCombo,
          xpEarned: xp,
          coinsEarned: coins,
          damageTaken: total - correct,
          monstersCleared: correct,
          bossCleared: bossClearedServer,
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
      // 同词链式排程：会话内重复词（如错词→Boss 复仇词）从上次结果续算，避免陈旧快照回退
      const srsByWord = new Map<string, { reviewStage: number; ease: number }>();
      // 图鉴 SRS 档位变更史：按词链式累计（同会话内多次档位变化逐条记录）
      const historyByWord = new Map<string, { stage: number; at: string }[]>();
      // 错题本状态：逐题链式累计（连续答对 WRONGBOOK_CLEAR_STREAK 次摘标）
      const wrongbookByWord = new Map<string, WrongbookState>();
      for (const item of session.items) {
        const correctNow = resolveCorrect(item);

        const cur = curByWord.get(item.wordId);
        const prevRunningStage = srsByWord.get(item.wordId)?.reviewStage ?? (cur?.reviewStage ?? 0);
        const srs = srsSchedule(
          srsByWord.get(item.wordId) ?? (cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null),
          correctNow,
        );
        srsByWord.set(item.wordId, { reviewStage: srs.reviewStage, ease: srs.ease });
        const baseHistory =
          historyByWord.get(item.wordId)
          ?? (Array.isArray(cur?.srsHistory) ? (cur.srsHistory as { stage: number; at: string }[]) : []);
        const stageHistory = appendStageHistory(baseHistory, prevRunningStage, srs.reviewStage, new Date());
        historyByWord.set(item.wordId, stageHistory);
        const wasMastered = (cur?.mastery ?? 0) >= 100;
        const mastery = masteryFromStage(srs.reviewStage);
        // 同词在会话内重复（如错词→Boss 复仇词）只计一次新掌握
        if (!wasMastered && mastery >= 100 && !mastered.has(item.wordId)) {
          mastered.add(item.wordId);
          newMastered++;
        }
        const now = Date.now();
        // 错题本状态：从历史进度 + 本会话此前答案链式累计
        const wb = applyWrongbookState(
          wrongbookByWord.get(item.wordId)
            ?? (cur ? { inWrongBook: cur.inWrongBook, wrongStreak: cur.wrongStreak } : null),
          [{ correct: correctNow }],
        );
        wrongbookByWord.set(item.wordId, wb);
        // 进错题本 → 次日短间隔再考（强化即时巩固），覆盖 SRS 长间隔
        const next = new Date(now + intervalDays(srs.reviewStage) * 86400000);
        const nextOrNull = wb.inWrongBook ? new Date(now + intervalDays(1) * 86400000) : (srs.reviewStage > 0 ? next : null);

        await tx.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId: item.wordId } },
          create: {
            userId,
            wordId: item.wordId,
            stage: session.stageId,
            correctCount: correctNow ? 1 : 0,
            wrongCount: correctNow ? 0 : 1,
            inWrongBook: wb.inWrongBook,
            wrongStreak: wb.wrongStreak,
            inVocabBook: true,
            mastery,
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            firstEncounteredAt: new Date(now),
            lastEncounteredAt: new Date(now),
            srsHistory: stageHistory,
          },
          update: {
            correctCount: { increment: correctNow ? 1 : 0 },
            wrongCount: { increment: correctNow ? 0 : 1 },
            inWrongBook: wb.inWrongBook,
            wrongStreak: wb.wrongStreak,
            inVocabBook: true,
            mastery,
            reviewStage: srs.reviewStage,
            nextReviewAt: nextOrNull,
            ease: srs.ease,
            firstEncounteredAt: cur ? undefined : new Date(now), // 仅在首次时设置
            lastEncounteredAt: new Date(now),
            srsHistory: stageHistory,
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
      // 角色经验原子累加 + 等级反推（避免并发结算读改写 XP）
      await tx.userCharacter.upsert({
        where: { userId },
        create: { userId, exp: xp, level: levelFromExp(xp) },
        update: { exp: { increment: xp } },
      });
      const after = await tx.userCharacter.findUnique({ where: { userId } });
      const finalExp = after?.exp ?? 0;
      const newLevel = levelFromExp(finalExp);
      // 同步写回等级（结算只累加 exp，需按新 exp 重算等级，否则等级/强化上限整套失效）
      if (after) await tx.userCharacter.update({ where: { userId }, data: { level: newLevel } });
      const leveledUp = newLevel > levelFromExp(Math.max(0, finalExp - xp));
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
      bossCleared: bossClearedServer,
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
