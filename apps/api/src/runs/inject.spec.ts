import { SURVIVAL } from '@word-journey/shared';
import { shouldForceStop, shouldInject } from './inject';

describe('inject 注入决策', () => {
  it('首领波日不注', () => {
    const r = shouldInject({ day: 5, lastInjectDay: 3, acc: 0.9, qLight: 0, bossJustCleared: true });
    expect(r.inject).toBe(false);
    expect(r.amount).toBe(0);
  });

  it('严格隔天：距上次注入 < cooldown 不注', () => {
    const r = shouldInject({ day: 5, lastInjectDay: 4, acc: 0.9, qLight: 0, bossJustCleared: false });
    expect(r.inject).toBe(false);
  });

  it('acc 低于门控不注', () => {
    const r = shouldInject({ day: 5, lastInjectDay: 3, acc: 0.7, qLight: 0, bossJustCleared: false });
    expect(r.inject).toBe(false);
  });

  it('保底注入 ≥5 且 ≤15', () => {
    const r = shouldInject({ day: 5, lastInjectDay: 3, acc: 0.9, qLight: 999, bossJustCleared: false });
    expect(r.inject).toBe(true);
    expect(r.amount).toBeGreaterThanOrEqual(SURVIVAL.INJECT_MIN);
    expect(r.amount).toBeLessThanOrEqual(SURVIVAL.INJECT_MAX);
  });

  it('错词越少注入越多（轻量 Q 反向）', () => {
    const few = shouldInject({ day: 5, lastInjectDay: 3, acc: 0.9, qLight: 2, bossJustCleared: false });
    const many = shouldInject({ day: 5, lastInjectDay: 3, acc: 0.9, qLight: 20, bossJustCleared: false });
    expect(few.amount).toBeGreaterThan(many.amount);
  });

  it('当天全对：次日强制注入（绕过冷却与首领日限制）', () => {
    // 严格隔天冷却内但全对 → 次日仍注入
    const cooldown = shouldInject({ day: 5, lastInjectDay: 4, acc: 1, qLight: 0, bossJustCleared: false });
    expect(cooldown.inject).toBe(true);
    // 首领波日全对 → 次日仍注入
    const bossPerfect = shouldInject({ day: 5, lastInjectDay: 4, acc: 1, qLight: 0, bossJustCleared: true });
    expect(bossPerfect.inject).toBe(true);
    // 首领波日非全对 → 不注入（保留原约束）
    const bossNonPerfect = shouldInject({ day: 5, lastInjectDay: 4, acc: 0.9, qLight: 0, bossJustCleared: true });
    expect(bossNonPerfect.inject).toBe(false);
  });

  it('连续 acc 低于 0.65 满 2 天强制停止', () => {
    expect(shouldForceStop([0.6, 0.5, 0.9])).toBe(false); // 只有连续 2 天低才停
    expect(shouldForceStop([0.6, 0.5])).toBe(true);
    expect(shouldForceStop([0.9, 0.6])).toBe(false);
  });
});