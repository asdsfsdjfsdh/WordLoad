export interface Sense {
  idx: number;
  meaning: string;
  example: string;
  phoneticNote?: string;
}

export interface ConfusablePair {
  wordA: string;
  wordB: string;
  type: 'orthographic' | 'homophone' | 'near-synonym';
  note: string;
}

export interface Word {
  id: string;
  text: string;
  phoneticAm?: string;
  phoneticEn?: string;
  senses: Sense[];
  difficultyScore: number;
  tier: DifficultyTierAlias;
  dimensions: {
    polysemy: number;
    spellingComplexity: number;
    confusability: number;
    frequency: number;
  };
  confusableIds: string[];
}

export type DifficultyTierAlias = 'I' | 'II' | 'III' | 'IV';

export interface WordProgress {
  stage: number;
  correctCount: number;
  wrongCount: number;
  inWrongBook: boolean;
  inVocabBook: boolean;
  mastery: number;
  reviewStage: number;
  nextReviewAt: string | null;
  ease: number;
}
