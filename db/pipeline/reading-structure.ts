// 句子结构标注：校验纯函数（供导出/回填管线与单测使用）
import type { ReadingClauseRole, ReadingSentenceStructure } from '@word-journey/shared';

const VALID_ROLES = new Set<ReadingClauseRole>([
  'main',
  'noun',
  'adj',
  'adv',
  'participle',
  'prep',
  'infinitive',
  'appositive',
  'coordinate',
  'other',
]);

export function compact(s: string): string {
  return s.replace(/\s+/g, '');
}

// 校验一句的结构标注：返回错误列表（空 = 合法）
export function validateReadingStructure(
  structure: unknown,
  sentenceEn: string,
): string[] {
  const issues: string[] = [];
  if (!structure || typeof structure !== 'object') {
    return ['structure 不是对象'];
  }
  const s = structure as Partial<ReadingSentenceStructure>;

  if (!Array.isArray(s.clauses) || s.clauses.length === 0) {
    issues.push('clauses 为空');
  } else {
    const target = compact(sentenceEn);
    s.clauses.forEach((c, i) => {
      if (!c || typeof c !== 'object') {
        issues.push(`clauses[${i}] 非法`);
        return;
      }
      if (!VALID_ROLES.has(c.role)) issues.push(`clauses[${i}].role 非法: ${String(c.role)}`);
      if (typeof c.label !== 'string' || !c.label.trim()) issues.push(`clauses[${i}].label 为空`);
      if (typeof c.text !== 'string' || !c.text.trim()) {
        issues.push(`clauses[${i}].text 为空`);
      } else if (!target.includes(compact(c.text))) {
        issues.push(`clauses[${i}].text 无法在原句中找到: "${c.text.slice(0, 60)}"`);
      }
    });
  }

  if (s.main !== undefined && s.main !== null) {
    const m = s.main as Partial<NonNullable<ReadingSentenceStructure['main']>>;
    if (typeof m.subject !== 'string' || !m.subject.trim()) issues.push('main.subject 为空');
    if (typeof m.predicate !== 'string' || !m.predicate.trim()) issues.push('main.predicate 为空');
  }
  return issues;
}
