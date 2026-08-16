// 红宝书肉鸽词池跨关卡扩展（纯函数）
// 双队列判定：当前已并池 Unit 中"干净队列"词占比 ≥ 阈值 → 并池下一个 Unit
// 干净队列 = 从未错 或 已连续答对 RECOVER_STREAK 次（与 forgetting.ts queueOf 一致）
import { SURVIVAL } from '@word-journey/shared';

// 按 Unit 顺序（跨区域：必考→基础→超纲）从起始 stage 扩展 N 个 stage
// 词书 stage 编码：必考=1xx（101~126）、基础=2xx（201~231）、超纲=3xx（301~325）
// 传入词书全部 stage（升序，可能缺个别字母如 X/Z），从 startStage 的位置开始取前 expandedUnits 个
export function computePoolStages(
  allStageIds: number[],
  startStage: number,
  expandedUnits: number,
): number[] {
  const sorted = [...new Set(allStageIds)].sort((a, b) => a - b);
  const startIdx = sorted.indexOf(startStage);
  if (startIdx < 0) return [startStage];
  return sorted.slice(startIdx, startIdx + Math.max(1, expandedUnits));
}

// 双队列干净占比：给定每词局内记忆，统计"干净队列"词数占比
// clean 词 = wrongCount===0 或 streak ≥ RECOVER_STREAK（从未错 / 已恢复）
export function cleanRateOf(
  memories: { wrongCount: number; streak: number }[],
  recoverStreak: number = SURVIVAL.FORGETTING.RECOVER_STREAK,
): number {
  if (memories.length === 0) return 1;
  const clean = memories.filter((m) => m.wrongCount === 0 || m.streak >= recoverStreak).length;
  return clean / memories.length;
}

// 是否应并池下一个 Unit：当前池内干净占比 ≥ 阈值
export function shouldExpand(
  cleanRate: number,
  threshold: number = SURVIVAL.POOL_EXPAND_CLEAN_RATE,
): boolean {
  return cleanRate >= threshold;
}

// 每日题量随并池 Unit 数递增：20 + (units-1) * 每Unit增量，封顶
export function questionsPerDayFor(
  pooledUnits: number,
  base: number = SURVIVAL.QUESTIONS_PER_DAY,
  step: number = SURVIVAL.POOL_QPD_STEP,
  cap: number = SURVIVAL.POOL_QPD_CAP,
): number {
  return Math.min(cap, base + Math.max(0, pooledUnits - 1) * step);
}
