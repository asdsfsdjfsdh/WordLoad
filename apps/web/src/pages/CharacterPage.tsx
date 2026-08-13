import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AuthUser } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export function CharacterPage() {
  const { user, refreshUser } = useAuth();
  const char = user?.character;

  const init = useMutation({
    mutationFn: async () => {
      await api.post<AuthUser>('/auth/character', { hpLv: 3, atkLv: 3, defLv: 3 });
      await refreshUser();
    },
    onError: () => {
      /* error handled in render via init.error */
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <Link to="/lobby" className="text-sm text-slate-400 hover:text-cyan-400">
        ← 返回大厅
      </Link>

      <div className="mt-6 max-w-md">
        <h1 className="text-2xl font-bold text-cyan-400">养成面板</h1>

        {!char ? (
          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
            <p className="mb-4 text-sm text-slate-400">尚未创建角色，初始化三围（3/3/3）</p>
            <button
              onClick={() => init.mutate()}
              disabled={init.isPending}
              className="rounded-lg bg-cyan-500 px-6 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {init.isPending ? '创建中…' : '创建角色'}
            </button>
            {init.error && (
              <p className="mt-2 text-sm text-red-400">
                {init.error instanceof Error ? init.error.message : '创建失败'}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-slate-400">角色等级</span>
                <span className="text-3xl font-bold text-amber-400">Lv.{char.level}</span>
              </div>
              <ExpBar exp={char.exp} level={char.level} />
              <StatBar label="生命" value={char.hpLv} color="bg-emerald-500" />
              <StatBar label="攻击" value={char.atkLv} color="bg-red-500" />
              <StatBar label="防御" value={char.defLv} color="bg-sky-500" />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center text-sm text-slate-400">
              当前金币：{user?.coins}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 每级所需经验：达到 level 累计需 100*(level-1)*level/2（与后端 expForLevel 一致）
function expForLevel(level: number): number {
  const l = Math.max(1, level);
  return (100 * (l - 1) * l) / 2;
}

function ExpBar({ exp, level }: { exp: number; level: number }) {
  const inLevel = exp - expForLevel(level);
  const toNext = level * 100; // 当前级升下一级需 level*100
  const pct = Math.max(0, Math.min(100, Math.round((inLevel / toNext) * 100)));
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>经验</span>
        <span className="tabular-nums">{exp} / 升 {level + 1} 级还需 {Math.max(0, toNext - inLevel)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, value * 12.5);
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}