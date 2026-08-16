import { applyDef } from '@word-journey/shared';
import {
  CALIBRATED,
  monsterHitsOf,
  monte,
  runTrial,
  travelBudgetOf,
} from './balance-sim';

describe('平衡仿真（M3 蒙特卡洛 · 目标带中位 5–15 天）', () => {
  const N = 3000;

  it('acc=0.75 → 中位存活落在目标带', () => {
    const r = monte(CALIBRATED, 3, 3, 3, 0.75, N, 2000);
    expect(r.median).toBeGreaterThanOrEqual(5);
    expect(r.median).toBeLessThanOrEqual(15);
  });

  it('正确率单调：acc 越高生存越久（buff 体系下 0.75→0.85→0.92 单调）', () => {
    const mid = monte(CALIBRATED, 3, 3, 3, 0.75, N, 2000);
    const strong = monte(CALIBRATED, 3, 3, 3, 0.85, N, 3000);
    const expert = monte(CALIBRATED, 3, 3, 3, 0.92, N, 3000);
    expect(strong.median).toBeGreaterThanOrEqual(mid.median);
    expect(expert.median).toBeGreaterThanOrEqual(strong.median);
  });

  it('随机三围分布（acc=0.75）：强三维中位不劣于弱三维', () => {
    const weak = monte(CALIBRATED, 1, 1, 1, 0.75, N, 4000);
    const strong = monte(CALIBRATED, 8, 8, 8, 0.75, N, 5000);
    expect(strong.median).toBeGreaterThanOrEqual(weak.median);
  });

  it('Boss 首见不早于 day3（新手缓冲）', () => {
    for (let i = 0; i < 200; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 3, 0.75, 6000 + i, true);
      const firstBossDay = r.log?.find((x) => x.bossResult.includes('BOSS'))?.day;
      if (firstBossDay !== undefined) {
        expect(firstBossDay).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('受击扣血有下限 ≥1（defRed 不使伤害归零）', () => {
    // defLv=8 → defRed=0.4 封顶；applyDef 恒 ≥1（负伤归零的伤害模型）
    expect(applyDef(1, 8)).toBeGreaterThanOrEqual(1);
    expect(applyDef(3, 8)).toBeGreaterThanOrEqual(1);
    expect(applyDef(0, 8)).toBeGreaterThanOrEqual(1);
  });

  it('首领战前不回复 HP（BOSS_HEAL=0，hpPre = 前一日末 hp）', () => {
    expect(CALIBRATED.bossHeal).toBe(0);
    let found = false;
    for (let i = 0; i < 500 && !found; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 3, 0.75, 8000 + i, true);
      const rows = r.log ?? [];
      for (let j = 0; j < rows.length; j++) {
        const row = rows[j]!;
        if (row.bossResult.includes('BOSS') && j > 0) {
          const prev = rows[j - 1]!;
          expect(row.hpPre).toBe(Math.min(row.maxHp, prev.hp)); // 无 +6
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('v2.4 保底注入：发生注入时每次 ≥5 且 ≤15', () => {
    let injectedSeen = false;
    for (let i = 0; i < 500; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 3, 0.75, 9000 + i, true);
      for (const row of r.log ?? []) {
        if (row.injected > 0) {
          injectedSeen = true;
          expect(row.injected).toBeGreaterThanOrEqual(5);
          expect(row.injected).toBeLessThanOrEqual(15);
        }
      }
    }
    expect(injectedSeen).toBe(true);
  });

  it('v2.4 速度/眩晕漏怪模型：低正确率触发眩晕，眩晕日确有输出', () => {
    let stunSeen = false;
    for (let i = 0; i < 500; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 3, 0.6, 10000 + i, true);
      for (const row of r.log ?? []) {
        if (row.stuns > 0) {
          stunSeen = true;
          expect(row.leaked).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(stunSeen).toBe(true);
  });

  it('v2.4 词难度加权：tierⅣ 怪需击数 ≥ tierⅠ', () => {
    for (let day = 1; day <= 10; day++) {
      for (let atkLv = 1; atkLv <= 8; atkLv++) {
        const t1 = monsterHitsOf(CALIBRATED, 0, day, atkLv);
        const t4 = monsterHitsOf(CALIBRATED, 3, day, atkLv);
        expect(t4).toBeGreaterThanOrEqual(t1);
      }
    }
  });

  it('v2.4 逼近预算封顶在 [minTravel, maxTravel]', () => {
    for (let day = 1; day <= 80; day++) {
      const t = travelBudgetOf(CALIBRATED, day);
      expect(t).toBeGreaterThanOrEqual(CALIBRATED.minTravel);
      expect(t).toBeLessThanOrEqual(CALIBRATED.maxTravel);
    }
  });
});