import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createWaveSim } from '@word-journey/shared';
import { RunsService } from './runs.service';
import { PrismaService } from '../prisma/prisma.service';

// ── 最小 mock：按被测路径补齐字段 ──
const prisma = {
  wordBank: { findUnique: jest.fn() },
  userCharacter: { findUnique: jest.fn() },
  bankWord: { findMany: jest.fn() },
  word: { findMany: jest.fn() },
  material: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  userMaterial: { upsert: jest.fn() },
  run: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    aggregate: jest.fn(),
  },
  runItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  userWordProgress: { findMany: jest.fn(), upsert: jest.fn() },
  userSenseProgress: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
  learningSession: { create: jest.fn() },
  learningSessionItem: { createMany: jest.fn() },
  $transaction: jest.fn(),
} as unknown as PrismaService;

describe('RunsService', () => {
  let svc: RunsService;
  const character = { userId: 1, level: 1, exp: 0, hpLv: 1, atkLv: 1, defLv: 1 };
  const bank = { id: 10, code: 'core', name: '核心' };
  const word = (id: string, text: string, tier = 'I') => ({
    id,
    text,
    phoneticAm: null,
    phoneticEn: null,
    tier,
    mnemonic: null,
    senses: [{ idx: 0, meaning: `${text}义`, example: `例句${text}` }],
    confusableA: [],
    confusableB: [],
  });
  const pool = (ids: string[]) =>
    ids.map((w) => ({ wordId: w, stage: 1, word: word(w, w) }));

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new RunsService(prisma);
    (prisma.wordBank.findUnique as jest.Mock).mockResolvedValue(bank);
    (prisma.userCharacter.findUnique as jest.Mock).mockResolvedValue(character);
    (prisma.bankWord.findMany as jest.Mock).mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e']));
    (prisma.word.findMany as jest.Mock).mockImplementation(async ({ where }) => {
      const ids = where.id.in ?? [];
      return ids.map((id: string) => word(id, id));
    });
    (prisma.runItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.userWordProgress.findMany as jest.Mock).mockResolvedValue([]);
    // 默认事务 mock：透传 delegate + 提供 $queryRaw（finish/advance 行锁）
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        run: prisma.run,
        runItem: prisma.runItem,
        userCharacter: prisma.userCharacter,
        user: prisma.user,
        userMaterial: prisma.userMaterial,
        userWordProgress: prisma.userWordProgress,
        userSenseProgress: prisma.userSenseProgress,
        material: prisma.material,
      }),
    );
  });

  describe('create', () => {
    const created = {
      id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en',
      day: 1, hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1,
      surrendered: false, recordBroken: false, extra: {}, status: 'active',
      createdAt: new Date('2026-01-01'),
    };
    const mockTx = () => {
      const createMany = jest.fn().mockResolvedValue({ count: 5 });
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        run: { create: jest.fn().mockResolvedValue(created), update: jest.fn() },
        runItem: { createMany },
      }));
      return createMany;
    };

    it('创建首日 Run：无进度时全为新词，注入数=词数', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null); // 无旧 Run
      mockTx();

      const r = await svc.create(1, { bankCode: 'core', stageId: 1, mode: 'zh2en' });
      expect(r.day).toBe(1);
      expect(r.hp).toBe(22); // 20 + 2×1
      expect(r.injectedNew).toBe(5);
      expect(r.questions).toHaveLength(5);
      expect(r.questions.every((q) => q.isNew)).toBe(true);
      expect(r.previewWords).toHaveLength(5);
      expect(r.previewWords.every((w) => w.status === 'new')).toBe(true);
    });

    it('创建首日 Run：按 7:2:1 混合新词/复习/错题', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null);
      // c 在错题本，d 处于复习期（已到期）
      (prisma.userWordProgress.findMany as jest.Mock).mockResolvedValue([
        { wordId: 'c', inWrongBook: true, reviewStage: 2, nextReviewAt: new Date() },
        { wordId: 'd', inWrongBook: false, reviewStage: 1, nextReviewAt: new Date(Date.now() - 1000) },
      ]);
      const createMany = mockTx();

      const r = await svc.create(1, { bankCode: 'core', stageId: 1, mode: 'zh2en' });
      expect(r.questions).toHaveLength(5);
      expect(r.injectedNew).toBe(3); // a/b/e 为新词

      const data = (createMany as jest.Mock).mock.calls[0][0].data as {
        wordId: string;
        type: string;
      }[];
      const typeOf = (id: string) => data.find((d) => d.wordId === id)?.type;
      expect(typeOf('a')).toBe('new');
      expect(typeOf('b')).toBe('new');
      expect(typeOf('c')).toBe('wrongbook');
      expect(typeOf('d')).toBe('review');
      expect(typeOf('e')).toBe('new');

      const statusOf = (id: string) => r.previewWords.find((w) => w.wordId === id)?.status;
      expect(statusOf('c')).toBe('wrongbook');
      expect(statusOf('d')).toBe('review');
      expect(statusOf('a')).toBe('new');
    });
  });

  describe('getActive', () => {
    it('有未答题则返回未答题，isNew 由 type 推导', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 3,
        hp: 15, maxHp: 22, buffs: [], lastInjectDay: 2, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue([
        { id: 1, seq: 0, wordId: 'a', senseIdx: 0, type: 'new', answered: false },
        { id: 2, seq: 1, wordId: 'b', senseIdx: 0, type: 'review', answered: false },
      ]);

      const r = await svc.getActive(1);
      expect(r).not.toBeNull();
      expect(r!.questions).toHaveLength(2);
      expect(r!.questions[0]?.isNew).toBe(true);
      expect(r!.questions[1]?.isNew).toBe(false);
    });

    it('无 active Run 返回 null', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await svc.getActive(1)).toBeNull();
    });
  });

  describe('backupWords 候补词池预取', () => {
    const run = {
      id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 1,
      hp: 15, maxHp: 22, buffs: [], lastInjectDay: 0, surrendered: false,
      recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
    };

    it('返回未用/未掌握/未排除的新词，poolUsed 为累计去重词数', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      // 已用过 a、b，故候补只能从 c/d/e 里挑
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue([{ wordId: 'a' }, { wordId: 'b' }]);

      const r = await svc.backupWords(1, 1, { count: 2 });
      expect(r.words).toHaveLength(2);
      const ids = r.words.map((w) => w.wordId).sort();
      expect(ids.every((id) => ['c', 'd', 'e'].includes(id))).toBe(true);
      expect(r.poolUsed).toBe(2);
    });

    it('count 上限 20、排除参数生效且不落库（不调用 runItem.create）', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue([{ wordId: 'a' }]);
      (prisma.runItem.create as jest.Mock) ??= jest.fn();

      const r = await svc.backupWords(1, 1, { count: 99, exclude: ['c'] });
      // 候选 b/d/e（a 已用、c 被排除）→ 即使 count 上限大也只返回剩余候补
      expect(r.words).toHaveLength(3);
      expect(r.words.every((w) => ['b', 'd', 'e'].includes(w.wordId))).toBe(true);
      expect(prisma.runItem.create).not.toHaveBeenCalled();
    });

    it('Run 不存在或已结束抛 404', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.backupWords(1, 999)).rejects.toThrow('Run 不存在或已结束');
    });
  });

  describe('advance', () => {
    // advance 现在整体在 $transaction 内（行锁 + 串行化），
    // 事务回调的 tx 承担全部 DB 访问，需完整 mock
    const mockAdvanceTx = (run: unknown, items: unknown[]) => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: jest.fn().mockResolvedValue(run),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn(),
        },
        userCharacter: {
          findUnique: jest.fn().mockResolvedValue(character),
          update: jest.fn(),
        },
        user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        userMaterial: { upsert: jest.fn() },
        material: { findMany: jest.fn().mockResolvedValue([]) },
        bankWord: { findMany: jest.fn().mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e'])) },
        runItem: {
          findMany: jest.fn().mockResolvedValue(items),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest.fn().mockImplementation(async (args: unknown) =>
            (args as { _max?: unknown })._max ? { _max: { seq: 19 } } : { _count: Array.isArray(items) ? items.length : 0 }),
        },
        userWordProgress: {
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn(),
        },
        userSenseProgress: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
        },
        word: { findMany: jest.fn().mockImplementation(async ({ where }) =>
          (where?.id?.in ?? []).map((id: string) => word(id, id))),
        },
      }));
    };

    it('普通波全对：服务端重放与共享引擎一致，次日正确注入', async () => {
      // 20 题全 new（mock 词文本 = 单词首字母，len=1）
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      // 本波待答题（DB 查询）
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      // 答案全对（typed 以服务端比对为准）
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      // persistAnswers 逐题 update
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      // 次日组题
      mockAdvanceTx(run, items);
      // 期望血量 = 共享引擎对同答案序列的确定性重放（全对也可能因对攻墙漏怪掉血）
      const sim = createWaveSim({
        day: 2,
        atkLv: 1,
        defLv: 1,
        maxHp: 22,
        startHp: 22,
        buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
        legend: { bossImmunity: false, killHeal: false, bossX2: false, noLeakDmg: false },
        questions: items.map(() => ({ tier: 0, isNew: true, isBoss: false, len: 1 })),
        bossWave: false,
      });
      for (const _ of items) sim.step(true);

      const r = await svc.advance(1, 1, { answers, expectedDay: 2 });
      expect(r.ended).toBe(false);
      expect(r.day).toBe(3);
      expect(r.hp).toBe(sim.hp);
      expect(r.hp).toBeGreaterThanOrEqual(0);
      expect(r.hp).toBeLessThanOrEqual(22);
      expect(r.bossWave).toBe(false);
      // 题目 seq 必须从 base(=20) 连续递增，与 DB 插入行一致，否则客户端按题目 seq 回传将全部匹配失败
      expect(r.questions.map((q) => q.seq)).toEqual(
        Array.from({ length: r.questions.length }, (_, i) => 20 + i),
      );
    });

    it('全局连击：跨波累计（extra.__combo 持久化）、maxCombo 取峰', async () => {
      // 上一波末连击 5（extra.__combo=5），本波 20 题全对 → 连击 25
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: { __combo: 5 }, maxCombo: 8,
        status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      mockAdvanceTx(run, items);

      const r = await svc.advance(1, 1, { answers, expectedDay: 2 });
      expect(r.ended).toBe(false);
      expect(r.combo).toBe(25); // 5 + 20
      // 落库持久化：extra.__combo = 本波末连击，maxCombo = 全局峰值
      expect((run.extra as Record<string, unknown>).__combo).toBe(25);
      expect(run.maxCombo).toBe(25);
    });

    it('游玩时长：客户端秒表上报取 max 持久化并回传（防回退）', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, playSeconds: 30,
        status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      const txUpdate = jest.fn().mockResolvedValue(run);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: txUpdate,
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        userCharacter: { findUnique: jest.fn().mockResolvedValue(character), update: jest.fn() },
        user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        userMaterial: { upsert: jest.fn() },
        material: { findMany: jest.fn().mockResolvedValue([]) },
        bankWord: { findMany: jest.fn().mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e'])) },
        runItem: {
          findMany: jest.fn().mockResolvedValue(items),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest.fn().mockImplementation(async (args: unknown) =>
            (args as { _max?: unknown })._max ? { _max: { seq: 19 } } : { _count: items.length }),
        },
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
        userSenseProgress: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
        word: { findMany: jest.fn().mockImplementation(async ({ where }) => (where?.id?.in ?? []).map((id: string) => word(id, id))) },
      }));

      // 上报 37 > 已存 30 → 取 max 持久化并回传
      const r = await svc.advance(1, 1, { answers, expectedDay: 2, playSeconds: 37 });
      expect(r.playSeconds).toBe(37);
      expect(run.playSeconds).toBe(37);
      expect(txUpdate).toHaveBeenCalledWith({ where: { id: run.id }, data: { playSeconds: 37 } });

      // 上报值回退（如 25 < 30）→ 忽略，保留更大值
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const r2 = await svc.advance(1, 1, { answers, expectedDay: 2, playSeconds: 25 });
      expect(r2.playSeconds).toBe(37);
    });

    it('全局连击：首领波答对累计、答错清零，bossUpdate 携带 maxCombo', async () => {
      const items = Array.from({ length: 4 }, (_, i) => ({
        id: 100 + i, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'boss', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 6,
        hp: 10, maxHp: 22, buffs: [], lastInjectDay: 5, surrendered: false,
        recordBroken: false, extra: { __combo: 3 }, maxCombo: 5,
        everBoss: false, lastBossDay: null, lastBossConsumed: null, bossClearedCount: 0,
        status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      mockAdvanceTx(run, items);

      const r = await svc.advance(1, 1, { answers, expectedDay: 6 });
      expect(r.ended).toBe(false);
      expect(r.bossWave).toBe(false); // 击破后距上次首领 gap=0，不会立即重触发
      expect(r.combo).toBe(7); // 3 + 4
      expect((run.extra as Record<string, unknown>).__combo).toBe(7);
      expect(run.maxCombo).toBe(7);
      expect(run.bossClearedCount).toBe(1);
    });

    it('全错即死：结束结算，ended=true', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 3, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: false, elapsedMs: 5000, typed: 'zzzz' }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      // settle 内部调用
      (prisma.run.findUnique as jest.Mock).mockResolvedValue({ extra: {} });
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _count: 20 });
      (prisma.runItem.count as jest.Mock).mockResolvedValue(20);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([
        { id: 1, code: 'essence_1', tier: 1 },
      ]);
      mockAdvanceTx(run, items);

      const r = await svc.advance(1, 1, { answers, expectedDay: 2 });
      expect(r.ended).toBe(true);
      expect(r.result?.surrendered).toBe(false);
      expect(r.result?.daysSurvived).toBe(2);
    });

    it('答错词进入错题本：commitWaveSrs 写 inWrongBook + 次日短间隔', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      // 首题答错，其余答对（避免即死，确保走到 commitWaveSrs）
      const answers = items.map((it, i) => ({
        seq: it.seq, correct: i !== 0, elapsedMs: 5000, typed: i === 0 ? 'zzzz' : it.wordId,
      }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      const upsert = jest.fn().mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: jest.fn().mockResolvedValue(run),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn(),
        },
        userCharacter: { findUnique: jest.fn().mockResolvedValue(character), update: jest.fn() },
        user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        userMaterial: { upsert: jest.fn() },
        material: { findMany: jest.fn().mockResolvedValue([]) },
        bankWord: { findMany: jest.fn().mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e'])) },
        runItem: {
          findMany: jest.fn().mockResolvedValue(items),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest.fn().mockImplementation(async () => ({ _max: { seq: 19 } })),
        },
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert },
        userSenseProgress: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({}),
        },
        word: { findMany: jest.fn().mockImplementation(async ({ where }) =>
          (where?.id?.in ?? []).map((id: string) => word(id, id))) },
      }));

      await svc.advance(1, 1, { answers, expectedDay: 2 });
      // 首词（a，答错）应写入错题本 + wrongStreak 0
      const call = (upsert as jest.Mock).mock.calls.find(
        (c: unknown[]) => (c[0] as { where: { userId_wordId: { wordId: string } } }).where.userId_wordId.wordId === 'a',
      );
      expect(call).toBeDefined();
      const data = (call as unknown[])[0] as { create: { inWrongBook: boolean; wrongStreak: number; nextReviewAt: Date } };
      expect(data.create.inWrongBook).toBe(true);
      expect(data.create.wrongStreak).toBe(0);
      // 进错题本 → 次日（约 1 天）短间隔，而非 SRS 长间隔
      const next = data.create.nextReviewAt.getTime() - Date.now();
      expect(next).toBeGreaterThan(0);
      expect(next).toBeLessThan(2 * 86400000);
    });

    it('首领波重放：bossHp 收敛到实际题数，全对击破且不掉血，正常进入次日', async () => {
      const items = Array.from({ length: 4 }, (_, i) => ({
        id: i + 1, seq: 9000 + i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'boss', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 3,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      mockAdvanceTx(run, items);

      // 引擎口径：bossHp = 实际题数（C1 回归：词池不足时仍可击破）
      const sim = createWaveSim({
        day: 3, atkLv: 1, defLv: 1, maxHp: 22, startHp: 22,
        buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
        legend: { bossImmunity: false, killHeal: false, bossX2: false, noLeakDmg: false },
        questions: items.map(() => ({ tier: 0, isNew: false, isBoss: true, len: 1 })),
        bossWave: true,
        bossHp: items.length,
      });
      for (const _ of items) sim.step(true);

      const r = await svc.advance(1, 1, { answers, expectedDay: 3 });
      expect(r.ended).toBe(false);
      expect(r.day).toBe(4);
      expect(r.hp).toBe(sim.hp);
      expect(r.hp).toBe(22); // 全对击破：不掉血
      expect(r.bossWave).toBe(false);
    });

    it('空波推进：无待答题按全对推进（续 Run 恢复）', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue([]); // 空波
      mockAdvanceTx(run, []);

      const r = await svc.advance(1, 1, { answers: [], expectedDay: 2 });
      expect(r.ended).toBe(false);
      expect(r.day).toBe(3);
      expect(r.hp).toBe(22);
    });

    it('expectedDay 与 run.day 不一致抛 400（防重复提交）', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      mockAdvanceTx(run, []);
      await expect(svc.advance(1, 1, { answers: [], expectedDay: 5 })).rejects.toThrow(BadRequestException);
    });

    it('Boss 波：题 seq 从当前 maxSeq 续接而非固定 9000（回归：多次 Boss 波不再 P2002 → 500）', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 3,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
        lastBossDay: 0, everBoss: false, lastBossConsumed: 0, bossClearedCount: 0,
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue([]); // 空波 → 触发首领波
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          findUnique: jest.fn().mockResolvedValue({ bankId: 10, stageId: 1 }),
          update: jest.fn().mockResolvedValue(run),
        },
        userCharacter: { findUnique: jest.fn().mockResolvedValue(character) },
        user: { findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        runItem: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany,
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
          // 模拟 run 已打过一次首领波（maxSeq 已到 9058）
          aggregate: jest.fn().mockResolvedValue({ _max: { seq: 9058 } }),
        },
        word: { findMany: jest.fn().mockImplementation(async ({ where }) =>
          (where?.id?.in ?? []).map((id: string) => word(id, id))) },
        bankWord: { findMany: jest.fn().mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e'])) },
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]) },
      }));

      const r = await svc.advance(1, 1, { answers: [], expectedDay: 3 });
      expect(r.bossWave).toBe(true);
      const data = (createMany as jest.Mock).mock.calls[0][0].data as {
        seq: number;
        type: string;
      }[];
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]!.seq).toBe(9059); // maxSeq+1 续接，而非固定 9000
      expect(data.every((d, i) => d.seq === 9059 + i)).toBe(true);
      expect(data.every((d) => d.type === 'boss')).toBe(true);
    });

    it('首领波未击破（最后一题答错）：补足剩余 Boss 血量题数续战，不允许直接过关', async () => {
      // 4 题首领波：前 3 对 + 最后一题错 → Boss 剩 1 HP → 补 1 题
      const items = Array.from({ length: 4 }, (_, i) => ({
        id: i + 1, seq: 9000 + i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'boss', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 3,
        hp: 20, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
        lastBossDay: 3, everBoss: true, lastBossConsumed: 0, bossClearedCount: 0,
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(items);
      const answers = items.map((it) => ({ seq: it.seq, correct: it.seq !== 9003, elapsedMs: 5000, typed: it.seq === 9003 ? 'zzzz' : it.wordId }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      const createMany = jest.fn().mockResolvedValue({ count: 1 });
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          findUnique: jest.fn().mockResolvedValue({ bankId: 10, stageId: 1 }),
          update: jest.fn().mockResolvedValue(run),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        userCharacter: { findUnique: jest.fn().mockResolvedValue(character) },
        user: { findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        runItem: {
          findMany: jest.fn().mockResolvedValue(items),
          createMany,
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest.fn().mockResolvedValue({ _max: { seq: 9003 } }),
        },
        word: { findMany: jest.fn().mockImplementation(async ({ where }) =>
          (where?.id?.in ?? []).map((id: string) => word(id, id))) },
        bankWord: { findMany: jest.fn().mockResolvedValue(pool(['a', 'b', 'c', 'd', 'e'])) },
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
        userSenseProgress: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
        material: { findMany: jest.fn().mockResolvedValue([]) },
      }));

      const r = await svc.advance(1, 1, { answers, expectedDay: 3 });
      expect(r.ended).toBe(false);
      // 未击破 → 续战响应（bossWave:true），补足剩余血量题数
      expect(r.bossWave).toBe(true);
      expect(r.bossCleared).toBe(false);
      expect(r.bossHp).toBe(1);
      expect(r.questions).toHaveLength(1);
      expect(r.day).toBe(3); // 仍在首领日，不进入次日
      // 补题落库为 boss 题，seq 从 maxSeq 续接
      const data = (createMany as jest.Mock).mock.calls[0][0].data as { seq: number; type: string }[];
      expect(data).toHaveLength(1);
      expect(data[0]!.seq).toBe(9004);
      expect(data[0]!.type).toBe('boss');
    });
  });

  describe('finish 收枪', () => {
    it('收枪结算：surrendered=true，recordBroken=false', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 7,
        hp: 10, maxHp: 22, buffs: [], lastInjectDay: 5, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.run.findUnique as jest.Mock).mockResolvedValue({ extra: {} });
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _count: 140 });
      (prisma.runItem.count as jest.Mock).mockResolvedValue(10);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([
        { id: 1, code: 'essence_1', tier: 1 },
      ]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        run: { findFirst: jest.fn().mockResolvedValue(run), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        userCharacter: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ userId: 1, level: 1, exp: 0 }) },
        user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        userMaterial: { upsert: jest.fn() },
        runItem: prisma.runItem,
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
        material: prisma.material,
      }));

      const r = await svc.finish(1, 1, { surrender: true });
      expect(r.surrendered).toBe(true);
      expect(r.recordBroken).toBe(false);
      expect(r.daysSurvived).toBe(7);
    });

    it('收枪结算：客户端上报游玩时长入结算展示', async () => {
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 7,
        hp: 10, maxHp: 22, buffs: [], lastInjectDay: 5, surrendered: false,
        recordBroken: false, extra: {}, playSeconds: 0, status: 'active', createdAt: new Date(),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      (prisma.run.findUnique as jest.Mock).mockResolvedValue({ extra: {} });
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _count: 140 });
      (prisma.runItem.count as jest.Mock).mockResolvedValue(10);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([
        { id: 1, code: 'essence_1', tier: 1 },
      ]);
      const txUpdate = jest.fn().mockResolvedValue(run);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        run: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: txUpdate,
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        userCharacter: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ userId: 1, level: 1, exp: 0 }) },
        user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ coins: 100 }) },
        userMaterial: { upsert: jest.fn() },
        runItem: prisma.runItem,
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
        material: prisma.material,
      }));

      const r = await svc.finish(1, 1, { surrender: true, playSeconds: 512 });
      expect(r.playSeconds).toBe(512);
      expect(txUpdate).toHaveBeenCalledWith({ where: { id: run.id }, data: { playSeconds: 512 } });
    });

    it('重复结算抛 400', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue({ id: 1, status: 'finished' });
      await expect(svc.finish(1, 1, { surrender: true })).rejects.toThrow(BadRequestException);
    });

    it('Run 不存在抛 404', async () => {
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.finish(1, 99, { surrender: true })).rejects.toThrow(NotFoundException);
    });
  });

  describe('pickReviews 局内遗忘曲线选词', () => {
    const pick = async (items: { wordId: string; seq: number; correct: boolean }[], opts: {
      poolIds: string[];
      used: string[];
      need: number;
      progress?: { wordId: string; inWrongBook: boolean; mastery: number; nextReviewAt: Date | null; skipped: boolean }[];
      usedInDay?: string[];
    }) => {
      (prisma.runItem.findMany as jest.Mock).mockResolvedValue(
        [...items].sort((a, b) => a.seq - b.seq),
      );
      (prisma.userWordProgress.findMany as jest.Mock).mockResolvedValue(opts.progress ?? []);
      const result = await (svc as unknown as {
        pickReviews: (userId: number, pool: { wordId: string }[], used: Set<string>, need: number, runId: number, tx?: unknown, usedInDay?: Set<string>) => Promise<{ wordId: string }[]>;
      }).pickReviews(
        1,
        pool(opts.poolIds),
        new Set(opts.used),
        opts.need,
        1,
        undefined,
        new Set(opts.usedInDay ?? []),
      );
      return result.map((w) => w.wordId);
    };

    it('未恢复的错词优先；连续答对 3 次的恢复词进入静默期不再被选', async () => {
      // a：seq0 错，seq20-22 连续对 3 次 → 恢复迁回干净队列，且最近刚对 → 静默期
      // b：seq1 才错 → 未恢复错词队列 → 次日高紧迫
      const picked = await pick(
        [
          { wordId: 'a', seq: 0, correct: false },
          { wordId: 'a', seq: 20, correct: true },
          { wordId: 'a', seq: 21, correct: true },
          { wordId: 'a', seq: 22, correct: true },
          { wordId: 'b', seq: 0, correct: true },
          { wordId: 'b', seq: 1, correct: false },
        ],
        { poolIds: ['a', 'b'], used: ['a', 'b'], need: 1 },
      );
      expect(picked).toEqual(['b']);
    });

    it('重复答对多次的词沉底，久未见但已过静默期的词优先', async () => {
      // a：累计答对 5 次、最近一次就在上一波 → 静默期内
      // b：只对过 1 次且是 2 天前 → 已过静默期，紧迫度高
      const picked = await pick(
        [
          { wordId: 'a', seq: 0, correct: true },
          { wordId: 'a', seq: 40, correct: true },
          { wordId: 'a', seq: 41, correct: true },
          { wordId: 'a', seq: 42, correct: true },
          { wordId: 'a', seq: 43, correct: true },
          { wordId: 'b', seq: 0, correct: true },
        ],
        { poolIds: ['a', 'b'], used: ['a', 'b'], need: 1 },
      );
      expect(picked).toEqual(['b']);
    });

    it('skipped 词排除；全局错题本 / 日历到期词纳入（无局内记录走兜底紧迫度）', async () => {
      const now = Date.now();
      const picked = await pick(
        [{ wordId: 'd', seq: 0, correct: true }],
        {
          poolIds: ['d', 's', 'wb', 'due'],
          used: ['d'],
          need: 2,
          progress: [
            { wordId: 'd', inWrongBook: false, mastery: 0, nextReviewAt: null, skipped: false },
            { wordId: 's', inWrongBook: false, mastery: 50, nextReviewAt: null, skipped: true },
            { wordId: 'wb', inWrongBook: true, mastery: 50, nextReviewAt: null, skipped: false },
            { wordId: 'due', inWrongBook: false, mastery: 50, nextReviewAt: new Date(now - 1000), skipped: false },
          ],
        },
      );
      expect(new Set(picked)).toEqual(new Set(['wb', 'due']));
    });

    it('need<=0 返回空', async () => {
      const picked = await pick([], { poolIds: ['a'], used: ['a'], need: 0 });
      expect(picked).toEqual([]);
    });
  });

  describe('buildBossWave Boss 波取词（遗忘曲线）', () => {
    let randSpy: jest.SpyInstance;
    beforeEach(() => {
      // 恒定 rng：去掉紧迫度抖动，选词顺序可断言
      randSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });
    afterEach(() => {
      randSpy.mockRestore();
    });

    const boss = async (answered: { wordId: string; seq: number; correct: boolean; type: string }[], opts: {
      day?: number;
      progress?: { wordId: string; mastery: number; skipped: boolean; reviewStage: number }[];
      poolIds?: string[];
    } = {}) => {
      (prisma.runItem.findMany as jest.Mock).mockImplementation(async ({ where }) => {
        if (where.answered === true && where.correct === undefined) return answered;
        if (where.answered === true && where.correct === false) return []; // pickRecycled 本局错词
        return [];
      });
      (prisma.userWordProgress.findMany as jest.Mock).mockResolvedValue(opts.progress ?? []);
      (prisma.run.findUnique as jest.Mock).mockResolvedValue({ bankId: 10, stageId: 1 });
      (prisma.bankWord.findMany as jest.Mock).mockResolvedValue(pool(opts.poolIds ?? []));
      (prisma.word.findMany as jest.Mock).mockImplementation(async ({ where }) => {
        const ids = where.id.in ?? [];
        return ids.map((id: string) => word(id, id));
      });
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 100 } });
      (prisma.userSenseProgress.findMany as jest.Mock).mockResolvedValue([]);
      const createMany = jest.fn().mockResolvedValue({ count: 0 });
      (prisma.runItem.createMany as jest.Mock).mockImplementation(createMany);

      const result = await (svc as unknown as {
        buildBossWave: (runId: number, userId: number, mode: string, day: number, atkLv: number, tx?: unknown) => Promise<{ wordId: string }[]>;
      }).buildBossWave(1, 1, 'zh2en', opts.day ?? 3, 1);
      const data = (createMany as jest.Mock).mock.calls[0]?.[0]?.data as
        { wordId: string; type: string; seq: number }[] | undefined;
      return { wordIds: result.map((q) => q.wordId), data };
    };

    it('错词按遗忘紧迫度排序：近期错 > 早期错；恢复/静默期词沉底仅补位', async () => {
      const { wordIds } = await boss([
        { wordId: 'due', seq: 0, correct: true, type: 'new' },
        { wordId: 'stale', seq: 1, correct: false, type: 'new' },
        { wordId: 'rec', seq: 5, correct: false, type: 'new' },
        { wordId: 'mid', seq: 20, correct: false, type: 'new' },
        { wordId: 'rec', seq: 21, correct: true, type: 'new' },
        { wordId: 'rec', seq: 22, correct: true, type: 'new' },
        { wordId: 'rec', seq: 23, correct: true, type: 'new' },
        { wordId: 'fresh', seq: 30, correct: false, type: 'new' },
      ]);
      expect(wordIds).toEqual(['fresh', 'mid', 'stale', 'due', 'rec']);
    });

    it('上一波 Boss 已考词被软降权：同紧迫度下未考过词优先', async () => {
      const { wordIds } = await boss(
        [
          { wordId: 'b', seq: 9, correct: false, type: 'new' },
          { wordId: 'a', seq: 10, correct: false, type: 'new' },
          { wordId: 'a', seq: 30, correct: true, type: 'boss' },
        ],
        { day: 1 },
      );
      expect(wordIds).toEqual(['b', 'a']);
    });

    it('skipped 斩词排除（修 bug：斩词永不再考）', async () => {
      const { wordIds } = await boss(
        [
          { wordId: 'b', seq: 0, correct: false, type: 'new' },
          { wordId: 'a', seq: 1, correct: false, type: 'new' },
          { wordId: 'skip', seq: 20, correct: false, type: 'new' },
        ],
        {
          day: 1,
          progress: [
            { wordId: 'skip', mastery: 0, skipped: true, reviewStage: 0 },
            { wordId: 'a', mastery: 0, skipped: false, reviewStage: 0 },
            { wordId: 'b', mastery: 0, skipped: false, reviewStage: 0 },
          ],
        },
      );
      expect(wordIds).toEqual(['a', 'b']);
      expect(wordIds).not.toContain('skip');
    });

    it('错词不足用池内循环抽词兜底，保证题数=need（杜绝必败波）', async () => {
      const { wordIds, data } = await boss(
        [{ wordId: 'only', seq: 5, correct: false, type: 'new' }],
        { day: 3, poolIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] },
      );
      expect(wordIds).toHaveLength(5); // bossHits(3,1)=5
      expect(wordIds).toContain('only');
      expect(new Set(wordIds).size).toBe(5);
      expect(data).toBeDefined();
      expect(data!.every((d) => d.type === 'boss')).toBe(true);
    });
  });
});