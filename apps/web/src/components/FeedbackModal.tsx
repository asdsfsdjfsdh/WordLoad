// 意见 / Bug 反馈弹窗：提交 + 查看我的反馈
import { useEffect, useState } from 'react';
import type { FeedbackView } from '@word-journey/shared';
import { fetchMyFeedback, submitFeedback } from '../lib/feedback';

const typeLabel: Record<string, string> = { suggestion: '💡 建议', bug: '🐞 Bug', other: '📝 其他' };
const statusLabel: Record<string, string> = { open: '待处理', done: '已处理', ignored: '已忽略' };
const statusColor: Record<string, string> = { open: 'bg-amber-500/20 text-amber-300', done: 'bg-emerald-500/20 text-emerald-300', ignored: 'bg-slate-600/30 text-slate-400' };

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<'suggestion' | 'bug' | 'other'>('suggestion');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState<FeedbackView[]>([]);

  const load = (): void => {
    void fetchMyFeedback().then((r) => setItems(r.items)).catch(() => undefined);
  };

  useEffect(load, []);

  const submit = async (): Promise<void> => {
    if (!content.trim()) { setMsg('请填写内容'); return; }
    setSubmitting(true);
    try {
      await submitFeedback({ type, content: content.trim(), contact: contact.trim() || undefined });
      setMsg('已提交，感谢反馈！');
      setContent('');
      setContact('');
      load();
    } catch {
      setMsg('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-cyan-300">意见 / Bug 反馈</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(['suggestion', 'bug', 'other'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ' + (type === t ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300' : 'border-slate-700 text-slate-400 hover:text-slate-200')}>
                {typeLabel[t]}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="描述你的建议或遇到的问题…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={128}
            placeholder="联系方式（可选，方便回复）"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              disabled={submitting}
              onClick={() => void submit()}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '提交'}
            </button>
            {msg && <span className="text-sm text-cyan-300">{msg}</span>}
          </div>
        </div>

        {items.length > 0 && (
          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="mb-2 text-sm font-bold text-slate-400">我的反馈</h3>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {items.map((f) => (
                <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{typeLabel[f.type]}</span>
                    <span className={'rounded px-1.5 py-0.5 text-xs ' + (statusColor[f.status] ?? '')}>{statusLabel[f.status] ?? f.status}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-200">{f.content}</p>
                  {f.reply && <p className="mt-2 text-xs text-cyan-300">运营回复：{f.reply}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
