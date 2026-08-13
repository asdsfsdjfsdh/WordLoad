import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const doReset = async () => {
    setResetting(true);
    setMessage(null);
    try {
      await api.post<{ ok: boolean }>('/settings/reset-progress', {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['banks'] }),
        queryClient.invalidateQueries({ queryKey: ['collections'] }),
        queryClient.invalidateQueries({ queryKey: ['character'] }),
      ]);
      setMessage({ type: 'success', text: '学习进度已全部重置' });
      setConfirmReset(false);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '重置失败' });
    } finally {
      setResetting(false);
    }
  };

  const doLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">设置</h2>
          <button onClick={onClose} className="text-slate-500 transition hover:text-slate-200">✕</button>
        </div>

        <div className="space-y-4">
          {/* ── 重置词库记录 ── */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-1 text-sm font-medium text-slate-200">重置词库记录</div>
            <p className="mb-3 text-xs text-slate-500">清空掌握度、错题本、生词本与学习会话，回到全新状态。金币、等级、角色保留。</p>
            {confirmReset ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-400">此操作不可恢复，确定重置全部学习进度？</p>
                <div className="flex gap-2">
                  <button
                    onClick={doReset}
                    disabled={resetting}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    {resetting ? '重置中…' : '确认重置'}
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="w-full rounded-lg border border-red-800 bg-red-950/30 py-2 text-sm font-medium text-red-400 transition hover:bg-red-950/60"
              >
                重置全部学习进度
              </button>
            )}
          </div>

          {/* ── 退出登录 ── */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-1 text-sm font-medium text-slate-200">退出登录</div>
            <p className="mb-3 text-xs text-slate-500">退出当前账号，返回登录页。服务器上的进度会保留。</p>
            {confirmLogout ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-400">确定退出登录？</p>
                <div className="flex gap-2">
                  <button
                    onClick={doLogout}
                    disabled={loggingOut}
                    className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
                  >
                    {loggingOut ? '退出中…' : '确认退出'}
                  </button>
                  <button
                    onClick={() => setConfirmLogout(false)}
                    className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmLogout(true)}
                className="w-full rounded-lg border border-slate-700 py-2 text-sm font-medium text-slate-300 transition hover:border-amber-500/40 hover:text-amber-400"
              >
                退出登录
              </button>
            )}
          </div>

          {message && (
            <p className={`text-center text-sm ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}