import { SURVIVAL } from '@word-journey/shared';
import {
  emptyMemory,
  isRecovered,
  memoryOf,
  pickReviewWords,
  queueOf,
  scoreOf,
} from './forgetting';

const g = SURVIVAL.FORGETTING;
// 恒定 rng：抖动 (0.5*2-1)*JITTER = 0，便于断言
const rng0 = (): number => 0.5;

describe('forgetting 局内遗忘曲线', () => {
  describe('memoryOf 聚合', () => {
    it('连续答对 streak 累计；答错清零', () => {
      const m = memoryOf([
        { seq: 0, correct: true },
        { seq: 1, correct: true },
        { seq: 2, correct: false },
        { seq: 3, correct: true },
        { seq: 4, correct: true },
      ]);
      expect(m).toEqual({
        lastSeq: 4,
        lastWrongSeq: 2,
        correctCount: 4,
        wrongCount: 1,
        streak: 2,
      });
    });

    it('从未答错：streak = 答对数，lastWrongSeq = -1', () => {
      const m = memoryOf([
        { seq: 0, correct: true },
        { seq: 5, correct: true },
      ]);
      expect(m.lastWrongSeq).toBe(-1);
      expect(m.streak).toBe(2);
      expect(m.correctCount).toBe(2);
    });
  });

  describe('queueOf / isRecovered 双队列', () => {
    it('从未答错 → clean', () => {
      expect(queueOf(memoryOf([{ seq: 0, correct: true }]))).toBe('clean');
    });

    it('答错后未满恢复阈值 → wrong', () => {
      const m = memoryOf([
        { seq: 0, correct: true },
        { seq: 1, correct: false },
        { seq: 2, correct: true },
      ]);
      expect(queueOf(m)).toBe('wrong');
      expect(isRecovered(m)).toBe(false);
    });

    it(`连续答对 ${g.RECOVER_STREAK} 次 → 迁回 clean 且标记 recovered`, () => {
      const m = memoryOf([
        { seq: 0, correct: false },
        { seq: 1, correct: true },
        { seq: 2, correct: true },
        { seq: 3, correct: true },
      ]);
      expect(queueOf(m)).toBe('clean');
      expect(isRecovered(m)).toBe(true);
    });
  });

  describe('scoreOf 已掌握曲线（干净队列）', () => {
    const mk = (correctCount: number) => {
      const m = emptyMemory();
      m.lastSeq = 20;
      m.correctCount = correctCount;
      m.streak = correctCount;
      return m;
    };

    it('静默期内紧迫度为 0', () => {
      const m = mk(1);
      // rest = 2 + 0.5*1 = 2.5，daysSince=1 < 2.5 → 0
      expect(scoreOf({ memory: m, daysSince: 1, daysSinceWrong: -1, rng: rng0 })).toBe(0);
    });

    it('过静默期后紧迫度随时间单调上升', () => {
      const m = mk(1);
      const u3 = scoreOf({ memory: m, daysSince: 3, daysSinceWrong: -1, rng: rng0 });
      const u6 = scoreOf({ memory: m, daysSince: 6, daysSinceWrong: -1, rng: rng0 });
      expect(u6).toBeGreaterThan(u3);
      expect(u3).toBeGreaterThan(0);
    });

    it('多次答对 → 同天数紧迫度更低（稳定化）', () => {
      const u1 = scoreOf({ memory: mk(1), daysSince: 5, daysSinceWrong: -1, rng: rng0 });
      const u6 = scoreOf({ memory: mk(6), daysSince: 5, daysSinceWrong: -1, rng: rng0 });
      expect(u1).toBeGreaterThan(u6);
    });

    it('局前掌握度高 → 同天数紧迫度更低', () => {
      const m = mk(1);
      const uLo = scoreOf({ memory: m, daysSince: 5, daysSinceWrong: -1, preMastery: 0.2, rng: rng0 });
      const uHi = scoreOf({ memory: m, daysSince: 5, daysSinceWrong: -1, preMastery: 0.9, rng: rng0 });
      expect(uLo).toBeGreaterThan(uHi);
    });

    it('恢复词（曾错已补对）紧迫度高于同条件从未错词', () => {
      const recovered = emptyMemory();
      recovered.lastSeq = 30;
      recovered.correctCount = 3;
      recovered.wrongCount = 1;
      recovered.streak = 3;
      const neverWrong = emptyMemory();
      neverWrong.lastSeq = 30;
      neverWrong.correctCount = 3;
      neverWrong.streak = 3;
      const uR = scoreOf({ memory: recovered, daysSince: 4, daysSinceWrong: -1, rng: rng0 });
      const uN = scoreOf({ memory: neverWrong, daysSince: 4, daysSinceWrong: -1, rng: rng0 });
      expect(uR).toBeGreaterThan(uN);
    });
  });

  describe('scoreOf 答错曲线（错词队列）', () => {
    const mkWrong = (lastWrong: number) => {
      const m = emptyMemory();
      m.lastSeq = 20;
      m.lastWrongSeq = lastWrong;
      m.wrongCount = 1;
      m.streak = 0;
      return m;
    };

    it('错后次日紧迫度最高，随后随时间衰减', () => {
      const u1 = scoreOf({ memory: mkWrong(19), daysSince: 1, daysSinceWrong: 1, rng: rng0 });
      const u4 = scoreOf({ memory: mkWrong(0), daysSince: 1, daysSinceWrong: 4, rng: rng0 });
      expect(u1).toBeGreaterThan(u4);
      expect(u1).toBeGreaterThan(0.5);
    });

    it('错词紧迫度高于静默期内的干净词', () => {
      const wrong = mkWrong(19);
      const clean = emptyMemory();
      clean.lastSeq = 20;
      clean.correctCount = 1;
      clean.streak = 1;
      const uw = scoreOf({ memory: wrong, daysSince: 1, daysSinceWrong: 1, rng: rng0 });
      const uc = scoreOf({ memory: clean, daysSince: 1, daysSinceWrong: -1, rng: rng0 });
      expect(uw).toBeGreaterThan(uc);
    });
  });

  describe('随机抖动与兜底', () => {
    it('抖动落在 ±JITTER 内且结果在 [0,1]', () => {
      const m = emptyMemory();
      m.lastSeq = 20;
      m.lastWrongSeq = 19;
      m.wrongCount = 1;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 50; i++) {
        const s = scoreOf({ memory: m, daysSince: 1, daysSinceWrong: 1, rng: () => i / 50 });
        min = Math.min(min, s);
        max = Math.max(max, s);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
      expect(max - min).toBeLessThanOrEqual(2 * g.JITTER + 1e-9);
    });

    it('局内未出现：按兜底紧迫度（无抖动时精确返回）', () => {
      const m = emptyMemory(); // lastSeq=-1
      expect(
        scoreOf({ memory: m, daysSince: 0, daysSinceWrong: 0, fallbackUrgency: 0.8, rng: rng0 }),
      ).toBe(0.8);
    });
  });

  describe('pickReviewWords 选词', () => {
    it('按紧迫度降序取 need，剔除 usedInDay', () => {
      const wrong = {
        wordId: 'w',
        memory: (() => {
          const m = emptyMemory();
          m.lastSeq = 40;
          m.lastWrongSeq = 39;
          m.wrongCount = 1;
          return m;
        })(),
      };
      const due = {
        wordId: 'c',
        memory: (() => {
          const m = emptyMemory();
          m.lastSeq = 9; // 距 maxSeq=59 → daysSince≈3.5，已过静默期
          m.correctCount = 1;
          m.streak = 1;
          return m;
        })(),
      };
      const inRest = {
        wordId: 'r',
        memory: (() => {
          const m = emptyMemory();
          m.lastSeq = 40;
          m.correctCount = 5;
          m.streak = 5;
          return m;
        })(),
      };
      const picked = pickReviewWords({
        candidates: [due, wrong, inRest],
        need: 2,
        maxSeq: 59,
        usedInDay: new Set(['w']),
        rng: rng0,
      }).map((c) => c.wordId);
      expect(picked).toEqual(['c', 'r']);
    });

    it('错词优先于静默期干净词', () => {
      const wrong = {
        wordId: 'w',
        memory: (() => {
          const m = emptyMemory();
          m.lastSeq = 40;
          m.lastWrongSeq = 39;
          m.wrongCount = 1;
          return m;
        })(),
      };
      const cleanRest = {
        wordId: 'c',
        memory: (() => {
          const m = emptyMemory();
          m.lastSeq = 40;
          m.correctCount = 5;
          m.streak = 5;
          return m;
        })(),
      };
      const picked = pickReviewWords({
        candidates: [cleanRest, wrong],
        need: 1,
        maxSeq: 59,
        rng: rng0,
      }).map((c) => c.wordId);
      expect(picked).toEqual(['w']);
    });

    it('need<=0 或空候选返回空', () => {
      expect(pickReviewWords({ candidates: [], need: 5, maxSeq: 0, rng: rng0 })).toHaveLength(0);
      expect(
        pickReviewWords({ candidates: [{ wordId: 'a', memory: emptyMemory() }], need: 0, maxSeq: 0, rng: rng0 }),
      ).toHaveLength(0);
    });
  });
});
