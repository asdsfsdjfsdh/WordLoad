import { pickBuffs, type BuffCounts } from './buff-picker';

const full: BuffCounts = { maxHp: 0, leech: 0, dmg: 0, dodge: 0, freeze: 0 };

describe('buff-picker 上下文感知', () => {
  it('HP<30% 必含防御项', () => {
    const picks = pickBuffs({ hp: 6, maxHp: 22, counts: full });
    expect(picks).toHaveLength(3);
    expect(picks.some((b) => b === 'dodge' || b === 'leech' || b === 'maxhp')).toBe(true);
  });

  it('acc<0.75 加权保命（吸血/免伤）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, counts: full, recentAcc: 0.6 });
    expect(picks.some((b) => b === 'leech' || b === 'dodge')).toBe(true);
  });

  it('acc≥0.85 加权提速（伤害/冻结）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, counts: full, recentAcc: 0.9 });
    expect(picks.some((b) => b === 'dmg' || b === 'freeze')).toBe(true);
  });

  it('首领前一日必含对策（免伤优先）', () => {
    const picks = pickBuffs({ hp: 15, maxHp: 22, counts: full, bossSoon: true });
    expect(picks).toContain('dodge');
  });

  it('已达叠加上限的 buff 被剔除', () => {
    const maxed: BuffCounts = { maxHp: 3, leech: 0, dmg: 0, dodge: 0, freeze: 0 };
    const picks = pickBuffs({ hp: 15, maxHp: 22, counts: maxed });
    expect(picks).not.toContain('maxhp');
  });

  it('全池满叠返回空', () => {
    const maxed: BuffCounts = { maxHp: 3, leech: 2, dmg: 3, dodge: 2, freeze: 2 };
    expect(pickBuffs({ hp: 15, maxHp: 22, counts: maxed })).toHaveLength(0);
  });
});