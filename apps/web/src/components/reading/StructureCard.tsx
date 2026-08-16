// 结构分析卡：句子主干 + 从句列表（融入正文句子下方；小字但可读）
import type { ReadingClauseRole, ReadingSentenceStructure } from '@word-journey/shared';
import { clauseRoleInfo } from '@word-journey/shared';

export function StructureCard({ structure, className = '' }: { structure: ReadingSentenceStructure; className?: string }) {
  return (
    <div className={`space-y-1.5 text-sm leading-6 ${className}`}>
      {structure.main && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-slate-300">
          <span className="mr-1 text-slate-500">主干：</span>
          <span>
            主 <span className="font-medium text-sky-300">{structure.main.subject}</span>
          </span>
          <span className="mx-1 text-slate-600">·</span>
          <span>
            谓 <span className="font-medium text-cyan-300">{structure.main.predicate}</span>
          </span>
          {structure.main.object && (
            <>
              <span className="mx-1 text-slate-600">·</span>
              <span>
                宾 <span className="font-medium text-emerald-300">{structure.main.object}</span>
              </span>
            </>
          )}
        </div>
      )}
      <ul className="space-y-1">
        {structure.clauses.map((c, i) => {
          const info = clauseRoleInfo(c.role);
          return (
            <li key={i} className="flex items-start gap-2">
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${info.dotClass}`} />
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${info.chipClass}`}>
                {info.label}
              </span>
              <span className="text-slate-400">{c.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// 图例：出现在本页的角色色点说明
export function StructureLegend({ roles }: { roles: ReadingClauseRole[] }) {
  if (roles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {roles.map((r) => {
        const info = clauseRoleInfo(r);
        return (
          <span key={r} className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-full ${info.dotClass}`} />
            {info.label}
          </span>
        );
      })}
    </div>
  );
}
