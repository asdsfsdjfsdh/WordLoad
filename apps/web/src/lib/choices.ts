// 选中文模式：前端从会话下发的候选池（foilPool）生成 4 个选项
// 规则：答案项自动置入；干扰项优先选与本题构成易混关系的词（confusableTexts 含目标词），其余随机同池；去重并按含义排除正确答案
import type { FoilOption } from '@word-journey/shared';

export interface ChoiceOption {
  text: string;
  meaning: string;
  meanings?: string[]; // 该词全部义项（答错后展示选错词完整释义）
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

// 从候选池为某题挑选 4 个选项（含正确答案），随机排序
export function pickOptions(
  q: { answer: string; answerMeaning?: string },
  pool: FoilOption[] | undefined,
  rng: () => number = Math.random,
): ChoiceOption[] {
  const correct: ChoiceOption = { text: q.answer, meaning: q.answerMeaning ?? '' };
  const preferred: ChoiceOption[] = [];
  const rest: ChoiceOption[] = [];
  const seen = new Set<string>();
  for (const f of pool ?? []) {
    if (!f.text || f.text === q.answer) continue;
    if (!f.meaning || f.meaning === correct.meaning) continue;
    const key = `${f.text}::${f.meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const opt: ChoiceOption = { text: f.text, meaning: f.meaning, meanings: f.meanings };
    (f.confusableTexts?.includes(q.answer) ? preferred : rest).push(opt);
  }
  const foils = [
    ...shuffle(preferred, rng).slice(0, 3),
    ...shuffle(rest, rng).slice(0, Math.max(0, 3 - preferred.length)),
  ].slice(0, 3);
  return shuffle([correct, ...foils], rng);
}