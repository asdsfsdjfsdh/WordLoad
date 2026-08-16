// 后台 · 阅读库：篇章元信息 / 句子（含结构）/ 题目 / 词表 编辑
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminPassageEdit, ReadingSentenceStructure } from '@word-journey/shared';
import {
  fetchAdminPassage,
  fetchAdminReadingPapers,
  saveAdminGlossary,
  saveAdminPassageMeta,
  saveAdminQuestion,
  saveAdminSentence,
} from '../../lib/admin';
import type { AdminReadingPaperRow } from '../../lib/admin';

export function AdminReadingPage() {
  const [papers, setPapers] = useState<AdminReadingPaperRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [passage, setPassage] = useState<AdminPassageEdit | null>(null);
  const [meta, setMeta] = useState({ title: '', subtitle: '' });
  const [msg, setMsg] = useState('');
  const [sentenceDrafts, setSentenceDrafts] = useState<Record<number, { en: string; zh: string; structure: string }>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<number, { stem: string; A: string; B: string; C: string; D: string; answer: string; analysis: string }>>({});
  const [glossaryDrafts, setGlossaryDrafts] = useState<Record<number, { word: string; meaning: string }>>({});
  const queryClient = useQueryClient();

  const invalidateReading = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['reading'] });
  };

  useEffect(() => {
    void fetchAdminReadingPapers().then(setPapers).catch(() => setPapers([]));
  }, []);

  const openPassage = async (id: number): Promise<void> => {
    setActiveId(id);
    const p = await fetchAdminPassage(id);
    setPassage(p);
    setMeta({ title: p.title, subtitle: p.subtitle ?? '' });
    setSentenceDrafts(Object.fromEntries(p.sentences.map((s) => [s.id, { en: s.en, zh: s.zh, structure: s.structure ? JSON.stringify(s.structure, null, 2) : '' }])));
    setQuestionDrafts(Object.fromEntries(p.questions.map((q) => [q.id, { stem: q.stem, A: q.options.A, B: q.options.B, C: q.options.C, D: q.options.D, answer: q.answer, analysis: q.analysis }])));
    setGlossaryDrafts(Object.fromEntries(p.glossary.map((g) => [g.id, { word: g.word, meaning: g.meaning }])));
  };

  const saveMeta = async (): Promise<void> => {
    if (!activeId) return;
    await saveAdminPassageMeta(activeId, { title: meta.title, subtitle: meta.subtitle || null });
    setMsg('元信息已保存');
    invalidateReading();
  };

  const saveSentence = async (id: number): Promise<void> => {
    const d = sentenceDrafts[id];
    if (!d) return;
    let structure: ReadingSentenceStructure | null = null;
    if (d.structure.trim()) {
      try {
        structure = JSON.parse(d.structure) as ReadingSentenceStructure;
      } catch {
        setMsg(`句子 ${id} 的 JSON 解析失败`);
        return;
      }
    }
    await saveAdminSentence(id, { en: d.en, zh: d.zh, structure });
    setMsg(`句子 ${id} 已保存`);
    invalidateReading();
  };

  const saveQuestion = async (id: number): Promise<void> => {
    const d = questionDrafts[id];
    if (!d) return;
    await saveAdminQuestion(id, {
      stem: d.stem,
      options: { A: d.A, B: d.B, C: d.C, D: d.D },
      answer: d.answer,
      analysis: d.analysis,
    });
    setMsg(`题目 ${id} 已保存`);
    invalidateReading();
  };

  const saveGlossary = async (id: number): Promise<void> => {
    const d = glossaryDrafts[id];
    if (!d) return;
    await saveAdminGlossary(id, { word: d.word, meaning: d.meaning });
    setMsg(`词表条目 ${id} 已保存`);
    invalidateReading();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      {/* 卷/篇 导航 */}
      <aside>
        {papers.map((paper) => (
          <div key={paper.id} className="mb-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="mb-2 text-sm font-bold text-slate-200">{paper.year} 年</div>
            <div className="space-y-1">
              {paper.passages.map((pa) => (
                <button
                  key={pa.id}
                  onClick={() => void openPassage(pa.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                    activeId === pa.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <span className="font-bold">{pa.code}</span>
                  <span className="truncate">{pa.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {papers.length === 0 && <p className="text-sm text-slate-500">暂无阅读数据</p>}
      </aside>

      {/* 编辑器 */}
      <section className="min-w-0 space-y-6">
        {msg && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{msg}</div>}

        {passage && (
          <>
            {/* 元信息 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-200">
                {passage.paperYear} {passage.title}（{passage.code}）
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="标题" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none" />
                <input value={meta.subtitle} onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })} placeholder="副标题" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none" />
                <button onClick={() => void saveMeta()} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">保存元信息</button>
              </div>
            </div>

            {/* 句子 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-200">句子（{passage.sentences.length}）· 可编辑 原文/译文/结构JSON</div>
              <div className="space-y-3">
                {passage.sentences.map((s) => {
                  const d = sentenceDrafts[s.id];
                  if (!d) return null;
                  return (
                    <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                        <span>seq {s.seq} · para {s.para}</span>
                        <button onClick={() => void saveSentence(s.id)} className="text-cyan-400 hover:underline">保存</button>
                      </div>
                      <textarea value={d.en} onChange={(e) => setSentenceDrafts({ ...sentenceDrafts, [s.id]: { ...d, en: e.target.value } })}
                        className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm leading-6 outline-none focus:border-cyan-500/40" rows={2} />
                      <textarea value={d.zh} onChange={(e) => setSentenceDrafts({ ...sentenceDrafts, [s.id]: { ...d, zh: e.target.value } })}
                        className="mt-1 w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm leading-6 text-slate-300 outline-none focus:border-cyan-500/40" rows={1} />
                      <textarea value={d.structure} onChange={(e) => setSentenceDrafts({ ...sentenceDrafts, [s.id]: { ...d, structure: e.target.value } })}
                        placeholder="结构JSON（可空）"
                        className="mt-1 w-full rounded border border-violet-800/40 bg-slate-900 px-2 py-1.5 font-mono text-xs leading-5 text-violet-200 outline-none focus:border-violet-500/40" rows={3} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 题目 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-200">题目（{passage.questions.length}）</div>
              <div className="space-y-3">
                {passage.questions.map((q) => {
                  const d = questionDrafts[q.id];
                  if (!d) return null;
                  return (
                    <div key={q.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-2">
                          #{q.seq}
                          {q.remark && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">{q.remark}</span>
                          )}
                        </span>
                        <button onClick={() => void saveQuestion(q.id)} className="text-cyan-400 hover:underline">保存</button>
                      </div>
                      <textarea value={d.stem} onChange={(e) => setQuestionDrafts({ ...questionDrafts, [q.id]: { ...d, stem: e.target.value } })}
                        className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm leading-6 outline-none focus:border-cyan-500/40" rows={1} />
                      <div className="mt-1 grid gap-1 sm:grid-cols-2">
                        {(['A', 'B', 'C', 'D'] as const).map((l) => (
                          <input key={l} value={d[l]} onChange={(e) => setQuestionDrafts({ ...questionDrafts, [q.id]: { ...d, [l]: e.target.value } })}
                            placeholder={`选项 ${l}`}
                            className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40" />
                        ))}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-slate-500">答案</span>
                        <select value={d.answer} onChange={(e) => setQuestionDrafts({ ...questionDrafts, [q.id]: { ...d, answer: e.target.value } })}
                          className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none">
                          {['A', 'B', 'C', 'D'].map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                      <textarea value={d.analysis} onChange={(e) => setQuestionDrafts({ ...questionDrafts, [q.id]: { ...d, analysis: e.target.value } })}
                        className="mt-1 w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm leading-6 text-slate-300 outline-none focus:border-cyan-500/40" rows={2} placeholder="解析" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 词表 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-200">篇内词表（{passage.glossary.length}）</div>
              <div className="space-y-2">
                {passage.glossary.map((g) => {
                  const d = glossaryDrafts[g.id];
                  if (!d) return null;
                  return (
                    <div key={g.id} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                      <input value={d.word} onChange={(e) => setGlossaryDrafts({ ...glossaryDrafts, [g.id]: { ...d, word: e.target.value } })}
                        className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40" />
                      <input value={d.meaning} onChange={(e) => setGlossaryDrafts({ ...glossaryDrafts, [g.id]: { ...d, meaning: e.target.value } })}
                        className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-500/40" />
                      <button onClick={() => void saveGlossary(g.id)} className="text-xs text-cyan-400 hover:underline">保存</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
