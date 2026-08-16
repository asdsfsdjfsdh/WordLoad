import { describe, expect, it } from 'vitest';
import { SURVIVAL } from '@word-journey/shared';
import { emptyMemory, isWrongQueue, nextMemory } from './runQueues';

describe('runQueues 双队列词记忆镜像', () => {
  it('从未答错 → 不在错词队列', () => {
    const m = nextMemory(emptyMemory(), true, 0);
    expect(isWrongQueue(m)).toBe(false);
  });

  it('答错后未满恢复阈值 → 错词队列', () => {
    let m = nextMemory(emptyMemory(), true, 0);
    m = nextMemory(m, false, 1);
    expect(m.wrongCount).toBe(1);
    expect(m.streak).toBe(0);
    expect(isWrongQueue(m)).toBe(true);
  });

  it(`连续答对 ${SURVIVAL.FORGETTING.RECOVER_STREAK} 次 → 迁回干净队列`, () => {
    let m = nextMemory(emptyMemory(), false, 0);
    const streak = SURVIVAL.FORGETTING.RECOVER_STREAK;
    for (let i = 1; i <= streak; i++) m = nextMemory(m, true, i);
    expect(m.wrongCount).toBe(1);
    expect(m.streak).toBe(streak);
    expect(isWrongQueue(m)).toBe(false);
  });

  it('恢复中途再次答错 → streak 归零、仍错词队列', () => {
    let m = nextMemory(emptyMemory(), false, 0);
    m = nextMemory(m, true, 1);
    m = nextMemory(m, true, 2);
    m = nextMemory(m, false, 3);
    expect(m.streak).toBe(0);
    expect(m.wrongCount).toBe(2);
    expect(m.lastWrongSeq).toBe(3);
    expect(isWrongQueue(m)).toBe(true);
  });

  it('answer 序列聚合与逐条增量一致', () => {
    const items = [
      { seq: 0, correct: true },
      { seq: 1, correct: false },
      { seq: 2, correct: true },
      { seq: 3, correct: true },
    ];
    let m = emptyMemory();
    for (const it of items) m = nextMemory(m, it.correct, it.seq);
    expect(m.correctCount).toBe(3);
    expect(m.wrongCount).toBe(1);
    expect(m.streak).toBe(2);
    expect(m.lastWrongSeq).toBe(1);
    expect(isWrongQueue(m)).toBe(true);
  });
});
