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

  it('weak 过滤：累计答错≥3 + 未掌握 + 未斩', async () => {
    mockEmpty();
    await service.listWords(1, { status: 'weak', sort: 'weakest' });
    expect(prisma.userWordProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, wrongCount: { gte: 3 }, mastery: { lt: 100 }, skipped: false },
        orderBy: [{ wrongCount: 'desc' }, { firstEncounteredAt: 'desc' }],
      }),
    );
  });

  it('vocabbook 过滤：生词本', async () => {
    mockEmpty();
    await service.listWords(1, { status: 'vocabbook', sort: 'firstEncounteredAt' });
    expect(prisma.userWordProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, inVocabBook: true },
      }),
    );
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

  it('DTO 输出携带 SRS 字段、易错/生词本/掌握时间与 bankCode', async () => {
    const row = {
      wordId: 'w1',
      reviewStage: 3,
      ease: 2.6,
      mastery: 100,
      inWrongBook: false,
      inVocabBook: true,
      skipped: false,
      wrongCount: 5,
      masteredAt: new Date('2026-08-15T00:00:00.000Z'),
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
      inVocabBook: true,
      wrongCount: 5,
      masteredAt: '2026-08-15T00:00:00.000Z',
      bankCode: 'kaoyan_engl1',
      meanings: [{ meaning: '放弃', example: 'abandon the plan' }, { meaning: '放纵', example: 'abandon oneself' }],
    });
  });
});

describe('listWordIds', () => {
  it('weak 全量 ids + 词书 code（不带分页 where）', async () => {
    prisma.userWordProgress.findMany.mockResolvedValue([
      { wordId: 'w1', word: { bankWords: [{ bank: { code: 'kaoyan_engl1' } }] } },
      { wordId: 'w2', word: { bankWords: [] } },
    ]);
    const res = await service.listWordIds(1, { status: 'weak' });
    expect(res.wordIds).toEqual(['w1', 'w2']);
    expect(res.bankCode).toBe('kaoyan_engl1');
    const call = (prisma.userWordProgress.findMany as jest.Mock).mock.calls[0]![0];
    expect(call.where).toEqual(expect.objectContaining({
      userId: 1,
      wrongCount: { gte: 3 },
      mastery: { lt: 100 },
      skipped: false,
    }));
    expect(call.take).toBe(60);
  });

  it('空集 → bankCode undefined', async () => {
    prisma.userWordProgress.findMany.mockResolvedValue([]);
    const res = await service.listWordIds(1, { status: 'weak' });
    expect(res.wordIds).toEqual([]);
    expect(res.bankCode).toBeUndefined();
  });

  it('shuffle=true：全量拉取（无 take）后随机截断，且携带 tier/search 过滤', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      wordId: 'w' + (i + 1),
      word: { bankWords: [{ bank: { code: 'hongbaoshu_engl1' } }] },
    }));
    prisma.userWordProgress.findMany.mockResolvedValue(rows);
    const res = await service.listWordIds(1, { status: 'learning', tier: 'I', search: 'ab', limit: 3, shuffle: true });
    const call = (prisma.userWordProgress.findMany as jest.Mock).mock.calls[0]![0];
    // 随机抽取：不取 orderBy / take（全量洗牌后内存截断）
    expect(call.take).toBeUndefined();
    expect(call.orderBy).toBeUndefined();
    // tier + search 过滤透传
    expect(call.where.word.tier).toBe('I');
    expect(call.where.word.OR).toEqual([
      { text: { contains: 'ab' } },
      { senses: { some: { meaning: { contains: 'ab' } } } },
    ]);
    // 结果是从全量池中截取的子集（长度 ≤ limit，且不重复）
    expect(res.wordIds.length).toBe(3);
    expect(new Set(res.wordIds).size).toBe(3);
    expect(res.wordIds.every((id) => rows.some((r) => r.wordId === id))).toBe(true);
    expect(res.bankCode).toBe('hongbaoshu_engl1');
  });
});

describe('srsTrajectory', () => {
  it('组装 points（intervalDays 派生）+ current(含 masteredAt) + 词详情 + confusable wordId', async () => {
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
      masteredAt: new Date('2026-08-15T00:00:00.000Z'),
      srsHistory: [
        { stage: 1, at: '2026-08-10T00:00:00.000Z' },
        { stage: 2, at: '2026-08-13T00:00:00.000Z' },
        { stage: 3, at: '2026-08-15T00:00:00.000Z' },
      ],
    });
    prisma.wordPair.findMany
      .mockResolvedValueOnce([{ wordAId: 'w1', wordB: { text: 'abundant', id: 'w2' }, type: 'orthographic', note: '形近' }])
      .mockResolvedValueOnce([{ wordBId: 'w1', wordA: { text: 'bandon', id: 'w3' }, type: 'homophone', note: '音近' }]);

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
      masteredAt: '2026-08-15T00:00:00.000Z',
    });
    expect(t.lastReviewedAt).toBe('2026-08-15T00:00:00.000Z');
    expect(t.word.text).toBe('abandon');
    expect(t.word.meanings).toHaveLength(2);
    expect(t.word.confusables).toEqual([
      { counterpart: 'abundant', type: 'orthographic', note: '形近', wordId: 'w2' },
      { counterpart: 'bandon', type: 'homophone', note: '音近', wordId: 'w3' },
    ]);
  });

  it('空档位史 → points 为空、lastReviewedAt 为 null、masteredAt null', async () => {
    prisma.word.findUnique.mockResolvedValue({
      id: 'w1', text: 'abandon', phoneticAm: null, phoneticEn: null, tier: 'I', mnemonic: null,
      senses: [{ idx: 0, meaning: '放弃', example: 'ex' }],
    });
    prisma.userWordProgress.findUnique.mockResolvedValue({
      reviewStage: 1, ease: 2.5, mastery: 33, nextReviewAt: null, inWrongBook: false, skipped: false,
      masteredAt: null,
      srsHistory: [],
    });
    prisma.wordPair.findMany.mockResolvedValue([]);
    const t = await service.srsTrajectory(1, 'w1');
    expect(t.points).toEqual([]);
    expect(t.lastReviewedAt).toBeNull();
    expect(t.current.masteredAt).toBeNull();
  });
});

describe('stats', () => {
  it('byTier 用 groupBy 聚合、dueToday/weak/vocabbook/stageHistogram/masteredToday 口径正确', async () => {
    prisma.word.groupBy.mockResolvedValue([
      { tier: 'I', _count: { _all: 100 } },
      { tier: 'II', _count: { _all: 80 } },
      { tier: 'III', _count: { _all: 50 } },
      { tier: 'IV', _count: { _all: 20 } },
    ]);
    const now = Date.now();
    prisma.userWordProgress.findMany.mockResolvedValue([
      // a: 已掌握，今日掌握 → masteredToday 计入
      { wordId: 'a', mastery: 100, skipped: false, inWrongBook: false, inVocabBook: false, wrongCount: 0, reviewStage: 5, masteredAt: new Date(now), firstEncounteredAt: null, nextReviewAt: null, word: { tier: 'I' } },
      // b: 学习中 + 到期 + 易错（答错≥3）→ learning/dueToday/weak/vocabbook 各计入
      { wordId: 'b', mastery: 50, skipped: false, inWrongBook: false, inVocabBook: true, wrongCount: 3, reviewStage: 2, masteredAt: null, firstEncounteredAt: new Date(), nextReviewAt: new Date(now - 1000), word: { tier: 'II' } },
      // c: 已斩 → 排除出 histogram
      { wordId: 'c', mastery: 50, skipped: true, inWrongBook: false, inVocabBook: false, wrongCount: 1, reviewStage: 6, masteredAt: null, firstEncounteredAt: null, nextReviewAt: new Date(now - 1000), word: { tier: 'III' } },
      // d: 错题本，答错仅 1 → 不算易错
      { wordId: 'd', mastery: 30, skipped: false, inWrongBook: true, inVocabBook: false, wrongCount: 1, reviewStage: 1, masteredAt: null, firstEncounteredAt: null, nextReviewAt: null, word: { tier: 'IV' } },
    ]);

    const s = await service.stats(1);
    expect(s.totalWords).toBe(250);
    expect(s.encountered).toBe(4);
    expect(s.mastered).toBe(1);
    expect(s.learning).toBe(1); // 仅 b（c 已斩、d 错题本、a 已掌握均排除）
    expect(s.dueToday).toBe(1); // 仅 b：到期 + 未掌握 + 未斩
    expect(s.wrongbook).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.weak).toBe(1); // 仅 b：答错≥3 + 未掌握 + 未斩
    expect(s.vocabbook).toBe(1); // 仅 b
    expect(s.masteredToday).toBe(1); // 仅 a
    expect(s.stageHistogram).toEqual([
      { stage: 0, count: 0 },
      { stage: 1, count: 1 }, // d
      { stage: 2, count: 1 }, // b
      { stage: 3, count: 0 },
      { stage: 4, count: 0 },
      { stage: 5, count: 1 }, // a（c 已斩排除）
    ]);
    expect(s.byTier.find((x) => x.tier === 'I')).toEqual({ tier: 'I', total: 100, encountered: 1 });
    expect(s.byTier.find((x) => x.tier === 'II')).toEqual({ tier: 'II', total: 80, encountered: 1 });
  });
});