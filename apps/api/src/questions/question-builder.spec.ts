import {
  allocBossPool,
  allocExtend,
  allocMix,
  buildFoilPool,
  buildQuestion,
  findConfusable,
  maskTemplate,
  rotateSense,
} from './question-builder';

describe('allocMix 60:25:15', () => {
  it('按比例分配且总和等于输入', () => {
    for (const total of [10, 30, 46, 100]) {
      const m = allocMix(total);
      expect(m.new + m.review + m.wrongbook).toBe(total);
      expect(m.new).toBeGreaterThanOrEqual(m.review);
      expect(m.review).toBeGreaterThanOrEqual(m.wrongbook);
    }
  });
  it('小样本余数归最大来源', () => {
    const m = allocMix(4);
    expect(m.new).toBeGreaterThanOrEqual(2);
  });
  it('0 输入返回 0', () => {
    expect(allocMix(0)).toEqual({ new: 0, review: 0, wrongbook: 0 });
  });
});

describe('rotateSense 义项轮换', () => {
  it('优先未测过的义项', () => {
    const picked = rotateSense([
      { idx: 0, reviewStage: 1, lastTestedAt: 100 },
      { idx: 1, reviewStage: 0, lastTestedAt: 0 },
    ]);
    expect(picked).toBe(1);
  });
  it('同 stage 优先最久未测（lastTestedAt 更早）', () => {
    const picked = rotateSense([
      { idx: 0, reviewStage: 0, lastTestedAt: 500 },
      { idx: 1, reviewStage: 0, lastTestedAt: 100 },
    ]);
    expect(picked).toBe(1);
  });
  it('空列表回退 0', () => {
    expect(rotateSense([])).toBe(0);
  });
});

describe('findConfusable 易混补抽', () => {
  const pairs = [
    { wordA: 'principal', wordB: 'principle', type: 'orthographic' as const },
    { wordA: 'cite', wordB: 'site', type: 'homophone' as const },
  ];
  it('命中 A→B', () => {
    expect(findConfusable('principal', pairs)).toBe('principle');
  });
  it('命中 B→A（反向）', () => {
    expect(findConfusable('site', pairs)).toBe('cite');
  });
  it('未命中返回 null', () => {
    expect(findConfusable('apple', pairs)).toBeNull();
  });
});

describe('maskTemplate 挖空模板', () => {
  it('替换指定索引为下划线并记录位置', () => {
    const { template, blanks } = maskTemplate('principal', [1, 2, 3]);
    expect(template).toBe('p___cipal');
    expect(blanks).toEqual([1, 2, 3]);
  });
  it('越界索引被忽略', () => {
    const { template } = maskTemplate('cat', [0, 5]);
    expect(template).toBe('_at');
  });
  it('空挖空不改变原词', () => {
    expect(maskTemplate('cat', []).template).toBe('cat');
  });
});

describe('buildFoilPool 选中文候选池打包', () => {
  it('打包 text/meaning，易混词形放入 confusableTexts', () => {
    const pool = buildFoilPool([
      { text: 'alter', meaning: '改变', confusableTexts: ['altar'] },
      { text: 'altar', meaning: '祭坛', confusableTexts: ['alter'] },
      { text: 'plain', meaning: '平原', confusableTexts: [] },
    ]);
    expect(pool).toEqual([
      { text: 'alter', meaning: '改变', confusableTexts: ['altar'] },
      { text: 'altar', meaning: '祭坛', confusableTexts: ['alter'] },
      { text: 'plain', meaning: '平原', confusableTexts: undefined },
    ]);
  });
});

describe('buildQuestion 出题', () => {
  const base = {
    seq: 1,
    wordId: 'w1',
    senseIdx: 0,
    text: 'access',
    promptBase: '接近；入口',
    tier: 'II' as const,
  };
  it('中译英：保留首字母挖空，example 字段携带例句', () => {
    const q = buildQuestion({ ...base, mode: 'zh2en', example: 'have access to' });
    expect(q.type).toBe('fill-blank');
    expect(q.template).toBe('a_____');
    expect(q.blanks).toEqual([1, 2, 3, 4, 5]);
    expect(q.prompt).toBe('接近；入口');
    expect(q.example).toBe('have access to');
  });
  it('听写：保留首尾字母挖空', () => {
    const q = buildQuestion({ ...base, mode: 'dictation' });
    expect(q.template).toBe('a____s');
  });
  it('无例句时 example 缺省', () => {
    const q = buildQuestion({ ...base, mode: 'zh2en' });
    expect(q.example).toBeUndefined();
  });
  it('选中文：英文打底、answerMeaning 携带释义、不挖空', () => {
    const q = buildQuestion({ ...base, mode: 'choice' });
    expect(q.type).toBe('choice');
    expect(q.prompt).toBe('access');
    expect(q.answerMeaning).toBe('接近；入口');
    expect(q.template).toBe('');
    expect(q.blanks).toEqual([]);
  });
});

describe('allocBossPool Boss 段词池', () => {
  const rng = (): number => 0.5; // 确定性随机

  it('错词全部入选', () => {
    const pool = allocBossPool({ wrong: ['a', 'b'], passed: [], history: [] }, rng);
    expect(pool).toContain('a');
    expect(pool).toContain('b');
    expect(pool.length).toBe(2);
  });

  it('通过词按比例随机取样', () => {
    const pool = allocBossPool({ wrong: ['w1'], passed: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'], history: [], passedRatio: 0.25 }, rng);
    expect(pool[0]).toBe('w1');
    expect(pool.length).toBeLessThanOrEqual(4); // 1 wrong + 25% of 8 ≈ 2 (rng=0.5 rejects half) ≈ ≤4
  });

  it('超容量截断', () => {
    const pool = allocBossPool({ wrong: Array.from({ length: 25 }, (_, i) => `w${i}`), passed: [], history: [], capacity: 20 }, rng);
    expect(pool.length).toBe(20);
  });

  it('空池返回空', () => {
    expect(allocBossPool({ wrong: [], passed: [], history: [] }, rng)).toEqual([]);
  });
});

describe('allocExtend Boss extend', () => {
  const rng = (): number => 0;

  it('本批错词优先且去重', () => {
    const pool = allocExtend({ batchWrong: ['a', 'b'], history: [], unseen: [], used: new Set(), capacity: 6 }, rng);
    expect(pool).toContain('a');
    expect(pool).toContain('b');
  });

  it('跳过已用词', () => {
    const pool = allocExtend({ batchWrong: ['a', 'b'], history: [], unseen: [], used: new Set(['a']), capacity: 6 }, rng);
    expect(pool).not.toContain('a');
    expect(pool).toContain('b');
  });

  it('历史错词补位', () => {
    const pool = allocExtend({ batchWrong: ['a'], history: ['h1', 'h2'], unseen: [], used: new Set(), capacity: 6 }, rng);
    expect(pool).toContain('a');
    expect(pool.length).toBe(3);
  });

  it('未学词兜底', () => {
    const pool = allocExtend({ batchWrong: [], history: [], unseen: ['u1', 'u2', 'u3'], used: new Set(), capacity: 6 }, rng);
    expect(pool.length).toBe(3);
  });

  it('全部耗尽返回空', () => {
    const pool = allocExtend({ batchWrong: [], history: [], unseen: [], used: new Set(), capacity: 6 }, rng);
    expect(pool).toEqual([]);
  });
});