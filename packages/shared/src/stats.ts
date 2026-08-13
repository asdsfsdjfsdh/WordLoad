import type { Rating } from './api';
import type { DifficultyTierAlias } from './vocab';

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
  bestMaxCombo: number;
  bossFights: number;
  bossWins: number;
  currentStreak: number;
  longestStreak: number;
  ratingCounts: RatingCounts;
  tierStats: TierStat[];
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