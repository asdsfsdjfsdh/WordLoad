// 后台 · 审计日志
import { Fragment, useEffect, useState } from 'react';
import type { AdminAuditLogListResult } from '@word-journey/shared';
import { fetchAdminAuditLogs } from '../../lib/admin';

const fmtTime = (s: string): string => new Date(s).toLocaleString('zh-CN');
const tables = ['word', 'readingPassage', 'readingSentence', 'readingQuestion', 'readingGlossary', 'user'];
const actions = ['save', 'create', 'delete'];

export function AdminAuditPage() {
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [admin, setAdmin] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminAuditLogListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pageSize = 20;

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await fetchAdminAuditLogs({ table: table || undefined, action: action || undefined, admin: admin || undefined, page, pageSize }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [table, action, admin, page]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={table} onChange={(e) => { setTable(e.target.value); setPage(1); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200">
          <option value="">全部表</option>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200">
          <option value="">全部操作</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          value={admin}
          onChange={(e) => { setAdmin(e.target.value); setPage(1); }}
          placeholder="操作者用户名…"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200 placeholder-slate-500"
        />
      </div>

      {loading && <div className="text-slate-500">加载中…</div>}
      {!loading && data && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2">#</th>
                <th>操作者</th>
                <th>操作</th>
                <th>表</th>
                <th>记录ID</th>
                <th>时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && <tr><td className="py-4 text-slate-500" colSpan={7}>暂无日志</td></tr>}
              {data.items.map((l) => (
                <Fragment key={l.id}>
                  <tr className="border-t border-slate-800">
                    <td className="py-2 text-slate-400">{l.id}</td>
                    <td className="text-cyan-300">{l.adminUsername}</td>
                    <td>
                      <span className={'rounded px-1.5 py-0.5 text-xs ' + (l.action === 'delete' ? 'bg-red-500/20 text-red-300' : l.action === 'create' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/20 text-sky-300')}>{l.action}</span>
                    </td>
                    <td className="text-slate-300">{l.table}</td>
                    <td className="font-mono text-xs text-slate-400">{l.recordId}</td>
                    <td className="text-slate-500">{fmtTime(l.createdAt)}</td>
                    <td className="text-right">
                      <button onClick={() => setExpanded(expanded === l.id ? null : l.id)} className="text-xs text-slate-400 hover:text-cyan-300">
                        {expanded === l.id ? '收起' : (l.before !== undefined || l.after !== undefined ? '详情' : '—')}
                      </button>
                    </td>
                  </tr>
                  {expanded === l.id && (l.before !== undefined || l.after !== undefined) && (
                    <tr className="border-t border-slate-800/60 bg-slate-950/60">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-slate-500">变更前</div>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-slate-300">{l.before === undefined ? '(无)' : JSON.stringify(l.before, null, 2)}</pre>
                          </div>
                          <div>
                            <div className="mb-1 text-slate-500">变更后</div>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-slate-300">{l.after === undefined ? '(无)' : JSON.stringify(l.after, null, 2)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
            <span>共 {data.total} 条 · 第 {page} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">上一页</button>
              <button disabled={page * pageSize >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">下一页</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
