import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AuthUser, MaterialHolding } from '@word-journey/shared';
import { STRENGTHEN_COST } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

const STAT_META = [
  { key: 'hp', field: 'hpLv', label: '生命', color: 'bg-emerald-500', text: 'text-emerald-300', icon: '❤️' },
  { key: 'atk', field: 'atkLv', label: '攻击', color: 'bg-red-500', text: 'text-red-300', icon: '⚔️' },
  { key: 'def', field: 'defLv', label: '防御', color: 'bg-sky-500', text: 'text-sky-300', icon: '🛡️' },
] as const;

type StatKey = (typeof STAT_META)[number]['key'];

const tierNames: Record<number, string> = { 1: '普通精华', 2: '稀有精华', 3: '史诗精华', 4: '传说精华' };

export function CharacterPage() {
  const { user, refreshUser } = useAuth();
  const char = user?.character;
  const cap = (char?.level ?? 1) + 4;

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<MaterialHolding[]>('/materials'),
    enabled: !!char,
  });
  const mat1 = materials?.find((m) => m.tier === 1);
  const mat1Count = mat1?.count ?? 0;

  const init = useMutation({
    mutationFn: async () => {
      await api.post<AuthUser>('/auth/character', { hpLv: 3, atkLv: 3, defLv: 3 });
      await refreshUser();
    },
    onError: () => {
      /* error handled in render via init.error */
    },
  });

  const strengthen = useMutation({
    mutationFn: async (stat: StatKey) => {
      await api.post<AuthUser>('/auth/strengthen', { stat });
    },
    onSuccess: async () => {
      await refreshUser();
    },
    onError: () => {
      /* error handled in render via strengthen.error */
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
              {STAT_META.map((s) => {
                const value = char[s.field];
                return (
                  <StatRow
                    key={s.key}
                    meta={s}
                    value={value}
                    cap={cap}
                    cost={STRENGTHEN_COST[s.key]}
                    coins={user?.coins ?? 0}
                    materialCount={mat1Count}
                    busy={strengthen.isPending}
                    onStrengthen={() => strengthen.mutate(s.key)}
                  />
                );
              })}
              {strengthen.error && (
                <p className="mt-3 text-sm text-red-400">
                  {strengthen.error instanceof Error ? strengthen.error.message : '强化失败'}
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">金币</span>
                <span className="font-semibold text-amber-400">{user?.coins}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-400">普通精华 ×{mat1Count}</span>
                <span className="text-xs text-slate-500">生存 Run 掉落 · 强化 +1 消耗</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatRowProps {
  meta: (typeof STAT_META)[number];
  value: number;
  cap: number;
  cost: { coins: number; materialTier: number; materialCount: number };
  coins: number;
  materialCount: number;
  busy: boolean;
  onStrengthen: () => void;
}

function StatRow({ meta, value, cap, cost, coins, materialCount, busy, onStrengthen }: StatRowProps) {
  const atCap = value >= cap;
  const enough = coins >= cost.coins && materialCount >= cost.materialCount;
  const disabled = atCap || !enough || busy;
  const pct = Math.min(100, value * 12.5);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {meta.icon} {meta.label} <span className="tabular-nums">{value}</span>
          <span className="ml-1 text-slate-600">/ 上限 {cap}</span>
        </span>
        <span className="text-[11px] text-slate-500">
          {cost.coins}💰 + {cost.materialCount}×{tierNames[cost.materialTier] ?? '材料'}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${meta.color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <button
        onClick={onStrengthen}
        disabled={disabled}
        title={atCap ? '已达当前等级上限，升级角色解锁' : !enough ? '金币或材料不足' : undefined}
        className={`mt-1.5 w-full rounded-lg py-1.5 text-xs font-semibold transition ${
          atCap
            ? 'cursor-not-allowed bg-slate-800/60 text-slate-600'
            : !enough
              ? 'cursor-not-allowed bg-slate-800/60 text-slate-500'
              : `bg-slate-800 ${meta.text} hover:bg-slate-700`
        } disabled:opacity-60`}
      >
        {busy ? '强化中…' : atCap ? '已达上限' : !enough ? '材料/金币不足' : `强化 +1（${meta.label}）`}
      </button>
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