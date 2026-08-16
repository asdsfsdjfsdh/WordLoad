// 后台管理 API 封装
import type {
  AdminGlossaryUpdate,
  AdminPassageEdit,
  AdminQuestionUpdate,
  AdminSentenceUpdate,
  AdminWordCreateInput,
  AdminWordDetail,
  AdminWordListResult,
  AdminWordSaveInput,
} from '@word-journey/shared';
import { api } from './api';

// 单词库
export function fetchAdminWords(params: { q?: string; tier?: string; page?: number; pageSize?: number }): Promise<AdminWordListResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.tier) qs.set('tier', params.tier);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return api.get<AdminWordListResult>(`/admin/words?${qs.toString()}`);
}

export function fetchAdminWord(id: string): Promise<AdminWordDetail> {
  return api.get<AdminWordDetail>(`/admin/words/${id}`);
}

export function saveAdminWord(id: string, input: AdminWordSaveInput): Promise<AdminWordDetail> {
  return api.post<AdminWordDetail>(`/admin/words/${id}`, input);
}

export function createAdminWord(input: AdminWordCreateInput): Promise<AdminWordDetail> {
  return api.post<AdminWordDetail>('/admin/words', input);
}

export function deleteAdminWord(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/admin/words/${id}`);
}

// 阅读库
export interface AdminReadingPaperRow {
  id: number;
  year: number;
  examName: string;
  passages: { id: number; code: string; title: string; order: number }[];
}

export function fetchAdminReadingPapers(): Promise<AdminReadingPaperRow[]> {
  return api.get<AdminReadingPaperRow[]>('/admin/reading/papers');
}

export function fetchAdminPassage(id: number): Promise<AdminPassageEdit> {
  return api.get<AdminPassageEdit>(`/admin/reading/passages/${id}`);
}

export function saveAdminPassageMeta(id: number, input: { title?: string; subtitle?: string | null }): Promise<{ ok: true }> {
  return api.put<{ ok: true }>(`/admin/reading/passages/${id}`, input);
}

export function saveAdminSentence(id: number, input: AdminSentenceUpdate): Promise<{ ok: true }> {
  return api.put<{ ok: true }>(`/admin/reading/sentences/${id}`, input);
}

export function saveAdminQuestion(id: number, input: AdminQuestionUpdate): Promise<{ ok: true }> {
  return api.put<{ ok: true }>(`/admin/reading/questions/${id}`, input);
}

export function saveAdminGlossary(id: number, input: AdminGlossaryUpdate): Promise<{ ok: true }> {
  return api.put<{ ok: true }>(`/admin/reading/glossary/${id}`, input);
}
