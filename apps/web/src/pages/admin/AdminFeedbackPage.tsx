// 后台 · 反馈管理
import { useEffect, useState } from 'react';
import type { AdminFeedbackListResult } from '@word-journey/shared';
import { fetchAdminFeedback, replyAdminFeedback } from '../../lib/admin';

const typeLabel: Record<string, string> = { suggestion: '💡 建议', bug: '🐞 Bug', other: '📝 其他' };
const statusLabel: Record<string, string> = { open: '待处理', done: '已处理', ignored: '已忽略' };
const statusColor: Record<string, string> = { open: 'bg-amber-500/20 text-amber-300', done: 'bg-emerald-500/20 text-emerald-300', ignored: 'bg-slate-600/30 text-slate-400' };
const fmtTime = (s?: string): string => (s ? new Date(s).toLocaleString('zh-CN') : '-');

export function AdminFeedbackPage() {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminFeedbackListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<'open' | 'done' | 'ignored'>('open');
  const [editReply, setEditReply] = useState('');
  const [msg, setMsg] = useState('');
  const pageSize = 50;

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await fetchAdminFeedback({ status: status || undefined, type: type || undefined, page, pageSize }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status, type, page]);

  const openEdit = (id: number, cur: { status: 'open' | 'done' | 'ignored'; reply?: string }): void => {
    setEditingId(id);
    setEditStatus(cur.status);
    setEditReply(cur.reply ?? '');
  };

  const save = async (id: number): Promise<void> => {
    try {
      await replyAdminFeedback(id, { status: editStatus, reply: editReply.trim() || undefined });
      setEditingId(null);
      setMsg('已保存');
      void load();
    } catch {
      setMsg('保存失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200">
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="done">已处理</option>
          <option value="ignored">已忽略</option>
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200">
          <option value="">全部类型</option>
          <option value="suggestion">💡 建议</option>
          <option value="bug">🐞 Bug</option>
          <option value="other">📝 其他</option>
        </select>
        {msg && <span className="text-cyan-300">{msg}</span>}
      </div>

      {loading && <div className="text-slate-500">加载中…</div>}
      {!loading && data && (
        <>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            {data.total === 0 ? (
              <div className="py-8 text-center text-slate-500">暂无反馈</div>
            ) : (
              <div className="space-y-3">
                {data.items.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-cyan-300">{f.username}</span>
                      <span className="text-slate-500">#{f.userId}</span>
                      <span className="text-slate-400">{typeLabel[f.type]}</span>
                      <span className={'rounded px-1.5 py-0.5 ' + (statusColor[f.status] ?? '')}>{statusLabel[f.status] ?? f.status}</span>
                      <span className="ml-auto text-slate-500">{fmtTime(f.createdAt)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{f.content}</p>
                    {f.contact && <p className="mt-1 text-xs text-slate-500">联系方式：{f.contact}</p>}
                    {f.reply && editingId !== f.id && <p className="mt-2 text-xs text-cyan-300">回复：{f.reply}</p>}

                    {editingId === f.id ? (
                      <div className="mt-3 space-y-2">
                        <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'open' | 'done' | 'ignored')} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                          <option value="open">待处理</option>
                          <option value="done">已处理</option>
                          <option value="ignored">已忽略</option>
                        </select>
                        <textarea value={editReply} onChange={(e) => setEditReply(e.target.value)} rows={2} maxLength={2000} placeholder="回复内容（可选）" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200 placeholder-slate-500" />
                        <div className="flex gap-2">
                          <button onClick={() => void save(f.id)} className="rounded-lg bg-cyan-500 px-3 py-1 text-sm font-bold text-slate-950">保存</button>
                          <button onClick={() => setEditingId(null)} className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-400">取消</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => openEdit(f.id, { status: f.status, reply: f.reply })} className="mt-2 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300">回复 / 处理</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>共 {data.total} 条 · 第 {page} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((x) => x - 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">上一页</button>
              <button disabled={page * pageSize >= data.total} onClick={() => setPage((x) => x + 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">下一页</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
