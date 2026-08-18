// 句子知识点标注：校验纯函数（供导出/回填管线与单测使用）
import type { ReadingSentenceKnowledge } from '@word-journey/shared';

const MAX_GRAMMAR = 4;
const MAX_WORDS = 6;
const MAX_PHRASES = 4;

// 校验一句的知识点标注：返回错误列表（空 = 合法）
export function validateReadingKnowledge(knowledge: unknown): string[] {
  const issues: string[] = [];
  if (!knowledge || typeof knowledge !== 'object') {
    return ['knowledge 不是对象'];
  }
  const k = knowledge as Partial<ReadingSentenceKnowledge>;

  const grammar = k.grammar ?? [];
  const words = k.words ?? [];
  const phrases = k.phrases ?? [];

  if (!Array.isArray(grammar)) issues.push('grammar 不是数组');
  else {
    if (grammar.length > MAX_GRAMMAR) issues.push(`grammar 超过 ${MAX_GRAMMAR} 条`);
    grammar.forEach((g, i) => {
      if (!g || typeof g !== 'object') {
        issues.push(`grammar[${i}] 非法`);
        return;
      }
      if (typeof g.title !== 'string' || !g.title.trim()) issues.push(`grammar[${i}].title 为空`);
      if (typeof g.text !== 'string' || !g.text.trim()) issues.push(`grammar[${i}].text 为空`);
    });
  }

  if (!Array.isArray(words)) issues.push('words 不是数组');
  else {
    if (words.length > MAX_WORDS) issues.push(`words 超过 ${MAX_WORDS} 个`);
    words.forEach((w, i) => {
      if (!w || typeof w !== 'object') {
        issues.push(`words[${i}] 非法`);
        return;
      }
      if (typeof w.word !== 'string' || !w.word.trim()) issues.push(`words[${i}].word 为空`);
      if (typeof w.meaning !== 'string' || !w.meaning.trim()) issues.push(`words[${i}].meaning 为空`);
    });
  }

  if (!Array.isArray(phrases)) issues.push('phrases 不是数组');
  else {
    if (phrases.length > MAX_PHRASES) issues.push(`phrases 超过 ${MAX_PHRASES} 个`);
    phrases.forEach((p, i) => {
      if (!p || typeof p !== 'object') {
        issues.push(`phrases[${i}] 非法`);
        return;
      }
      if (typeof p.text !== 'string' || !p.text.trim()) issues.push(`phrases[${i}].text 为空`);
      if (typeof p.meaning !== 'string' || !p.meaning.trim()) issues.push(`phrases[${i}].meaning 为空`);
    });
  }

  return issues;
}