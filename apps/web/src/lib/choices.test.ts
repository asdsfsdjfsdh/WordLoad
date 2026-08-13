import { describe, expect, it } from 'vitest';
import type { Question } from '@word-journey/shared';
import { pickOptions, type ChoiceOption } from './choices';

function makeQ(answer: string, answerMeaning: string): Question {
  return {
    seq: 0,
    wordId: 'w1',
    senseIdx: 0,
    type: 'choice',
    prompt: answer,
    template: '',
    blanks: [],
    tier: 'II',
    answer,
    answerMeaning,
  };
}

const pool = (init: Array<{ text: string; meaning: string; confusables?: string[] }>) =>
  init.map((f) => ({ text: f.text, meaning: f.meaning, confusableTexts: f.confusables }));

describe('pickOptions 组选项', () => {
  it('返回包含正确答案的 4 个选项且含义不重复', () => {
    const p = pool([
      { text: 'allow', meaning: '允许' },
      { text: 'alter', meaning: '改变' },
      { text: 'altar', meaning: '祭坛', confusables: ['alter'] },
      { text: 'alloy', meaning: '合金' },
      { text: 'always', meaning: '总是' },
    ]);
    const opts = pickOptions(makeQ('alter', '改变'), p, () => 0.5);
    expect(opts).toHaveLength(4);
    expect(opts.some((o) => o.text === 'alter')).toBe(true);
    const meanings = opts.map((o) => o.meaning);
    expect(new Set(meanings).size).toBe(meanings.length);
    expect(meanings).not.toContain('改变的重复');
  });

  it('排除与正确答案同义/同词项', () => {
    const p = pool([
      { text: 'access', meaning: '进入' },
      { text: 'excess', meaning: '过量' },
      { text: 'assess', meaning: '评估' },
      { text: 'exclaim', meaning: '呼喊' },
      { text: 'alter', meaning: '进入' }, // 同义 → 必须剔除
    ]);
    const opts = pickOptions(makeQ('access', '进入'), p, () => 0.3);
    expect(opts).toHaveLength(4);
    expect(opts.filter((o) => o.meaning === '进入')).toHaveLength(1); // 仅正确答案
  });

  it('候选池不足时只返回可用项（不越界）', () => {
    const p = pool([
      { text: 'allow', meaning: '允许' },
      { text: 'alter', meaning: '改变' },
    ]);
    const opts = pickOptions(makeQ('alpha', '起始'), p, () => 0.3);
    expect(opts).toHaveLength(3);
    expect(opts.some((o) => o.text === 'alpha')).toBe(true);
  });

  it('优先选择易混词作干扰项', () => {
    const p = pool([
      { text: 'angel', meaning: '天使', confusables: ['angle'] },
      { text: 'rank', meaning: '排名' },
      { text: 'orange', meaning: '橙子' },
      { text: 'banana', meaning: '香蕉' },
      { text: 'grape', meaning: '葡萄' },
    ]);
    let options: ChoiceOption[] = [];
    for (let i = 0; i < 200; i++) {
      const opts = pickOptions(makeQ('angle', '角度'), p, () => Math.random());
      if (opts.some((o) => o.text === 'angel')) {
        options = opts;
        break;
      }
    }
    expect(options.some((o) => o.text === 'angel')).toBe(true);
  });

  it('正确答案位置随机且仅出现一次', () => {
    const p = pool([
      { text: 'allow', meaning: '允许' },
      { text: 'alter', meaning: '改变' },
      { text: 'altar', meaning: '祭坛' },
      { text: 'alloy', meaning: '合金' },
    ]);
    let positions = new Set<number>();
    for (let i = 0; i < 120; i++) {
      const opts = pickOptions(makeQ('allow', '允许'), p, () => Math.random());
      const idx = opts.findIndex((o) => o.text === 'allow');
      expect(opts.filter((o) => o.text === 'allow')).toHaveLength(1);
      positions.add(idx);
    }
    expect(positions.size).toBeGreaterThan(1); // 出现过不止一个位置
  });
});