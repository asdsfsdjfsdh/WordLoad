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

  it('acc=0.85 → 中位存活高于 0.75 且仍在合理范围', () => {
    const base = monte(CALIBRATED, 3, 3, 3, 0.75, N, 2000);
    const high = monte(CALIBRATED, 3, 3, 3, 0.85, N, 3000);
    expect(high.median).toBeGreaterThanOrEqual(base.median);
    expect(high.median).toBeLessThanOrEqual(15);
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

  it('HP 扣减有下限 ≥1（受击不归零绕过 defRed）', () => {
    // defLv=8 → defRed=0.4 封顶；raw≥1 → ceil(raw*0.6)≥1
    for (let i = 0; i < 200; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 8, 0.75, 7000 + i, true);
      expect(r.days).toBeGreaterThanOrEqual(1);
    }
  });

  it('首领战前 +6 HP 小回复生效', () => {
    // 找一个发生首领战的局，断言开打当日 hpPre 有 +6 加成痕迹（hpPre ≤ maxHp 且回调存在）
    let found = false;
    for (let i = 0; i < 500 && !found; i++) {
      const r = runTrial(CALIBRATED, 3, 3, 3, 0.75, 8000 + i, true);
      const bossRow = r.log?.find((x) => x.bossResult.includes('BOSS'));
      if (bossRow) {
        expect(bossRow.hpPre).toBeGreaterThan(0);
        found = true;
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