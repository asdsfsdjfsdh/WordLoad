import { SURVIVAL } from '@word-journey/shared';
import { pickBossWords, type BossCandidate } from './boss-selection';
import { emptyMemory, type RunWordMemory } from './forgetting';

const rng0 = (): number => 0.5; // 零抖动，便于断言

const mem = (o: Partial<RunWordMemory>): RunWordMemory => ({ ...emptyMemory(), ...o });
const c = (wordId: string, memory: RunWordMemory): BossCandidate => ({ wordId, memory });

describe('pickBossWords Boss 波取词', () => {
  it('错词队列优先于到期干净词（保留 Boss=错词重考）', () => {
    // wrong：昨日答错，错词队列
    const wrong = c('w', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 }));
    // due：2 天前答对过、已过静默期，干净队列但原始分更高
    const due = c('d', mem({ lastSeq: 0, correctCount: 1, streak: 1 }));
    const picked = pickBossWords({ candidates: [due, wrong], need: 1, maxSeq: 40, rng: rng0 });
    expect(picked.map((p) => p.wordId)).toEqual(['w']);
  });

  it('错词队内按遗忘紧迫度：近期错 > 早期错', () => {
    const fresh = c('f', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 }));
    const stale = c('s', mem({ lastSeq: 1, lastWrongSeq: 1, wrongCount: 1, streak: 0 }));
    const picked = pickBossWords({ candidates: [stale, fresh], need: 1, maxSeq: 40, rng: rng0 });
    expect(picked.map((p) => p.wordId)).toEqual(['f']);
  });

  it('未恢复错词优先于已恢复词（恢复词迁回干净队列、静默期内不进主池）', () => {
    const unrecovered = c('u', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 }));
    // recovered：曾错、已连续答对 3 次 → 干净队列，且最近刚对 → 静默期
    const recovered = c('r', mem({ lastSeq: 30, correctCount: 3, wrongCount: 1, streak: 3 }));
    const picked = pickBossWords({ candidates: [recovered, unrecovered], need: 1, maxSeq: 40, rng: rng0 });
    expect(picked.map((p) => p.wordId)).toEqual(['u']);
  });

  it('静默期干净词沉底，仅作补位', () => {
    const rest = c('r', mem({ lastSeq: 40, correctCount: 5, streak: 5 })); // 静默期，score=0
    const due = c('d', mem({ lastSeq: 0, correctCount: 1, streak: 1 }));   // 已到期
    const need1 = pickBossWords({ candidates: [rest, due], need: 1, maxSeq: 40, rng: rng0 });
    expect(need1.map((p) => p.wordId)).toEqual(['d']);
    const need2 = pickBossWords({ candidates: [rest, due], need: 2, maxSeq: 40, rng: rng0 });
    expect(need2.map((p) => p.wordId).sort()).toEqual(['d', 'r']);
  });

  it('上一波 Boss 已考词被软降权：同紧迫度下未考过词优先', () => {
    const a = c('a', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 })); // 原始分略高
    const b = c('b', mem({ lastSeq: 19, lastWrongSeq: 19, wrongCount: 1, streak: 0 })); // 原始分略低
    const picked = pickBossWords({
      candidates: [a, b],
      need: 1,
      maxSeq: 40,
      lastBossWordIds: new Set(['a']),
      rng: rng0,
    });
    expect(picked.map((p) => p.wordId)).toEqual(['b']);
  });

  it('同词在本波内不重复', () => {
    const a1 = c('a', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 }));
    const a2 = c('a', mem({ lastSeq: 5, lastWrongSeq: 5, wrongCount: 1, streak: 0 }));
    const picked = pickBossWords({ candidates: [a1, a2], need: 2, maxSeq: 40, rng: rng0 });
    expect(new Set(picked.map((p) => p.wordId)).size).toBe(1);
  });

  it('need 截断 / need<=0 / 空候选', () => {
    const w = c('w', mem({ lastSeq: 20, lastWrongSeq: 20, wrongCount: 1, streak: 0 }));
    expect(pickBossWords({ candidates: [w], need: 0, maxSeq: 40, rng: rng0 })).toHaveLength(0);
    expect(pickBossWords({ candidates: [], need: 5, maxSeq: 40, rng: rng0 })).toHaveLength(0);
    expect(pickBossWords({ candidates: [w], need: 5, maxSeq: 40, rng: rng0 })).toHaveLength(1);
  });
});
