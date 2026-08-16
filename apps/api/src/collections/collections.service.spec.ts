import { CollectionsService } from './collections.service';

const prisma = {
  userWordProgress: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  wordPair: { findMany: jest.fn() },
  word: { findUnique: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
};
const service = new CollectionsService(prisma as never);

beforeEach(() => jest.clearAllMocks());

describe('listWords', () => {
  const mockEmpty = () => {
    prisma.userWordProgress.findMany.mockResolvedValue([]);
    prisma.userWordProgress.count.mockResolvedValue(0);
    prisma.wordPair.findMany.mockResolvedValue([]);
  };

  it('learning 过滤排除错题本与已斩（与 stats.learning 口径一致）', async () => {
    mockEmpty();
    await service.listWords(1, { status: 'learning', sort: 'stage' });
    expect(prisma.userWordProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, mastery: { gt: 0, lt: 100 }, inWrongBook: false, skipped: false },
        orderBy: [{ reviewStage: 'desc' }, { firstEncounteredAt: 'desc' }],
      }),
    );
  });

  it('due 过滤：已到期 + 未掌握 + 未斩，自动按 nextReviewAt 升序', async () => {
    mockEmpty();
    await service.listWords(1, { status: 'due' });
    const call = (prisma.userWordProgress.findMany as jest.Mock).mock.calls[0]![0];
    expect(call.where).toEqual(expect.objectContaining({
      userId: 1,
      nextReviewAt: { lte: expect.any(Date) },
      mastery: { lt: 100 },
      skipped: false,
    }));
    expect(call.orderBy).toEqual([{ nextReviewAt: 'asc' }, { wordId: 'asc' }]);
  });

  it('搜索同时匹配英文词形与中文释义', async () => {
    mockEmpty();
    await service.listWords(1, { search: '放弃', sort: 'firstEncounteredAt' });
    const call = (prisma.userWordProgress.findMany as jest.Mock).mock.calls[0]![0];
    expect(call.where.word.OR).toEqual([
      { text: { contains: '放弃' } },
      { senses: { some: { meaning: { contains: '放弃' } } } },
    ]);
  });

  it('DTO 输出携带 SRS 字段与 bankCode', async () => {
    const row = {
      wordId: 'w1',
      reviewStage: 3,
      ease: 2.6,
      mastery: 100,
      inWrongBook: false,
      skipped: false,
      firstEncounteredAt: new Date('2026-08-10T00:00:00.000Z'),
      nextReviewAt: new Date('2026-08-20T00:00:00.000Z'),
      word: {
        id: 'w1',
        text: 'abandon',
        phoneticAm: '/x/',
        phoneticEn: null,
        tier: 'II',
        mnemonic: '拆解联想',
        senses: [
          { idx: 0, meaning: '放弃', example: 'abandon the plan' },
          { idx: 1, meaning: '放纵', example: 'abandon oneself' },
        ],
        bankWords: [{ bank: { code: 'kaoyan_engl1' } }],
      },
    };
    prisma.userWordProgress.findMany.mockResolvedValue([row]);
    prisma.userWordProgress.count.mockResolvedValue(1);
    prisma.wordPair.findMany.mockResolvedValue([]);

    const { words } = await service.listWords(1, { sort: 'firstEncounteredAt' });
    expect(words[0]).toMatchObject({
      wordId: 'w1',
      text: 'abandon',
      tier: 'II',
      reviewStage: 3,
      ease: 2.6,
      nextReviewAt: '2026-08-20T00:00:00.000Z',
      bankCode: 'kaoyan_engl1',
      meanings: [{ meaning: '放弃', example: 'abandon the plan' }, { meaning: '放纵', example: 'abandon oneself' }],
    });
  });
});

describe('srsTrajectory', () => {
  it('组装 points（intervalDays 派生）+ current + 词详情', async () => {
    prisma.word.findUnique.mockResolvedValue({
      id: 'w1',
      text: 'abandon',
      phoneticAm: '/x/',
      phoneticEn: null,
      tier: 'II',
      mnemonic: '拆解联想',
      senses: [
        { idx: 0, meaning: '放弃', example: 'abandon the plan' },
        { idx: 1, meaning: '放纵', example: 'abandon oneself' },
      ],
    });
    prisma.userWordProgress.findUnique.mockResolvedValue({
      reviewStage: 3,
      ease: 2.6,
      mastery: 100,
      nextReviewAt: new Date('2026-08-20T00:00:00.000Z'),
      inWrongBook: false,
      skipped: false,
      srsHistory: [
        { stage: 1, at: '2026-08-10T00:00:00.000Z' },
        { stage: 2, at: '2026-08-13T00:00:00.000Z' },
        { stage: 3, at: '2026-08-15T00:00:00.000Z' },
      ],
    });
    prisma.wordPair.findMany
      .mockResolvedValueOnce([{ wordB: { text: 'abundant' }, type: 'orthographic', note: '形近' }])
      .mockResolvedValueOnce([{ wordA: { text: 'bandon' }, type: 'homophone', note: '音近' }]);

    const t = await service.srsTrajectory(1, 'w1');
    expect(t.points).toEqual([
      { stage: 1, intervalDays: 1, at: '2026-08-10T00:00:00.000Z' },
      { stage: 2, intervalDays: 3, at: '2026-08-13T00:00:00.000Z' },
      { stage: 3, intervalDays: 7, at: '2026-08-15T00:00:00.000Z' },
    ]);
    expect(t.current).toEqual({
      stage: 3,
      ease: 2.6,
      mastery: 100,
      nextReviewAt: '2026-08-20T00:00:00.000Z',
      inWrongBook: false,
      skipped: false,
    });
    expect(t.lastReviewedAt).toBe('2026-08-15T00:00:00.000Z');
    expect(t.word.text).toBe('abandon');
    expect(t.word.meanings).toHaveLength(2);
    expect(t.word.confusables).toEqual([
      { counterpart: 'abundant', type: 'orthographic', note: '形近' },
      { counterpart: 'bandon', type: 'homophone', note: '音近' },
    ]);
  });

  it('空档位史 → points 为空、lastReviewedAt 为 null', async () => {
    prisma.word.findUnique.mockResolvedValue({
      id: 'w1', text: 'abandon', phoneticAm: null, phoneticEn: null, tier: 'I', mnemonic: null,
      senses: [{ idx: 0, meaning: '放弃', example: 'ex' }],
    });
    prisma.userWordProgress.findUnique.mockResolvedValue({
      reviewStage: 1, ease: 2.5, mastery: 33, nextReviewAt: null, inWrongBook: false, skipped: false,
      srsHistory: [],
    });
    prisma.wordPair.findMany.mockResolvedValue([]);
    const t = await service.srsTrajectory(1, 'w1');
    expect(t.points).toEqual([]);
    expect(t.lastReviewedAt).toBeNull();
  });
});

describe('stats', () => {
  it('byTier 用 groupBy 聚合、dueToday 口径正确', async () => {
    prisma.word.groupBy.mockResolvedValue([
      { tier: 'I', _count: { _all: 100 } },
      { tier: 'II', _count: { _all: 80 } },
      { tier: 'III', _count: { _all: 50 } },
      { tier: 'IV', _count: { _all: 20 } },
    ]);
    const now = Date.now();
    prisma.userWordProgress.findMany.mockResolvedValue([
      { wordId: 'a', mastery: 100, skipped: false, inWrongBook: false, firstEncounteredAt: null, nextReviewAt: null },
      { wordId: 'b', mastery: 50, skipped: false, inWrongBook: false, firstEncounteredAt: new Date(), nextReviewAt: new Date(now - 1000) },
      { wordId: 'c', mastery: 50, skipped: true, inWrongBook: false, firstEncounteredAt: null, nextReviewAt: new Date(now - 1000) },
      { wordId: 'd', mastery: 30, skipped: false, inWrongBook: true, firstEncounteredAt: null, nextReviewAt: null },
    ]);
    prisma.word.findMany.mockResolvedValue([
      { id: 'a', tier: 'I' },
      { id: 'b', tier: 'II' },
      { id: 'c', tier: 'III' },
      { id: 'd', tier: 'IV' },
    ]);

    const s = await service.stats(1);
    expect(s.totalWords).toBe(250);
    expect(s.encountered).toBe(4);
    expect(s.mastered).toBe(1);
    expect(s.learning).toBe(1); // 仅 b（c 已斩、d 错题本、a 已掌握均排除）
    expect(s.dueToday).toBe(1); // 仅 b：到期 + 未掌握 + 未斩
    expect(s.wrongbook).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.byTier.find((x) => x.tier === 'I')).toEqual({ tier: 'I', total: 100, encountered: 1 });
    expect(s.byTier.find((x) => x.tier === 'II')).toEqual({ tier: 'II', total: 80, encountered: 1 });
  });
});
