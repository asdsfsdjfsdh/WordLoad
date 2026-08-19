// 后台 · 用户管理
import { useEffect, useState } from 'react';
import type { AdminUserDetail, AdminUserListResult } from '@word-journey/shared';
import { fetchAdminUser, fetchAdminUsers, setAdminUserAdmin } from '../../lib/admin';

const fmtTime = (s?: string | null): string => (s ? new Date(s).toLocaleString('zh-CN') : '-');

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUserListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [msg, setMsg] = useState('');
  const pageSize = 20;

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchAdminUsers({ q, page, pageSize }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [q, page]);

  const open = async (id: number) => {
    setDetail(await fetchAdminUser(id));
  };

  const toggle = async (id: number, makeAdmin: boolean) => {
    try {
      await setAdminUserAdmin(id, makeAdmin);
      if (detail && detail.id === id) setDetail({ ...detail, isAdmin: makeAdmin });
      setMsg((makeAdmin ? '已设为管理员：' : '已取消管理员：') + '#' + id);
      void load();
    } catch (e) {
      setMsg('操作失败：' + ((e as Error).message || '未知错误'));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="按用户名搜索…"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
        />
        {msg && <span className="text-sm text-cyan-300">{msg}</span>}
      </div>

      {loading && <div className="text-slate-500">加载中…</div>}
      {!loading && data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-2">ID</th>
                  <th>用户名</th>
                  <th>管理员</th>
                  <th>金币</th>
                  <th>等级</th>
                  <th>Run</th>
                  <th>已学词</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr><td className="py-4 text-slate-500" colSpan={7}>无匹配用户</td></tr>
                )}
                {data.items.map((u) => (
                  <tr key={u.id} onClick={() => void open(u.id)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 text-slate-400">{u.id}</td>
                    <td className="text-cyan-300">{u.username}</td>
                    <td>{u.isAdmin ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">是</span> : <span className="text-slate-600">否</span>}</td>
                    <td className="text-slate-300">{u.coins}</td>
                    <td className="text-slate-300">{u.charLevel}</td>
                    <td className="text-slate-300">{u.runCount}</td>
                    <td className="text-slate-300">{u.wordsLearned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>共 {data.total} 个用户 · 第 {page} 页</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">上一页</button>
                <button disabled={page * pageSize >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40">下一页</button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-bold text-slate-300">用户详情</h2>
            {!detail ? (
              <div className="text-sm text-slate-500">点击左侧用户查看详情</div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg font-bold text-cyan-300">{detail.username}</span>
                    <span className="ml-2 text-slate-500">#{detail.id}</span>
                  </div>
                  <button
                    onClick={() => void toggle(detail.id, !detail.isAdmin)}
                    className={'rounded-lg px-3 py-1 font-medium ' + (detail.isAdmin ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300')}
                  >
                    {detail.isAdmin ? '取消管理员' : '设为管理员'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-800/60 p-2"><div className="text-lg font-bold text-slate-100">{detail.coins}</div><div className="text-xs text-slate-500">金币</div></div>
                  <div className="rounded-lg bg-slate-800/60 p-2"><div className="text-lg font-bold text-slate-100">{detail.character?.level ?? '-'}</div><div className="text-xs text-slate-500">等级</div></div>
                  <div className="rounded-lg bg-slate-800/60 p-2"><div className="text-lg font-bold text-slate-100">{fmtTime(detail.createdAt)}</div><div className="text-xs text-slate-500">注册时间</div></div>
                </div>
                <div className="rounded-lg border border-slate-800 p-3">
                  <div className="mb-2 text-xs font-bold text-slate-500">学习进度</div>
                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div>已学词（掌握）：<b className="text-cyan-300">{detail.progress.wordsLearned}</b></div>
                    <div>错题本：<b className="text-cyan-300">{detail.progress.inWrongBook}</b></div>
                    <div>生词本：<b className="text-cyan-300">{detail.progress.inVocabBook}</b></div>
                    <div>义项进度：<b className="text-cyan-300">{detail.progress.senseProgress}</b></div>
                    <div>阅读篇数：<b className="text-cyan-300">{detail.progress.readingPapers}</b></div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 p-3">
                  <div className="mb-2 text-xs font-bold text-slate-500">最近 Run（最多 20 条）</div>
                  {detail.runs.length === 0 ? <div className="text-slate-600">暂无</div> : (
                    <table className="w-full text-xs">
                      <tbody>
                        {detail.runs.map((r) => (
                          <tr key={r.id} className="border-t border-slate-800">
                            <td className="py-1.5 text-slate-400">#{r.id}</td>
                            <td className="text-slate-200">{r.kind}</td>
                            <td className="text-slate-300">{r.status}</td>
                            <td className="text-slate-300">D{r.day}</td>
                            <td className={'font-bold ' + (r.cleared ? 'text-amber-300' : 'text-slate-300')}>{r.rating}</td>
                            <td className="text-right text-slate-500">{fmtTime(r.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
