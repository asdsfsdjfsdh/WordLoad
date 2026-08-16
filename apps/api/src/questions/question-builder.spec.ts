import {
  allocBossPool,
  allocExtend,
  allocMix,
  allocSessionMix,
  blankIndexesFor,
  buildFoilPool,
  buildQuestion,
  findConfusable,
  hintLevelFor,
  maskTemplate,
  pickWeighted,
  rotateSense,
} from './question-builder';

const w = (wordId: string) => ({ wordId });

describe('pickWeighted 加权随机抽词', () => {
  const seq = (arr: number[]) => {
    let i = 0;
    return () => arr[i++] ?? 0;
  };

  it('无放回且数量受 count 约束', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(w);
    const picked = pickWeighted(items, 3, () => 1, seq([0, 0, 0, 0, 0]));
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.wordId)).size).toBe(3);
    expect(pickWeighted(items, 99, () => 1, seq([0]))).toHaveLength(5);
    expect(pickWeighted(items, 0, () => 1, seq([0]))).toHaveLength(0);
  });

  it('全 0 权重退化为随机（仍无放回）', () => {
    const items = ['a', 'b', 'c'].map(w);
    const picked = pickWeighted(items, 2, () => 0, seq([0, 0, 0, 0]));
    expect(picked).toHaveLength(2);
  });

  it('高权重项更易被抽中（确定性 rng 下先抽高权重）', () => {
    const items = ['a', 'b', 'c'].map(w);
    // rng=0.05 → 落在总权重 [8,9,10] 的前 8/10 → 抽中 'a'（权重 8）
    const picked = pickWeighted(items, 2, (it) => (it.wordId === 'a' ? 8 : it.wordId === 'b' ? 1 : 1), seq([0.05, 0.0]));
    expect(picked[0]!.wordId).toBe('a');
  });
});

describe('allocSessionMix 7:2:1', () => {
  it('按 7:2:1 抽足 20 词（14 新 / 4 复习 / 2 错题）', () => {
    const fresh = Array.from({ length: 20 }, (_, i) => w(`n${i}`));
    const review = Array.from({ length: 10 }, (_, i) => w(`r${i}`));
    const wrongbook = Array.from({ length: 10 }, (_, i) => w(`b${i}`));
    const picked = allocSessionMix({ fresh, review, wrongbook, size: 20 });
    expect(picked).toHaveLength(20);
    expect(picked.filter((x) => x.wordId.startsWith('n')).length).toBe(14);
    expect(picked.filter((x) => x.wordId.startsWith('r')).length).toBe(4);
    expect(picked.filter((x) => x.wordId.startsWith('b')).length).toBe(2);
  });
  it('复习不足时缺额由新词补足', () => {
    const fresh = Array.from({ length: 20 }, (_, i) => w(`n${i}`));
    const review = Array.from({ length: 1 }, (_, i) => w(`r${i}`));
    const wrongbook = Array.from({ length: 1 }, (_, i) => w(`b${i}`));
    const picked = allocSessionMix({ fresh, review, wrongbook, size: 20 });
    expect(picked).toHaveLength(20);
    expect(picked.filter((x) => x.wordId.startsWith('n')).length).toBe(18);
    expect(picked.filter((x) => x.wordId.startsWith('r')).length).toBe(1);
    expect(picked.filter((x) => x.wordId.startsWith('b')).length).toBe(1);
  });
  it('全部池均不足时按可用总量返回', () => {
    const picked = allocSessionMix({
      fresh: [w('n0')],
      review: [w('r0')],
      wrongbook: [w('b0')],
      size: 20,
    });
    expect(picked).toHaveLength(3);
  });
  it('size=0 返回空', () => {
    expect(allocSessionMix({ fresh: [w('n0')], review: [], wrongbook: [], size: 0 })).toEqual([]);
  });
});

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
  it('打包 text/meaning/meanings，易混词形放入 confusableTexts', () => {
    const pool = buildFoilPool([
      { text: 'alter', meaning: '改变', meanings: ['改变', '修改'], confusableTexts: ['altar'] },
      { text: 'altar', meaning: '祭坛', meanings: ['祭坛'], confusableTexts: ['alter'] },
      { text: 'plain', meaning: '平原', meanings: [], confusableTexts: [] },
    ]);
    expect(pool).toEqual([
      { text: 'alter', meaning: '改变', meanings: ['改变', '修改'], confusableTexts: ['altar'] },
      { text: 'altar', meaning: '祭坛', meanings: ['祭坛'], confusableTexts: ['alter'] },
      { text: 'plain', meaning: '平原', meanings: undefined, confusableTexts: undefined },
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

describe('hintLevel 提示强度（合意难度，随掌握度/复习次数收紧）', () => {
  // 可复现的伪随机源（mulberry32），保证仿真用例不因 Math.random 抖动而偶发失败
  const mulberry32 = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // 简化 SRS 仿真：每次复习按正确率（skill）推进 mastery / reviewStage，考察提示强度随学习进程的变化
  const srs = (skill: number, reviews: number, rand: () => number = Math.random): number[] => {
    let mastery = 20;
    let stage = 1;
    const snap: number[] = [];
    for (let i = 0; i < reviews; i++) {
      const correct = rand() < skill;
      if (correct) {
        stage = Math.min(6, stage + (rand() < 0.7 ? 1 : 0));
        mastery = Math.min(100, mastery + 8 + (stage >= 3 ? 4 : 0));
      } else {
        stage = Math.max(0, stage - 1);
        mastery = Math.max(5, mastery - 6);
      }
      snap.push(hintLevelFor(mastery, stage));
    }
    return snap;
  };

  it('新词永远 L0（最友好提示），即便其余词条已高掌握', () => {
    expect(hintLevelFor(100, 6, 'new')).toBe(0);
  });

  it('阈值边界精确：mastery 与 reviewStage 双条件共同决定档位', () => {
    expect(hintLevelFor(0, 0)).toBe(0);
    expect(hintLevelFor(49, 3)).toBe(0); // 掌握度不足 50 → 仍 L0
    expect(hintLevelFor(50, 3)).toBe(1);
    expect(hintLevelFor(79, 5)).toBe(1);
    expect(hintLevelFor(80, 5)).toBe(2);
    expect(hintLevelFor(90, 4)).toBe(1); // 复习次数不足 → 收敛到 L1
  });

  it('仿真：纯上升学习路径（全对）提示强度只升不降，并最终到 L2', () => {
    const snap = srs(1, 12, mulberry32(42));
    for (let i = 1; i < snap.length; i++) {
      expect(snap[i]).toBeGreaterThanOrEqual(snap[i - 1]!);
    }
    expect(snap[snap.length - 1]).toBe(2);
  });

  it('仿真：高正确率学习者 12 次复习内可达 L2（允许中途偶发回落）', () => {
    for (let run = 0; run < 5; run++) {
      expect(srs(0.9, 12, mulberry32(run))).toContain(2);
    }
  });

  it('仿真：低正确率学习者 12 次复习内不达 L2（提示始终偏友好）', () => {
    for (let run = 0; run < 5; run++) {
      const snap = srs(0.4, 12, mulberry32(100 + run));
      expect(snap[snap.length - 1]).toBeLessThan(2);
    }
  });

  it('挖空档位 L0：中译英保留首字母，听写保留首尾', () => {
    expect(blankIndexesFor('zh2en', 6, 0)).toEqual([1, 2, 3, 4, 5]);
    expect(blankIndexesFor('dictation', 6, 0)).toEqual([1, 2, 3, 4]);
    expect(blankIndexesFor('dictation', 2, 0)).toEqual([]); // 短词保留全部
  });

  it('挖空档位 L1：中译英全挖空，听写仅保留首字母', () => {
    expect(blankIndexesFor('zh2en', 6, 1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(blankIndexesFor('dictation', 6, 1)).toEqual([1, 2, 3, 4, 5]);
  });

  it('挖空档位 L2：两种模式都全挖空（仅释义/音标提示）', () => {
    expect(blankIndexesFor('zh2en', 6, 2)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(blankIndexesFor('dictation', 6, 2)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('buildQuestion 按 hintLevel 产出不同挖空模板（L0 首字母 → L1 全空）', () => {
    const base = { seq: 1, wordId: 'w', senseIdx: 0, text: 'access', promptBase: '接近', tier: 'II' as const, mode: 'zh2en' as const };
    expect(buildQuestion({ ...base, hintLevel: 0 }).template).toBe('a_____');
    expect(buildQuestion({ ...base, hintLevel: 1 }).template).toBe('______');
    expect(buildQuestion({ ...base, hintLevel: 2 }).template).toBe('______');
  });
});

describe('allocBossPool Boss 段词池', () => {  const rng = (): number => 0.5; // 确定性随机

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