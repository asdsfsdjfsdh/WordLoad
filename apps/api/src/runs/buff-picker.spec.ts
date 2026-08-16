import { pickBuffs, pickLegends } from './buff-picker';

const WHITE = new Set(['maxhp', 'dmg', 'leech', 'dodge', 'freeze']);
const PURPLE = new Set(['regen', 'combo', 'freezeAll', 'execute']);

describe('buff-picker 上下文感知', () => {
  it('HP<30% 必含防御项', () => {
    const picks = pickBuffs({ hp: 6, maxHp: 22, codes: [], day: 4 });
    expect(picks).toHaveLength(3);
    expect(picks.some((b) => b === 'dodge' || b === 'leech' || b === 'maxhp' || b === 'armor')).toBe(true);
  });

  it('acc<0.75 加权保命（吸血/免伤）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 4, recentAcc: 0.6 });
    expect(picks.some((b) => b === 'leech' || b === 'dodge' || b === 'armor')).toBe(true);
  });

  it('acc≥0.85 加权提速（伤害/冻结/触发技）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 4, recentAcc: 0.9 });
    expect(picks.some((b) => b === 'dmg' || b === 'freeze' || b === 'crit' || PURPLE.has(b))).toBe(true);
  });

  it('首领前一日必含对策（免伤优先）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 4, bossSoon: true });
    expect(picks).toContain('dodge');
  });

  it('已达叠加上限的 buff 被剔除', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: ['maxhp', 'maxhp', 'maxhp'], day: 4 });
    expect(picks).not.toContain('maxhp');
  });

  it('稀有度按天解锁：白+蓝满叠后 day1 为空、day4 出紫色', () => {
    const codes = [
      'maxhp', 'maxhp', 'maxhp',
      'dmg', 'dmg', 'dmg',
      'leech', 'leech',
      'dodge', 'dodge',
      'freeze', 'freeze',
      'crit', 'crit', 'crit',
      'armor', 'armor', 'armor',
      'thorns', 'thorns',
    ];
    expect(pickBuffs({ hp: 15, maxHp: 22, codes, day: 1 })).toHaveLength(0);
    const d4 = pickBuffs({ hp: 15, maxHp: 22, codes, day: 4 });
    expect(d4.some((b) => PURPLE.has(b))).toBe(true);
  });

  it('全部已满叠（day1 白色池）返回空', () => {
    const codes = [
      'maxhp', 'maxhp', 'maxhp',
      'dmg', 'dmg', 'dmg',
      'leech', 'leech',
      'dodge', 'dodge',
      'freeze', 'freeze',
    ];
    expect(pickBuffs({ hp: 15, maxHp: 22, codes, day: 1 })).toHaveLength(0);
  });
});

describe('buff-picker 受控随机', () => {
  const seq = (arr: number[]) => {
    let i = 0;
    return () => arr[i++] ?? 0;
  };

  it('同上下文不同 rng → 三选一不同（受控随机，非固定顺序）', () => {
    const base = { hp: 15, maxHp: 22, codes: [], day: 4 };
    const a = pickBuffs(base, seq([0.01, 0.01, 0.01]));
    const b = pickBuffs(base, seq([0.99, 0.99, 0.99]));
    expect(new Set([...a, ...b]).size).toBeGreaterThan(3);
  });

  it('高 rng 也仍命中组0 核心（maxhp/dmg 首位必含），其余槽位随机', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 4, recentAcc: 0.9 }, seq([0.99, 0.99, 0.99]));
    expect(picks).toContain('dmg'); // high 组核心
  });

  it('低 rng 命中组0 核心（leech）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 4, recentAcc: 0.6 }, seq([0.01, 0.01, 0.01]));
    expect(picks).toContain('leech');
  });

  it('返回至多 3 且无重复', () => {
    for (const r of [0.01, 0.5, 0.99]) {
      const picks = pickBuffs({ hp: 15, maxHp: 22, codes: [], day: 6, recentAcc: 0.5 }, seq([r, r, r, r, r]));
      expect(picks.length).toBeLessThanOrEqual(3);
      expect(new Set(picks).size).toBe(picks.length);
    }
  });
});

describe('pickLegends 传说三选一（首领战后单局一次）', () => {
  it('无已选：从传说池返回 3 项', () => {
    const picks = pickLegends([]);
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
  });

  it('剔除已选传说，返回剩余至多 3 项', () => {
    const picks = pickLegends(['kill-heal']);
    expect(picks).not.toContain('kill-heal');
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it('全部选完返回空', () => {
    const all = ['boss-immunity', 'kill-heal', 'boss-x2', 'no-leak-dmg', 'thorns-aura', 'vampiric'];
    expect(pickLegends(all)).toHaveLength(0);
  });

  it('全部来自 LEGEND_BUFF_POOL 合法代号', () => {
    const valid = new Set(['boss-immunity', 'kill-heal', 'boss-x2', 'no-leak-dmg', 'thorns-aura', 'vampiric']);
    for (const b of pickLegends([])) expect(valid.has(b)).toBe(true);
  });
});
