import type { Rating } from './api.js';
import type { DifficultyTierAlias } from './vocab.js';

// 评级分布（key 同 Rating 取值全集）
export type RatingCounts = Record<Rating, number>;

export interface TierStat {
  tier: DifficultyTierAlias;
  total: number;
  mastered: number;
  encountered: number;
}

export interface StatsOverview {
  totalSessions: number;
  totalWins: number;
  winRate: number; // 0-100
  totalStudyMs: number;
  totalXpEarned: number;
  totalCoinsEarned: number;
  totalAnswered: number;
  totalCorrect: number;
  totalWrong: number;
  accuracy: number; // 0-100
  masteredWords: number;
  wrongbookWords: number;
  skippedWords: number; // 已斩（永久不再出题）
  bestMaxCombo: number;
  bossFights: number;
  bossWins: number;
  currentStreak: number;
  longestStreak: number;
  ratingCounts: RatingCounts;
  tierStats: TierStat[];
  // 生存 Run
  totalRuns: number;        // 累计结束的 Run 场数
  bestRunDays: number;      // 历史最高生存天数
  totalBossCleared: number; // 累计击破 Boss 次数
  activeRunCount: number;   // 进行中的 Run（0/1）
  // Unit 闯关（红宝书肉鸽）
  totalUnitRuns: number;    // 累计结束的 Unit Run 场数
  unitCleared: number;      // 累计通关的 Unit 数
}

export interface StatsTrendPoint {
  date: string; // 'YYYY-MM-DD'
  sessions: number;
  answered: number;
  correct: number;
  accuracy: number; // 0-100
  xpEarned: number;
  coinsEarned: number;
  studyMs: number;
  newWords: number;
  mastered: number; // 当日新掌握词数
}

export interface StatsHeatmapCell {
  date: string; // 'YYYY-MM-DD'
  value: number; // 当日答题数
}

export interface StatsHeatmapResult {
  weeks: number;
  start: string;
  end: string;
  cells: StatsHeatmapCell[];
}