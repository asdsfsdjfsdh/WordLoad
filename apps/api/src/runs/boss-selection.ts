// Boss 波取词（纯函数）：把 Boss 波当作"错词集中重考"，接入遗忘曲线统一排程。
// 三级排序（记忆学依据）：
//  - 错词队列（未恢复）优先，保留"Boss=错词重考"身份；
//  - 队内按遗忘紧迫度降序（WRONG_URGENCY_BASE×exp(-距错天数/WRONG_DECAY_DAYS)）：
//    近期错 > 早期错，旧错词自动让位（间隔效应，避免 massed repetition）；
//  - 上一波 Boss 已考词软降权（×BOSS_REUSE_PENALTY），拉长跨波复现间隔；
//  - 静默期/恢复干净词仅作补位（score>0 优先），杜绝已掌握词被反复轰炸。
// 输出天然不重复（同词不会在一波内出现两次）。
import { SURVIVAL } from '@word-journey/shared';
import { queueOf, scoreOf, type RunWordMemory } from './forgetting';

export interface BossCandidate {
  wordId: string;
  memory: RunWordMemory;
  preMastery?: number; // 局前掌握度 0..1
}

export function pickBossWords(opts: {
  candidates: BossCandidate[];
  need: number;              // = bossHits(day, atkLv)，Boss 血量（题数）
  maxSeq: number;            // 当前最大已答 seq，折算遗忘天数
  lastBossWordIds?: Set<string>; // 上一波 Boss 已考词（软降权）
  rng?: () => number;
}): BossCandidate[] {
  const { candidates, need, maxSeq, lastBossWordIds, rng = Math.random } = opts;
  if (need <= 0) return [];
  // 同词不重复（本波内不会两次出现同一词）
  const uniq = [...new Map(candidates.map((c) => [c.wordId, c])).values()];
  const qpd = SURVIVAL.QUESTIONS_PER_DAY;
  const toDays = (seq: number): number => (seq >= 0 ? 1 + Math.max(0, (maxSeq - seq) / qpd) : 0);

  const scored = uniq.map((c) => {
    let score = scoreOf({
      memory: c.memory,
      daysSince: toDays(c.memory.lastSeq),
      daysSinceWrong: toDays(c.memory.lastWrongSeq),
      preMastery: c.preMastery,
      rng,
    });
    // 软降权：上一波 Boss 已考过的词排到未考过词之后
    if (lastBossWordIds?.has(c.wordId)) score *= SURVIVAL.BOSS_REUSE_PENALTY;
    return { c, score, queue: queueOf(c.memory) };
  });

  const ordered = scored.sort((a, b) => {
    if (a.queue !== b.queue) return a.queue === 'wrong' ? -1 : 1;
    return b.score - a.score;
  });
  return ordered.slice(0, need).map((s) => s.c);
}
