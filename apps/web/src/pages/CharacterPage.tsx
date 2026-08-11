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
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-slate-400">角色等级</span>
                <span className="text-3xl font-bold text-amber-400">Lv.{char.level}</span>
              </div>
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