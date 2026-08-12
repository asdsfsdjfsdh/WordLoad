import {
  allocMix,
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
});