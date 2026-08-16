// 红宝书 Unit 肉鸽 Run 专属数值（纯函数）：
// Final Boss 血量（固定基数 × 随机浮动，不随 Unit 递增）。
// 每日题量固定 UNIT_BOSS.DAILY_CAP（20），出题构成见 nextDay 的错词/新词/复习三层逻辑。
import { UNIT_BOSS } from '@word-journey/shared';

// Final Boss 血量：BASE_HP × (1 + (rand−0.5)×JITTER)，四舍五入、保底 4。
// 服务端进入 Final Boss 波时 roll 一次并落库 Run.finalBossHp（客户端不可见），
// 血量随机浮动使重开同一 Unit 的决战存在差异，但整体难度对全部 Unit 一致。
export function finalBossHp(rng: () => number = Math.random): number {
  const jitter = (rng() - 0.5) * UNIT_BOSS.JITTER;
  return Math.max(4, Math.round(UNIT_BOSS.BASE_HP * (1 + jitter)));
}
