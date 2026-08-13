import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  userSenseProgress: { findMany: jest.fn() },
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
    senses: [{ idx: 0, meaning: `${text}义`, example: `例句${text}` }],
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
  });

  describe('create', () => {
    it('创建首日 Run：20 词上限，全部新词，注入数正确', async () => {
      const created = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en',
        day: 1, hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1,
        surrendered: false, recordBroken: false, extra: {}, status: 'active',
        createdAt: new Date('2026-01-01'),
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(null); // 无旧 Run
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        run: { create: jest.fn().mockResolvedValue(created), update: jest.fn() },
        runItem: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
      }));

      const r = await svc.create(1, { bankCode: 'core', stageId: 1, mode: 'zh2en' });
      expect(r.day).toBe(1);
      expect(r.hp).toBe(22); // 20 + 2×1
      expect(r.injectedNew).toBe(5);
      expect(r.questions).toHaveLength(5);
      expect(r.questions[0]?.isNew).toBe(true);
      expect(r.previewWords).toHaveLength(5);
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

  describe('advance', () => {
    it('普通波全对：吸血生效、HP 不低于上限，次日正确注入', async () => {
      // 20 题全 new
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, seq: i, wordId: String.fromCharCode(97 + i), senseIdx: 0,
        type: 'new', answered: false,
      }));
      const run = {
        id: 1, userId: 1, bankId: 10, stageId: 1, mode: 'zh2en', day: 2,
        hp: 22, maxHp: 22, buffs: [], lastInjectDay: 1, surrendered: false,
        recordBroken: false, extra: {}, status: 'active', createdAt: new Date(),
        items,
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      // 答案全对
      const answers = items.map((it) => ({ seq: it.seq, correct: true, elapsedMs: 5000, typed: it.wordId }));
      // persistAnswers 逐题 update
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      // 次日组题
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        runItem: {
          aggregate: jest.fn().mockResolvedValue({ _max: { seq: 19 } }),
          createMany: jest.fn().mockResolvedValue({ count: 20 }),
        },
        run: {
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ ...run, day: 3, buffs: [] }),
        },
      }));
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 39 } });

      const r = await svc.advance(1, 1, { answers, finalHp: 22 });
      expect(r.ended).toBe(false);
      expect(r.day).toBe(3);
      expect(r.hp).toBe(22); // 客户端权威血量直接采信
      expect(r.bossWave).toBe(false);
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
        items,
      };
      (prisma.run.findFirst as jest.Mock).mockResolvedValue(run);
      const answers = items.map((it) => ({ seq: it.seq, correct: false, elapsedMs: 5000, typed: 'zzzz' }));
      (prisma.runItem.update as jest.Mock).mockResolvedValue({});
      // settle 内部调用
      (prisma.run.findUnique as jest.Mock).mockResolvedValue({ extra: {} });
      (prisma.runItem.aggregate as jest.Mock).mockResolvedValue({ _count: 20 });
      (prisma.runItem.count as jest.Mock).mockResolvedValue(20);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([
        { id: 1, code: 'essence_1', tier: 1 },
      ]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
        run: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        userCharacter: { update: jest.fn() },
        user: { update: jest.fn() },
        userMaterial: { upsert: jest.fn() },
        runItem: { findMany: jest.fn().mockResolvedValue(items) },
        userWordProgress: {
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn(),
        },
      }));

      const r = await svc.advance(1, 1, { answers, finalHp: 0 });
      expect(r.ended).toBe(true);
      expect(r.result?.surrendered).toBe(false);
      expect(r.result?.daysSurvived).toBe(2);
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
        run: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        userCharacter: { update: jest.fn() },
        user: { update: jest.fn() },
        userMaterial: { upsert: jest.fn() },
        runItem: { findMany: jest.fn().mockResolvedValue([]) },
        userWordProgress: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      }));

      const r = await svc.finish(1, 1, { surrender: true });
      expect(r.surrendered).toBe(true);
      expect(r.recordBroken).toBe(false);
      expect(r.daysSurvived).toBe(7);
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
});