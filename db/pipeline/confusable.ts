// 易混淆候选生成：形近（编辑距离）+ 音近（音标归一化哈希）
// 产出候选 WordPair 列表，供入库与人工复核

export type ConfusableType = 'orthographic' | 'homophone';

export interface PairCandidate {
  wordA: string;
  wordB: string;
  type: ConfusableType;
  note: string;
}

// 编辑距离（Levenshtein），两个字符串
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// 音标归一化：去重音符号/标记/分隔符，小写，仅保留辅元音主体
// 例：rɪˈtrækt → rɪtrækt
export function normalizePhonetic(p: string | null): string {
  if (!p) return '';
  return p
    .toLowerCase()
    .replace(/[\u02c8\u02cc\u02c7\u02cb]/g, '') // 重音符号
    .replace(/[.:]/g, '') // 长音/停顿标记
    .replace(/[.-]/g, '')
    .replace(/\s+/g, '')
    .replace(/[\/\\\[\]()]/g, '');
}

// 词族后缀变体：互有派生关系（y/ly/er/or/ed/ing/s/es/ion 等）的词排除，避免噪音
const FAMILY_SUFFIXES = ['y', 'ly', 'er', 'or', 'ed', 'ing', 's', 'es', 'ies', 'ied', 'ion', 'ation', 'ition', 'ment', 'ness', 'ful', 'less', 'able', 'ible', 'al', 'ive', 'ous', 'ize', 'ise'];

function removeFamilySuffix(w: string): string {
  for (const suf of FAMILY_SUFFIXES) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return '';
}

function isFamilyVariant(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) !== 1) return false;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (!longer.startsWith(shorter)) return false;
  return removeFamilySuffix(longer) === shorter;
}

// 形近候选：同长或长度差≤2，编辑距离阈值内，排除词族变体
export function findOrthographicPairs(
  words: string[],
  opts?: { maxDistance?: number; minLength?: number },
): PairCandidate[] {
  const maxDistance = opts?.maxDistance ?? 2;
  const minLength = opts?.minLength ?? 4;
  const buckets = new Map<number, string[]>();
  for (const w of words) {
    const len = w.length;
    if (len < minLength) continue;
    const list = buckets.get(len) ?? [];
    list.push(w);
    buckets.set(len, list);
  }

  const pairs: PairCandidate[] = [];
  const seen = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const [len, list] of buckets) {
    // 同长与相差1、相差2的组合并
    const candidates = [...(list ?? [])];
    const other1 = buckets.get(len + 1);
    if (other1) candidates.push(...other1);
    const other2 = buckets.get(len + 2);
    if (other2) candidates.push(...other2);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = list[i]!;
        const b = candidates[j]!;
        if (a === b) continue;
        if (isFamilyVariant(a, b)) continue;
        const k = key(a, b);
        if (seen.has(k)) continue;
        const dist = levenshtein(a, b);
        // 阈值随长度微调：越长容忍越多；但不超过绝对上限
        const allowed = Math.max(maxDistance, Math.floor(Math.min(a.length, b.length) / 5));
        if (dist > 0 && dist <= allowed) {
          seen.add(k);
          pairs.push({ wordA: a, wordB: b, type: 'orthographic', note: '形近' });
        }
      }
    }
  }
  return pairs;
}

// 音近候选：归一化音标完全相同（音标缺一个则跳过）且拼写不同的词对
export function findHomophonePairs(
  words: { text: string; phonetic: string | null }[],
): PairCandidate[] {
  const byKey = new Map<string, string[]>();
  for (const w of words) {
    const k = normalizePhonetic(w.phonetic);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(w.text);
    byKey.set(k, list);
  }

  const pairs: PairCandidate[] = [];
  const seen = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a === b) continue;
        const k = key(a, b);
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push({ wordA: a, wordB: b, type: 'homophone', note: '音近' });
      }
    }
  }
  return pairs;
}

// 合并去重：同拼写对保留一个（形近优先于音近）
export function mergePairs(a: PairCandidate[], b: PairCandidate[]): PairCandidate[] {
  const map = new Map<string, PairCandidate>();
  const key = (p: PairCandidate) =>
    p.wordA < p.wordB ? `${p.wordA}|${p.wordB}` : `${p.wordB}|${p.wordA}`;
  for (const p of [...a, ...b]) {
    const k = key(p);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, p);
    } else if (existing.type === 'homophone' && p.type === 'orthographic') {
      map.set(k, p);
    }
  }
  return [...map.values()];
}