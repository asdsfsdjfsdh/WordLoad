// 后台管理服务：单词库 / 阅读库 编辑与修正
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminAuditLogListResult,
  AdminAuditLogRow,
  AdminGlossaryUpdate,
  AdminPassageEdit,
  AdminQuestionUpdate,
  AdminSentenceUpdate,
  AdminStatsOverview,
  AdminStatsTrend,
  AdminTrendDay,
  AdminUserDetail,
  AdminUserListResult,
  AdminWordCreateInput,
  AdminWordDetail,
  AdminWordListResult,
  AdminWordSaveInput,
  ReadingSentenceKnowledge,
  ReadingSentenceStructure,
} from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 审计：记录管理操作（写接口统一调用）
  private async audit(
    adminId: number,
    action: 'save' | 'create' | 'delete',
    table: string,
    recordId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        table,
        recordId,
        before: (before as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        after: (after as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });
  }

  // ── 单词库 ──
  async listWords(q: string, tier: string | undefined, page: number, pageSize: number): Promise<AdminWordListResult> {
    const where: Record<string, unknown> = {};
    if (tier) where['tier'] = tier;
    if (q && q.trim()) {
      where['OR'] = [
        { text: { contains: q.trim() } },
        { senses: { some: { meaning: { contains: q.trim() } } } },
      ];
    }
    const [total, words] = await Promise.all([
      this.prisma.word.count({ where }),
      this.prisma.word.findMany({
        where,
        include: {
          _count: { select: { senses: true } },
          bankWords: { select: { stage: true, bank: { select: { code: true } } }, take: 1 },
        },
        orderBy: { text: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 阅读库词表引用标记
    const wordIds = words.map((w) => w.id);
    const texts = words.map((w) => w.text);
    const refs = wordIds.length
      ? await this.prisma.readingGlossary.findMany({
          where: { OR: [{ wordId: { in: wordIds } }, { word: { in: texts } }] },
          select: { wordId: true },
        })
      : [];
    const refWordIds = new Set(refs.map((r) => r.wordId).filter((x): x is string => !!x));

    return {
      total,
      items: words.map((w) => {
        const bw = w.bankWords[0];
        return {
          id: w.id,
          text: w.text,
          phoneticAm: w.phoneticAm ?? undefined,
          phoneticEn: w.phoneticEn ?? undefined,
          tier: w.tier as AdminWordListResult['items'][number]['tier'],
          stage: bw?.stage ?? null,
          bankCode: bw?.bank.code,
          senseCount: w._count.senses,
          inReadingGlossary: refWordIds.has(w.id) || refs.some((r) => r.wordId === null),
        };
      }),
    };
  }

  async getWord(id: string): Promise<AdminWordDetail> {
    const word = await this.prisma.word.findUnique({
      where: { id },
      include: {
        senses: { orderBy: { idx: 'asc' } },
        bankWords: { include: { bank: true }, orderBy: { stage: 'asc' } },
      },
    });
    if (!word) throw new NotFoundException('单词不存在');
    return {
      id: word.id,
      text: word.text,
      phoneticAm: word.phoneticAm ?? undefined,
      phoneticEn: word.phoneticEn ?? undefined,
      tier: word.tier as AdminWordDetail['tier'],
      difficultyScore: word.difficultyScore,
      mnemonic: word.mnemonic ?? undefined,
      senses: word.senses.map((s) => ({ id: s.id, idx: s.idx, meaning: s.meaning, example: s.example })),
      banks: word.bankWords.map((bw) => ({ bankId: bw.bankId, code: bw.bank.code, name: bw.bank.name, stage: bw.stage })),
    };
  }

  async saveWord(adminId: number, id: string, input: AdminWordSaveInput): Promise<AdminWordDetail> {
    const existing = await this.prisma.word.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('单词不存在');

    await this.prisma.$transaction([
      this.prisma.word.update({
        where: { id },
        data: {
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.phoneticAm !== undefined ? { phoneticAm: input.phoneticAm } : {}),
          ...(input.phoneticEn !== undefined ? { phoneticEn: input.phoneticEn } : {}),
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
          ...(input.mnemonic !== undefined ? { mnemonic: input.mnemonic } : {}),
        },
      }),
      // 义项全量替换（用户进度按 wordId+senseIdx 追踪，重建安全）
      this.prisma.wordSense.deleteMany({ where: { wordId: id } }),
      this.prisma.wordSense.createMany({
        data: input.senses.map((s, i) => ({ wordId: id, idx: i, meaning: s.meaning, example: s.example })),
      }),
    ]);
    await this.audit(adminId, 'save', 'word', id, { text: existing.text }, { text: input.text ?? existing.text, senses: input.senses.length });
    return this.getWord(id);
  }

  async createWord(adminId: number, input: AdminWordCreateInput): Promise<AdminWordDetail> {
    const tier = input.tier ?? 'I';
    const word = await this.prisma.word.create({
      data: {
        text: input.text,
        phoneticAm: input.phoneticAm,
        phoneticEn: input.phoneticEn,
        difficultyScore: 3,
        tier,
        difficultyDims: {},
        senses: input.senses?.length
          ? { create: input.senses.map((s, i) => ({ idx: i, meaning: s.meaning, example: s.example })) }
          : undefined,
      },
    });
    if (input.bankCode && input.stage) {
      const bank = await this.prisma.wordBank.findUnique({ where: { code: input.bankCode } });
      if (bank) {
        await this.prisma.bankWord.upsert({
          where: { bankId_wordId: { bankId: bank.id, wordId: word.id } },
          update: { stage: input.stage },
          create: { bankId: bank.id, wordId: word.id, stage: input.stage },
        });
      }
    }
    await this.audit(adminId, 'create', 'word', word.id, undefined, { text: word.text, tier, senses: input.senses?.length ?? 0 });
    return this.getWord(word.id);
  }

  async deleteWord(adminId: number, id: string): Promise<{ ok: true }> {
    const word = await this.prisma.word.findUnique({ where: { id } });
    if (!word) throw new NotFoundException('单词不存在');
    const [prog, senseProg, runItems, sessionItems] = await Promise.all([
      this.prisma.userWordProgress.count({ where: { wordId: id } }),
      this.prisma.userSenseProgress.count({ where: { wordId: id } }),
      this.prisma.runItem.count({ where: { wordId: id } }),
      this.prisma.learningSessionItem.count({ where: { wordId: id } }),
    ]);
    if (prog + senseProg + runItems + sessionItems > 0) {
      throw new ConflictException('该词已被用户学习/答题记录引用，禁止删除（可改用编辑修正）');
    }
    await this.prisma.$transaction([
      this.prisma.bankWord.deleteMany({ where: { wordId: id } }),
      this.prisma.wordPair.deleteMany({ where: { OR: [{ wordAId: id }, { wordBId: id }] } }),
      this.prisma.word.delete({ where: { id } }),
    ]);
    await this.audit(adminId, 'delete', 'word', id, { text: word.text });
    return { ok: true };
  }

  // ── 阅读库 ──
  async listReadingPapers(): Promise<{ id: number; year: number; examName: string; passages: { id: number; code: string; title: string; order: number }[] }[]> {
    const papers = await this.prisma.readingPaper.findMany({
      include: { passages: { orderBy: { order: 'asc' }, select: { id: true, code: true, title: true, order: true } } },
      orderBy: { year: 'desc' },
    });
    return papers;
  }

  async getPassage(passageId: number): Promise<AdminPassageEdit> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      include: {
        paper: true,
        sentences: { orderBy: { seq: 'asc' } },
        questions: { orderBy: { seq: 'asc' } },
        glossary: true,
      },
    });
    if (!passage) throw new NotFoundException('篇章不存在');
    return {
      id: passage.id,
      paperYear: passage.paper.year,
      examName: passage.paper.examName,
      code: passage.code as AdminPassageEdit['code'],
      title: passage.title,
      subtitle: passage.subtitle ?? undefined,
      questionsStart: passage.questionsStart,
      content: passage.content,
      translation: passage.translation,
      sentences: passage.sentences.map((s) => ({
        id: s.id,
        seq: s.seq,
        para: s.para,
        en: s.en,
        zh: s.zh,
        structure: (s.structure as ReadingSentenceStructure | null) ?? undefined,
        knowledge: (s.knowledge as ReadingSentenceKnowledge | null) ?? undefined,
      })),
      questions: passage.questions.map((q) => ({
        id: q.id,
        seq: q.seq,
        stem: q.stem,
        options: q.options as AdminPassageEdit['questions'][number]['options'],
        answer: q.answer,
        analysis: q.analysis,
        remark: q.remark ?? undefined,
      })),
      glossary: passage.glossary.map((g) => ({
        id: g.id,
        word: g.word,
        meaning: g.meaning,
        wordId: g.wordId ?? undefined,
      })),
    };
  }

  async savePassageMeta(adminId: number, passageId: number, input: { title?: string; subtitle?: string | null }): Promise<{ ok: true }> {
    const exists = await this.prisma.readingPassage.findUnique({ where: { id: passageId }, select: { id: true, title: true } });
    if (!exists) throw new NotFoundException('篇章不存在');
    await this.prisma.readingPassage.update({
      where: { id: passageId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingPassage', String(passageId), { title: exists.title }, { title: input.title ?? exists.title });
    return { ok: true };
  }

  async saveSentence(adminId: number, id: number, input: AdminSentenceUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingSentence.findUnique({ where: { id }, select: { id: true, en: true } });
    if (!exists) throw new NotFoundException('句子不存在');
    const data: Prisma.ReadingSentenceUpdateInput = {};
    if (input.en !== undefined) data.en = input.en;
    if (input.zh !== undefined) data.zh = input.zh;
    if (input.structure !== undefined) {
      data.structure = input.structure === null ? Prisma.DbNull : (input.structure as unknown as Prisma.InputJsonValue);
    }
    if (input.knowledge !== undefined) {
      data.knowledge = input.knowledge === null ? Prisma.DbNull : (input.knowledge as unknown as Prisma.InputJsonValue);
    }
    await this.prisma.readingSentence.update({ where: { id }, data });
    await this.audit(adminId, 'save', 'readingSentence', String(id), { en: exists.en }, { en: input.en ?? exists.en });
    return { ok: true };
  }

  async saveQuestion(adminId: number, id: number, input: AdminQuestionUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingQuestion.findUnique({ where: { id }, select: { id: true, answer: true } });
    if (!exists) throw new NotFoundException('题目不存在');
    await this.prisma.readingQuestion.update({
      where: { id },
      data: {
        ...(input.stem !== undefined ? { stem: input.stem } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.analysis !== undefined ? { analysis: input.analysis } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingQuestion', String(id), { answer: exists.answer }, { answer: input.answer ?? exists.answer });
    return { ok: true };
  }

  async saveGlossary(adminId: number, id: number, input: AdminGlossaryUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingGlossary.findUnique({ where: { id }, select: { id: true, word: true } });
    if (!exists) throw new NotFoundException('词表条目不存在');
    await this.prisma.readingGlossary.update({
      where: { id },
      data: {
        ...(input.word !== undefined ? { word: input.word } : {}),
        ...(input.meaning !== undefined ? { meaning: input.meaning } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingGlossary', String(id), { word: exists.word }, { word: input.word ?? exists.word });
    return { ok: true };
  }

  // ── 运营总览 ──
  async getStatsOverview(): Promise<AdminStatsOverview> {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const recentSignups = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, username: true, createdAt: true },
    });
    const [users, words, runs, sessions, reading] = await Promise.all([
      Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: startToday } } }),
        this.prisma.user.count({ where: { isAdmin: true } }),
      ]),
      Promise.all([
        this.prisma.word.count(),
        this.prisma.wordSense.count(),
        this.prisma.wordBank.count(),
        this.prisma.wordPair.count(),
      ]),
      Promise.all([
        this.prisma.run.count(),
        this.prisma.run.count({ where: { status: 'active' } }),
        this.prisma.run.count({ where: { createdAt: { gte: startToday } } }),
        this.prisma.run.count({ where: { cleared: true } }),
      ]),
      Promise.all([
        this.prisma.learningSession.count(),
        this.prisma.learningSession.count({ where: { createdAt: { gte: startToday } } }),
      ]),
      Promise.all([
        this.prisma.readingPaper.count(),
        this.prisma.readingPassage.count(),
        this.prisma.readingSentence.count(),
        this.prisma.readingQuestion.count(),
      ]),
    ]);
    const [userCount, todayNewUsers, adminCount] = users;
    const [wordCount, senseCount, bankCount, pairCount] = words;
    const [runCount, activeRuns, todayRuns, clearedRuns] = runs;
    const [sessionCount, todaySessions] = sessions;
    const [paperCount, passageCount, sentenceCount, questionCount] = reading;
    return {
      users: { total: userCount, todayNew: todayNewUsers, admins: adminCount },
      words: { total: wordCount, senses: senseCount, banks: bankCount, wordPairs: pairCount },
      runs: { total: runCount, active: activeRuns, todayNew: todayRuns, completed: clearedRuns },
      sessions: { total: sessionCount, todayNew: todaySessions },
      reading: { papers: paperCount, passages: passageCount, sentences: sentenceCount, questions: questionCount },
      recentSignups: recentSignups.map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt.toISOString() })),
    };
  }

  // ── 运营趋势（近 N 天逐日）──
  async getStatsTrend(days: number): Promise<AdminStatsTrend> {
    const n = Math.min(60, Math.max(1, Math.floor(days) || 14));
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1), 0, 0, 0, 0);
    const pad = (x: number): string => String(x).padStart(2, '0');
    const key = (d: Date): string => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const dayKeys: string[] = [];
    const row = new Map<string, AdminTrendDay>();
    for (let i = 0; i < n; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = key(d);
      dayKeys.push(k);
      row.set(k, { date: k, newUsers: 0, activeUsers: 0, runs: 0, sessions: 0, readingAnswers: 0 });
    }
    const activeByDay = new Map<string, Set<number>>();
    const touch = (k: string, uid: number) => {
      let s = activeByDay.get(k);
      if (!s) { s = new Set(); activeByDay.set(k, s); }
      s.add(uid);
    };

    // 一次性拉取窗口内原始记录，按本地日期在 JS 端分桶（数据量小，避免了按时间分组跨时区的坑）
    const [users, runs, sessions, readingAnswers] = await Promise.all([
      this.prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { id: true, createdAt: true } }),
      this.prisma.run.findMany({ where: { createdAt: { gte: start } }, select: { userId: true, createdAt: true } }),
      this.prisma.learningSession.findMany({ where: { createdAt: { gte: start } }, select: { userId: true, createdAt: true } }),
      this.prisma.readingAnswer.findMany({ where: { submittedAt: { gte: start } }, select: { userId: true, submittedAt: true } }),
    ]);

    for (const u of users) {
      const k = key(u.createdAt);
      const r = row.get(k);
      if (r) { r.newUsers += 1; touch(k, u.id); }
    }
    for (const r of runs) {
      const k = key(r.createdAt);
      const d = row.get(k);
      if (d) { d.runs += 1; touch(k, r.userId); }
    }
    for (const s of sessions) {
      const k = key(s.createdAt);
      const d = row.get(k);
      if (d) { d.sessions += 1; touch(k, s.userId); }
    }
    for (const a of readingAnswers) {
      const k = key(a.submittedAt);
      const d = row.get(k);
      if (d) { d.readingAnswers += 1; touch(k, a.userId); }
    }

    return {
      days: n,
      daysData: dayKeys.map((k) => ({ ...row.get(k)!, activeUsers: activeByDay.get(k)?.size ?? 0 })),
    };
  }

  // ── 用户管理 ──
  async listUsers(q: string, page: number, pageSize: number): Promise<AdminUserListResult> {
    const where = q && q.trim() ? { username: { contains: q.trim() } } : {};
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          username: true,
          isAdmin: true,
          coins: true,
          createdAt: true,
          character: { select: { level: true } },
        },
      }),
    ]);
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return { items: [], total };
    const [runAgg, sessAgg, learnedAgg, wrongAgg, runMax, sessMax, readMax] = await Promise.all([
      this.prisma.run.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.learningSession.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.userWordProgress.groupBy({ by: ['userId'], where: { userId: { in: ids }, mastery: { gte: 100 } }, _count: { _all: true } }),
      this.prisma.userWordProgress.groupBy({ by: ['userId'], where: { userId: { in: ids }, inWrongBook: true }, _count: { _all: true } }),
      this.prisma.run.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { updatedAt: true } }),
      this.prisma.learningSession.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.readingProgress.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { lastReadAt: true } }),
    ]);
    const toMap = (rows: { userId: number; _count?: { _all: number } }[]): Map<number, number> => {
      const m = new Map<number, number>();
      for (const r of rows) if (r._count) m.set(r.userId, r._count._all);
      return m;
    };
    const runMap = toMap(runAgg);
    const sessMap = toMap(sessAgg);
    const learnedMap = toMap(learnedAgg);
    const wrongMap = toMap(wrongAgg);
    const lastActive = new Map<number, Date>();
    const stamp = (rows: { userId: number }[], key: 'updatedAt' | 'createdAt' | 'lastReadAt') => {
      for (const r of rows) {
        const d = (r as unknown as { _max: Record<string, Date | null> })._max[key];
        if (d) {
          const cur = lastActive.get(r.userId);
          if (!cur || d > cur) lastActive.set(r.userId, d);
        }
      }
    };
    stamp(runMax, 'updatedAt');
    stamp(sessMax, 'createdAt');
    stamp(readMax, 'lastReadAt');

    return {
      total,
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: u.isAdmin,
        coins: u.coins,
        createdAt: u.createdAt.toISOString(),
        lastActiveAt: lastActive.get(u.id)?.toISOString() ?? null,
        charLevel: u.character?.level ?? 1,
        runCount: runMap.get(u.id) ?? 0,
        sessionCount: sessMap.get(u.id) ?? 0,
        wordsLearned: learnedMap.get(u.id) ?? 0,
        inWrongBook: wrongMap.get(u.id) ?? 0,
      })),
    };
  }

  async getUserDetail(id: number): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { character: true } });
    if (!user) throw new NotFoundException('用户不存在');
    const [runs, sessions, learned, wrong, vocab, senseProg, readingPapers] = await Promise.all([
      this.prisma.run.findMany({ where: { userId: id }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      this.prisma.learningSession.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.userWordProgress.count({ where: { userId: id, mastery: { gte: 100 } } }),
      this.prisma.userWordProgress.count({ where: { userId: id, inWrongBook: true } }),
      this.prisma.userWordProgress.count({ where: { userId: id, inVocabBook: true } }),
      this.prisma.userSenseProgress.count({ where: { userId: id } }),
      this.prisma.readingProgress.count({ where: { userId: id, status: { not: 'not-started' } } }),
    ]);
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      coins: user.coins,
      createdAt: user.createdAt.toISOString(),
      character: user.character
        ? {
            level: user.character.level,
            exp: user.character.exp,
            hpLv: user.character.hpLv,
            atkLv: user.character.atkLv,
            defLv: user.character.defLv,
            executeSpec: user.character.executeSpec,
            vampireSpec: user.character.vampireSpec,
          }
        : null,
      progress: {
        wordsLearned: learned,
        inWrongBook: wrong,
        inVocabBook: vocab,
        senseProgress: senseProg,
        readingPapers,
      },
      runs: runs.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        day: r.day,
        rating: r.rating,
        maxCombo: r.maxCombo,
        cleared: r.cleared,
        coinsEarned: r.coinsEarned,
        createdAt: r.createdAt.toISOString(),
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        result: s.result,
        rating: s.rating,
        xpEarned: s.xpEarned,
        coinsEarned: s.coinsEarned,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async setUserAdmin(adminId: number, targetId: number, isAdmin: boolean): Promise<{ ok: true; isAdmin: boolean }> {
    if (targetId === adminId) throw new BadRequestException('不能修改自己的管理员状态');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isAdmin: true } });
    if (!target) throw new NotFoundException('用户不存在');
    await this.prisma.user.update({ where: { id: targetId }, data: { isAdmin } });
    await this.audit(adminId, 'save', 'user', String(targetId), { isAdmin: target.isAdmin }, { isAdmin });
    return { ok: true, isAdmin };
  }

  // ── 审计日志 ──
  async listAuditLogs(
    filter: { table?: string; action?: string; adminUsername?: string },
    page: number,
    pageSize: number,
  ): Promise<AdminAuditLogListResult> {
    const where: Record<string, unknown> = {};
    if (filter.table) where['table'] = filter.table;
    if (filter.action) where['action'] = filter.action;
    if (filter.adminUsername && filter.adminUsername.trim()) {
      where['admin'] = { username: { contains: filter.adminUsername.trim() } };
    }
    const [total, items] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { admin: { select: { username: true } } },
      }),
    ]);
    return {
      total,
      items: items.map((l): AdminAuditLogRow => ({
        id: l.id,
        adminUsername: l.admin.username,
        action: l.action,
        table: l.table,
        recordId: l.recordId,
        before: l.before === undefined || l.before === null ? undefined : (l.before as unknown),
        after: l.after === undefined || l.after === null ? undefined : (l.after as unknown),
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }
}
