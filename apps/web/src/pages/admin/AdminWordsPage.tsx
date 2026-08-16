// 后台 · 单词库：搜索 / 编辑 / 新建 / 删除
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminWordDetail, AdminWordListResult } from '@word-journey/shared';
import {
  createAdminWord,
  deleteAdminWord,
  fetchAdminWord,
  fetchAdminWords,
  saveAdminWord,
} from '../../lib/admin';

interface EditDraft {
  id: string;
  text: string;
  phoneticAm: string;
  phoneticEn: string;
  tier: string;
  mnemonic: string;
  senses: { id?: number; meaning: string; example: string }[];
}

export function AdminWordsPage() {
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminWordListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [detail, setDetail] = useState<AdminWordDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const queryClient = useQueryClient();

  // 后台改动会波及用户侧数据（词书进度/阅读），失效相关缓存
  const invalidateUserCaches = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['reading'] });
    void queryClient.invalidateQueries({ queryKey: ['banks'] });
    void queryClient.invalidateQueries({ queryKey: ['collections'] });
  }, [queryClient]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminWords({ q, tier, page, pageSize: 20 });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [q, tier, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = async (id: string): Promise<void> => {
    const d = await fetchAdminWord(id);
    setDetail(d);
    setEditing({
      id: d.id,
      text: d.text,
      phoneticAm: d.phoneticAm ?? '',
      phoneticEn: d.phoneticEn ?? '',
      tier: d.tier,
      mnemonic: d.mnemonic ?? '',
      senses: d.senses.map((s) => ({ id: s.id, meaning: s.meaning, example: s.example })),
    });
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    try {
      await saveAdminWord(editing.id, {
        text: editing.text,
        phoneticAm: editing.phoneticAm || null,
        phoneticEn: editing.phoneticEn || null,
        tier: editing.tier as 'I' | 'II' | 'III' | 'IV',
        mnemonic: editing.mnemonic || null,
        senses: editing.senses,
      });
      setMsg('已保存');
      setEditing(null);
      setDetail(null);
      invalidateUserCaches();
      void load();
    } finally {
      setSaving(false);
    }
  };

  const createNew = async (): Promise<void> => {
    setEditing({
      id: '__new__',
      text: '',
      phoneticAm: '',
      phoneticEn: '',
      tier: 'I',
      mnemonic: '',
      senses: [{ meaning: '', example: '' }],
    });
    setDetail(null);
  };

  const create = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    try {
      await createAdminWord({
        text: editing.text,
        phoneticAm: editing.phoneticAm || undefined,
        phoneticEn: editing.phoneticEn || undefined,
        tier: editing.tier as 'I' | 'II' | 'III' | 'IV',
        senses: editing.senses.filter((s) => s.meaning.trim()),
      });
      setMsg('已新建');
      setEditing(null);
      invalidateUserCaches();
      void load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('确认删除该单词？')) return;
    try {
      await deleteAdminWord(id);
      setMsg('已删除');
      invalidateUserCaches();
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="按单词/释义搜索…"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
        />
        <select
          value={tier}
          onChange={(e) => {
            setTier(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none"
        >
          <option value="">全部档位</option>
          <option value="I">I</option>
          <option value="II">II</option>
          <option value="III">III</option>
          <option value="IV">IV</option>
        </select>
        <button onClick={() => void createNew()} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
          + 新建单词
        </button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
      </div>

      {loading ? (
        <p className="py-10 text-center text-slate-500">加载中…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">单词</th>
                <th className="px-3 py-2">音标</th>
                <th className="px-3 py-2">档位</th>
                <th className="px-3 py-2">词书/阶段</th>
                <th className="px-3 py-2">义项</th>
                <th className="px-3 py-2">阅读词表</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((w) => (
                <tr key={w.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                  <td className="px-3 py-2 font-medium text-slate-100">{w.text}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{w.phoneticAm || w.phoneticEn || '-'}</td>
                  <td className="px-3 py-2 text-slate-300">{w.tier}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{w.bankCode ? `${w.bankCode}@${w.stage}` : '-'}</td>
                  <td className="px-3 py-2 text-slate-300">{w.senseCount}</td>
                  <td className="px-3 py-2">{w.inReadingGlossary ? '✓' : ''}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => void openEdit(w.id)} className="mr-2 text-cyan-400 hover:underline">编辑</button>
                    <button onClick={() => void remove(w.id)} className="text-red-400 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">无匹配单词</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">上一页</button>
          <span>第 {page} 页 · 共 {data.total} 条</span>
          <button disabled={page * 20 >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">下一页</button>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="mt-10 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-100">{editing.id === '__new__' ? '新建单词' : `编辑 · ${detail?.text ?? editing.text}`}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            {detail && detail.banks.length > 0 && (
              <div className="mb-3 rounded-lg bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
                所属词书：{detail.banks.map((b) => `${b.name}@${b.stage}`).join('、')}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="单词" value={editing.text} onChange={(v) => setEditing({ ...editing, text: v })} disabled={editing.id !== '__new__'} />
              <Field label="档位" value={editing.tier} onChange={(v) => setEditing({ ...editing, tier: v })} />
              <Field label="美式音标" value={editing.phoneticAm} onChange={(v) => setEditing({ ...editing, phoneticAm: v })} />
              <Field label="英式音标" value={editing.phoneticEn} onChange={(v) => setEditing({ ...editing, phoneticEn: v })} />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs text-slate-400">记忆锚点（词根/联想）</label>
              <textarea value={editing.mnemonic} onChange={(e) => setEditing({ ...editing, mnemonic: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/50" rows={2} />
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">义项（{editing.senses.length}）</span>
                <button onClick={() => setEditing({ ...editing, senses: [...editing.senses, { meaning: '', example: '' }] })} className="text-xs text-cyan-400 hover:underline">+ 添加义项</button>
              </div>
              <div className="space-y-2">
                {editing.senses.map((s, i) => (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <input value={s.meaning} onChange={(e) => {
                      const senses = [...editing.senses];
                      senses[i] = { ...s, meaning: e.target.value };
                      setEditing({ ...editing, senses });
                    }} placeholder="释义" className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40" />
                    <input value={s.example} onChange={(e) => {
                      const senses = [...editing.senses];
                      senses[i] = { ...s, example: e.target.value };
                      setEditing({ ...editing, senses });
                    }} placeholder="例句（可空）" className="mt-1 w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">取消</button>
              <button
                onClick={() => (editing.id === '__new__' ? create() : save())}
                disabled={saving || !editing.text.trim()}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/50 disabled:opacity-50"
      />
    </div>
  );
}
