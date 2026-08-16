// run 23 真实数据回归复盘（分析脚本，不参与运行逻辑）：
// 用真实 RunItem 序列重建每波选词时点，把旧算法实际选出的 review 词
// 在新遗忘曲线（forgetting.ts）下重新打分，量化"本应处于静默期却仍被复习"的病态重复。
import * as fs from 'fs';
import * as path from 'path';
import { SURVIVAL } from '@word-journey/shared';
import { emptyMemory, memoryOf, scoreOf } from './forgetting';

const qpd = SURVIVAL.QUESTIONS_PER_DAY;
// 恒定 rng：去除抖动，看"期望紧迫度"
const rng0 = (): number => 0.5;
const toDays = (seq: number, maxSeq: number): number =>
  seq >= 0 ? 1 + Math.max(0, (maxSeq - seq) / qpd) : 0;

interface Item { seq: number; wordId: string; type: string; correct: boolean | null }
interface Progress { mastery: number; nextReviewAt: Date | null; inWrongBook: boolean; skipped: boolean }

function readTsv(file: string): string[][] {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.replace(/\r$/, '').split('\t'));
}

function main() {
  const dir = process.argv[2] ?? 'C:\\Users\\18465\\AppData\\Local\\Temp\\opencode\\run23';
  const items: Item[] = readTsv(path.join(dir, 'items.tsv'))
    .slice(1)
    .map((r) => ({
      seq: Number(r[0]),
      wordId: r[1] ?? '',
      type: r[2] ?? '',
      correct: r[3] === '2' ? null : r[3] === '1',
    }))
    .sort((a, b) => a.seq - b.seq);
  const progressMap = new Map<string, Progress>(
    readTsv(path.join(dir, 'progress.tsv'))
      .slice(1)
      .map((r) => [
        r[0] ?? '',
        {
          mastery: Number(r[1]),
          nextReviewAt: r[2] ? new Date(r[2]) : null,
          inWrongBook: r[3] === '1',
          skipped: r[4] === '1',
        },
      ]),
  );

  // ── 1. 重建波次：连续 boss = boss 波；非 boss 每 20 题一波（最后一波可不足）──
  const waves: { isBoss: boolean; startSeq: number; items: Item[] }[] = [];
  let i = 0;
  while (i < items.length) {
    const isBoss = items[i]!.type === 'boss';
    const chunk: Item[] = [];
    while (i < items.length && chunk.length < qpd && (items[i]!.type === 'boss') === isBoss) {
      chunk.push(items[i]!);
      i++;
    }
    waves.push({ isBoss, startSeq: chunk[0]!.seq, items: chunk });
  }

  // ── 2. 统计实际病态 ──
  const stats = new Map<string, { wordId: string; cnt: number; review: number; wrong: number; asNew: number; asBoss: number }>();
  for (const it of items) {
    if (it.correct === null) continue;
    const s = stats.get(it.wordId) ?? { wordId: it.wordId, cnt: 0, review: 0, wrong: 0, asNew: 0, asBoss: 0 };
    s.cnt++;
    if (it.type === 'review') s.review++;
    if (it.type === 'new') s.asNew++;
    if (it.type === 'boss') s.asBoss++;
    if (it.correct === false) s.wrong++;
    stats.set(it.wordId, s);
  }
  const offenders = [...stats.values()].filter((s) => s.review >= 8).sort((a, b) => b.review - a.review);

  console.log('═══════ run 23 回归复盘（user 6 / day 17 / stage1）═══════');
  console.log(`答题总数 ${items.filter((x) => x.correct !== null).length}，波次 ${waves.length}（其中 boss 波 ${waves.filter((w) => w.isBoss).length}）\n`);

  console.log('── 1) 实际病态（旧算法）：错 1 次后被复习 ≥8 次的词 ──');
  console.log('词           出现  复习  新   boss  答错');
  for (const s of offenders) {
    console.log(
      `${wordText(s.wordId).padEnd(12)} ${String(s.cnt).padStart(4)} ${String(s.review).padStart(4)} ${String(s.asNew).padStart(4)} ${String(s.asBoss).padStart(5)} ${String(s.wrong).padStart(4)}`,
    );
  }

  // ── 3. 新曲线复盘：每次 review 出现，回算选词时点的紧迫度 ──
  // 选词时点 = 上一波结束：state = 该波之前所有已答 seq，maxSeq = 上一波最后 seq
  let reviewTotal = 0;
  let blocked = 0; // 静默期(score=0)，新曲线不会选
  let stillDue = 0; // score>0，新曲线仍会（合理复现）
  const perWord = new Map<string, { review: number; blocked: number; stillDue: number }>();
  const timeline = new Map<string, { day: number; seq: number; score: number; streak: number; queue: string }[]>();

  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w]!;
    if (wave.isBoss) continue;
    const prior = items.filter((it) => it.seq < wave.startSeq && it.correct !== null);
    const maxSeq = prior.length > 0 ? prior[prior.length - 1]!.seq : -1;

    for (const it of wave.items) {
      if (it.type !== 'review' || it.correct === null) continue;
      reviewTotal++;
      const mine = prior.filter((p) => p.wordId === it.wordId);
      const memory = mine.length > 0 ? memoryOf(mine.map((p) => ({ seq: p.seq, correct: p.correct === true }))) : emptyMemory();
      const pr = progressMap.get(it.wordId);
      const preMastery = (pr?.mastery ?? 0) / 100;
      let fallback: number | undefined;
      if (memory.lastSeq < 0 && pr) {
        fallback = pr.inWrongBook ? SURVIVAL.FORGETTING.WRONG_URGENCY_BASE : undefined;
      }
      const score = scoreOf({
        memory,
        daysSince: toDays(memory.lastSeq, maxSeq),
        daysSinceWrong: toDays(memory.lastWrongSeq, maxSeq),
        preMastery,
        fallbackUrgency: fallback,
        rng: rng0,
      });
      const isBlocked = score === 0;
      if (isBlocked) blocked++;
      else stillDue++;
      const pw = perWord.get(it.wordId) ?? { review: 0, blocked: 0, stillDue: 0 };
      pw.review++;
      if (isBlocked) pw.blocked++;
      else pw.stillDue++;
      perWord.set(it.wordId, pw);
      const tl = timeline.get(it.wordId) ?? [];
      tl.push({
        day: waves.slice(0, w).filter((x) => !x.isBoss).length + 1,
        seq: it.seq,
        score,
        streak: memory.streak,
        queue: memory.wrongCount === 0 || memory.streak >= SURVIVAL.FORGETTING.RECOVER_STREAK ? 'clean' : 'wrong',
      });
      timeline.set(it.wordId, tl);
    }
  }

  console.log('\n── 2) 新曲线复盘：实际每次 review 出现时点的紧迫度 ──');
  console.log(`复习出现合计 ${reviewTotal} 次；其中新曲线判"静默期内（应阻断）" ${blocked} 次（${(100 * blocked / reviewTotal).toFixed(1)}%），"仍应复现" ${stillDue} 次`);
  console.log('\n病态词逐词：复习次数 → 可阻断/仍应复现');
  for (const s of offenders) {
    const pw = perWord.get(s.wordId) ?? { review: 0, blocked: 0, stillDue: 0 };
    console.log(
      `${wordText(s.wordId).padEnd(12)} 复习 ${String(pw.review).padStart(3)} → 可阻断 ${String(pw.blocked).padStart(3)} / 仍应复现 ${String(pw.stillDue).padStart(3)}`,
    );
  }

  console.log('\n── 3) 病态词时序（新曲线视角：score>0 该复现，=0 静默期；! 表示错词队列）──');
  for (const s of offenders.slice(0, 4)) {
    const tl = timeline.get(s.wordId) ?? [];
    console.log(`\n${wordText(s.wordId)}（累计答错 ${s.wrong} 次）`);
    const lines: string[] = [];
    let cur = '';
    let curDay = 0;
    for (const t of tl) {
      if (t.day !== curDay) {
        if (cur) lines.push(cur);
        cur = `  D${String(t.day).padStart(2)}:`;
        curDay = t.day;
      }
      cur += ` ${t.score.toFixed(2)}${t.queue === 'wrong' ? '!' : ''}`;
    }
    if (cur) lines.push(cur);
    console.log(lines.join('\n'));
  }

  // ── 4. 新曲线复盘 Boss 波：每次 boss 出现回算选词时点紧迫度 ──
  let bossTotal = 0;
  let bossBlocked = 0; // score=0：静默期/已掌握，仅在最末兜底才可能被选
  let bossDue = 0;
  const bossPerWord = new Map<string, { total: number; blocked: number }>();
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w]!;
    if (!wave.isBoss) continue;
    const prior = items.filter((it) => it.seq < wave.startSeq && it.correct !== null);
    const maxSeq = prior.length > 0 ? prior[prior.length - 1]!.seq : -1;
    for (const it of wave.items) {
      if (it.correct === null) continue;
      bossTotal++;
      const mine = prior.filter((p) => p.wordId === it.wordId);
      const memory = mine.length > 0
        ? memoryOf(mine.map((p) => ({ seq: p.seq, correct: p.correct === true })))
        : emptyMemory();
      const pr = progressMap.get(it.wordId);
      const score = scoreOf({
        memory,
        daysSince: toDays(memory.lastSeq, maxSeq),
        daysSinceWrong: toDays(memory.lastWrongSeq, maxSeq),
        preMastery: (pr?.mastery ?? 0) / 100,
        rng: rng0,
      });
      const isBlocked = score === 0;
      if (isBlocked) bossBlocked++;
      else bossDue++;
      const pw = bossPerWord.get(it.wordId) ?? { total: 0, blocked: 0 };
      pw.total++;
      if (isBlocked) pw.blocked++;
      bossPerWord.set(it.wordId, pw);
    }
  }
  console.log('\n── 4) 新曲线复盘 Boss 波（选词时点紧迫度）──');
  console.log(`Boss 出现合计 ${bossTotal} 次；其中"静默期内（应阻断，仅最末兜底才可能被选）" ${bossBlocked} 次（${(100 * bossBlocked / bossTotal).toFixed(1)}%），"仍应复现" ${bossDue} 次`);
  console.log('\n病态词 Boss 出现：出现次数 → 可阻断');
  for (const s of offenders) {
    const pw = bossPerWord.get(s.wordId);
    if (!pw || pw.total === 0) continue;
    console.log(
      `${wordText(s.wordId).padEnd(12)} Boss ${String(pw.total).padStart(3)} → 可阻断 ${String(pw.blocked).padStart(3)}`,
    );
  }

  console.log('\n（score 为无抖动期望值；±0.15 抖动仅影响 0 附近的边界排序）');
}

// 词义回查：只展示首义项，简短可读
const WORD_TEXT_CACHE = new Map<string, string>();
function wordText(wordId: string): string {
  if (WORD_TEXT_CACHE.has(wordId)) return WORD_TEXT_CACHE.get(wordId)!;
  const found = (() => {
    try {
      const rows = readTsv('C:\\Users\\18465\\AppData\\Local\\Temp\\opencode\\run23\\words.tsv');
      return rows.find((r) => r[0] === wordId);
    } catch {
      return undefined;
    }
  })();
  const text = found?.[1] ?? wordId.slice(0, 8);
  WORD_TEXT_CACHE.set(wordId, text);
  return text;
}

main();
