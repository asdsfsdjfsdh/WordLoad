export type MonsterKind = 'triangle' | 'square' | 'circle' | 'elite' | 'boss';

export type GameEvent =
  | { type: 'answer-correct'; wordId: string; dmg: number }
  | { type: 'answer-wrong'; wordId: string }
  | { type: 'stun-start' }
  | { type: 'stun-end' }
  | { type: 'monster-spawn'; kind: MonsterKind }
  | { type: 'monster-hit'; kind: MonsterKind }
  | { type: 'monster-killed'; kind: MonsterKind }
  | { type: 'monster-escaped'; kind: MonsterKind }
  | { type: 'player-hit'; hpLeft: number }
  | { type: 'boss-hit'; segment: number }
  | { type: 'rating-revealed'; rating: string }
  | { type: 'combat-end'; cleared: boolean };

export interface BattleConfig {
  maxMonsters: number;
  spawnIntervalMs: number;
  approachSpeed: number;
  playerHp: number;
  stunRounds: number;
  bossSegments: number;
  minHitsToKill: number;
  perfectBonus: number;
  effectLevel: 0 | 1 | 2;
}
