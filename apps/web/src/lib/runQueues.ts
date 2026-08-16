// 局内双队列（干净/错词）词级记忆镜像（前端表现层）
// 与服务端 forgetting.ts 的 RunWordMemory / queueOf 语义保持一致：
// - 从未错 或 已连续答对 RECOVER_STREAK 次 → 干净队列
// - 答错过且未恢复 → 错词队列
import { SURVIVAL } from '@word-journey/shared';

export interface WordMemory {
  lastSeq: number; // 局内最后一次出现 seq（-1=未出现）
  lastWrongSeq: number; // 局内最近一次答错 seq（-1=从未错）
  correctCount: number; // 局内累计答对
  wrongCount: number; // 局内累计答错
  streak: number; // 距最近一次答错以来的连续答对数（从未错 = 累计答对数）
}

export const emptyMemory = (): WordMemory => ({
  lastSeq: -1,
  lastWrongSeq: -1,
  correctCount: 0,
  wrongCount: 0,
  streak: 0,
});

// 增量更新记忆（对应 forgetting.ts memoryOf 的逐条推导）
export function nextMemory(prev: WordMemory, correct: boolean, seq: number): WordMemory {
  const m: WordMemory = {
    lastSeq: seq,
    lastWrongSeq: prev.lastWrongSeq,
    correctCount: prev.correctCount,
    wrongCount: prev.wrongCount,
    streak: prev.streak,
  };
  if (correct) {
    m.correctCount++;
    m.streak++;
  } else {
    m.wrongCount++;
    m.lastWrongSeq = seq;
    m.streak = 0;
  }
  return m;
}

// 是否在错词队列（答错过且未恢复）
export function isWrongQueue(m: WordMemory): boolean {
  if (m.wrongCount === 0) return false;
  return m.streak < SURVIVAL.FORGETTING.RECOVER_STREAK;
}

export interface QueueStats {
  clean: number; // 干净队列词数（全池 = poolUsed - 错词数）
  wrong: number; // 错词队列词数
}
