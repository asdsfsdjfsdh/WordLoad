import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser, MaterialHolding, SynthesizeResult } from '@word-journey/shared';
import { SPECIALIZE, STRENGTHEN_COST, SYNTHESIZE, SYNERGY_RECIPES, type SpecializeKind } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

const STAT_META = [
  { key: 'hp', field: 'hpLv', label: '生命', color: 'bg-emerald-500', text: 'text-emerald-300', icon: '❤️' },
  { key: 'atk', field: 'atkLv', label: '攻击', color: 'bg-red-500', text: 'text-red-300', icon: '⚔️' },
  { key: 'def', field: 'defLv', label: '防御', color: 'bg-sky-500', text: 'text-sky-300', icon: '🛡️' },
] as const;

type StatKey = (typeof STAT_META)[number]['key'];

const tierNames: Record<number, string> = { 1: '普通精华', 2: '稀有精华', 3: '史诗精华', 4: '传说精华' };
const tierColor: Record<number, string> = {
  1: 'border-slate-600 text-slate-300',
  2: 'border-sky-500/60 text-sky-300',
  3: 'border-violet-500/60 text-violet-300',
  4: 'border-amber-500/60 text-amber-300',
};

const SPEC_DEFS = [
  {
    key: 'execute' as const,
    field: 'executeSpec' as const,
    icon: '⚔️',
    label: '斩杀词根',
    desc: '词长 ≥ 8 的单词，对该怪首击伤害 +1',
  },
  {
    key: 'vampire' as const,
    field: 'vampireSpec' as const,
    icon: '🩸',
    label: '复习专精',
    desc: '复习词（非新词）触发吸血时回复 2 血',
  },
] as const;

export function CharacterPage() {
  const { user, refreshUser } = useAuth();
  const char = user?.character;
  const cap = (char?.level ?? 1) + 4;
  const [synthFrom, setSynthFrom] = useState<1 | 2 | 3>(1);

  const { data: materials, refetch: refetchMaterials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<MaterialHolding[]>('/materials'),
    enabled: !!char,
  });
  const countOf = (tier: number): number => materials?.find((m) => m.tier === tier)?.count ?? 0;
  const mat1Count = countOf(1);

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
      await Promise.all([refreshUser(), refetchMaterials()]);
    },
    onError: () => {
      /* error handled in render via strengthen.error */
    },
  });

  const synthesize = useMutation({
    mutationFn: async (fromTier: 1 | 2 | 3) => api.post<SynthesizeResult>('/materials/synthesize', { fromTier }),
    onSuccess: async () => {
      await Promise.all([refreshUser(), refetchMaterials()]);
    },
    onError: () => {
      /* error handled in render via synthesize.error */
    },
  });

  const specialize = useMutation({
    mutationFn: async (spec: SpecializeKind) => api.post<AuthUser>('/auth/specialize', { spec }),
    onSuccess: async () => {
      await Promise.all([refreshUser(), refetchMaterials()]);
    },
    onError: () => {
      /* error handled in render via specialize.error */
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <Link to="/lobby" className="text-sm text-slate-400 hover:text-cyan-400">
          ← 返回大厅
        </Link>

        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-cyan-400">养成面板</h1>
          <span className="hidden text-xs text-slate-500 sm:block">强化 · 合成 · 特化 · 协同图鉴</span>
        </div>

        {!char ? (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
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
          <div className="mt-5 space-y-4">
            {/* 角色总览 */}
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-900/90 p-5 shadow-[0_0_24px_rgba(6,182,212,0.08)] md:p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-3xl shadow-[0_0_18px_rgba(6,182,212,0.25)]">
                  ⚔️
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-400">冒险者</span>
                    <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-sm font-bold text-amber-400">
                      Lv.{char.level}
                    </span>
                  </div>
                  <ExpBar exp={char.exp} level={char.level} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs">
                  <span className="text-slate-400">💰 金币</span>
                  <span className="ml-1.5 font-bold tabular-nums text-amber-300">{user?.coins}</span>
                </div>
                {[1, 2, 3, 4].map((tier) => (
                  <div key={tier} className={`rounded-xl border bg-slate-950/40 px-3 py-1.5 text-xs ${tierColor[tier]}`}>
                    <span className="font-bold tabular-nums">{countOf(tier)}</span>
                    <span className="ml-1.5 text-[10px] opacity-80">{tierNames[tier]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* 左列：属性强化 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">⚔️ 属性强化</span>
                  <span className="text-[11px] text-slate-500">上限 = 等级 + 4</span>
                </div>
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

              {/* 右列：合成 / 特化 / 图鉴 */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">🧪 材料合成</span>
                    <span className="text-[11px] text-slate-500">
                      {SYNTHESIZE.SOURCE_COUNT}×低阶 + {SYNTHESIZE.FEE_PER_TIER}·N 💰 → 1×高阶
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map((t) => {
                      const enough = countOf(t) >= SYNTHESIZE.SOURCE_COUNT && (user?.coins ?? 0) >= SYNTHESIZE.FEE_PER_TIER * t;
                      return (
                        <button
                          key={t}
                          onClick={() => { setSynthFrom(t); synthesize.reset(); }}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                            synthFrom === t
                              ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300'
                              : `border-slate-700 text-slate-400 hover:border-slate-600 ${enough ? '' : 'opacity-50'}`
                          }`}
                        >
                          {tierNames[t]} → {tierNames[t + 1]}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => synthesize.mutate(synthFrom)}
                    disabled={
                      synthesize.isPending ||
                      countOf(synthFrom) < SYNTHESIZE.SOURCE_COUNT ||
                      (user?.coins ?? 0) < SYNTHESIZE.FEE_PER_TIER * synthFrom
                    }
                    className="mt-2 w-full rounded-lg bg-slate-800 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {synthesize.isPending
                      ? '合成中…'
                      : `合成（消耗 ${SYNTHESIZE.SOURCE_COUNT}×${tierNames[synthFrom]} + ${SYNTHESIZE.FEE_PER_TIER * synthFrom}💰）`}
                  </button>
                  {synthesize.isSuccess && (
                    <p className="mt-2 text-xs text-emerald-400">✓ 合成成功，获得 1×{tierNames[synthFrom + 1]}</p>
                  )}
                  {synthesize.error && (
                    <p className="mt-2 text-xs text-red-400">
                      {synthesize.error instanceof Error ? synthesize.error.message : '合成失败'}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">✨ 角色特化</span>
                    <span className="text-[11px] text-slate-500">消耗史诗精华 · 永久生效</span>
                  </div>
                  {SPEC_DEFS.map((s) => {
                    const active = char?.[s.field];
                    const cost = SPECIALIZE[s.key];
                    const enough = (user?.coins ?? 0) >= cost.coins && countOf(cost.materialTier) >= cost.materialCount;
                    return (
                      <div key={s.key} className="mb-2 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                        <span className="text-xl">{s.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-200">{s.label}</div>
                          <div className="text-[11px] leading-snug text-slate-500">{s.desc}</div>
                          <div className="mt-0.5 text-[10px] text-slate-600">
                            {cost.coins}💰 + {cost.materialCount}×{tierNames[cost.materialTier]}
                          </div>
                        </div>
                        {active ? (
                          <span className="shrink-0 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                            ✓ 已激活
                          </span>
                        ) : (
                          <button
                            onClick={() => specialize.mutate(s.key)}
                            disabled={specialize.isPending || !enough}
                            className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                              enough
                                ? 'bg-slate-800 text-cyan-300 hover:bg-slate-700'
                                : 'cursor-not-allowed bg-slate-800/60 text-slate-600'
                            } disabled:opacity-60`}
                            title={enough ? undefined : '史诗精华或金币不足'}
                          >
                            {specialize.isPending ? '点亮中…' : '激活'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {specialize.error && (
                    <p className="mt-2 text-xs text-red-400">
                      {specialize.error instanceof Error ? specialize.error.message : '激活失败'}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">📖 协同配方图鉴</span>
                    <span className="text-[11px] text-slate-500">生存模式 buff 组合 · 共 {SYNERGY_RECIPES.length} 条</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SYNERGY_RECIPES.map((s) => (
                      <div key={s.code} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                        <span className="text-base leading-5">{s.icon}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-amber-300">{s.label}</div>
                          <div className="text-[11px] leading-snug text-slate-500">{s.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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
          <span className="mr-1">{meta.icon}</span>
          <span className="font-medium text-slate-300">{meta.label}</span>
          <span className={`ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${atCap ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-200'}`}>
            {value}<span className="text-slate-500">/{cap}</span>
          </span>
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
        <span className="tabular-nums">
          {pct}% · 还需 {Math.max(0, toNext - inLevel)} 升级
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}