// 后台管理 API 封装
import type {
  AdminAuditLogListResult,
  AdminFeedbackListResult,
  AdminGlossaryUpdate,
  AdminPassageEdit,
  AdminQuestionUpdate,
  AdminSentenceUpdate,
  AdminStatsOverview,
  AdminStatsTrend,
  AdminUserDetail,
  AdminUserListResult,
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

// 运营总览
export function fetchAdminStats(): Promise<AdminStatsOverview> {
  return api.get<AdminStatsOverview>('/admin/stats/overview');
}

export function fetchAdminStatsTrend(days = 14): Promise<AdminStatsTrend> {
  return api.get<AdminStatsTrend>('/admin/stats/trend?days=' + days);
}

// 用户管理
export function fetchAdminUsers(params: { q?: string; page?: number; pageSize?: number }): Promise<AdminUserListResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return api.get<AdminUserListResult>('/admin/users?' + qs.toString());
}

export function fetchAdminUser(id: number): Promise<AdminUserDetail> {
  return api.get<AdminUserDetail>('/admin/users/' + id);
}

export function setAdminUserAdmin(id: number, isAdmin: boolean): Promise<{ ok: true; isAdmin: boolean }> {
  return api.put<{ ok: true; isAdmin: boolean }>('/admin/users/' + id + '/admin', { isAdmin });
}

// 审计日志
export interface AdminAuditFilter {
  table?: string;
  action?: string;
  admin?: string;
  page?: number;
  pageSize?: number;
}

export function fetchAdminAuditLogs(params: AdminAuditFilter): Promise<AdminAuditLogListResult> {
  const qs = new URLSearchParams();
  if (params.table) qs.set('table', params.table);
  if (params.action) qs.set('action', params.action);
  if (params.admin) qs.set('admin', params.admin);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return api.get<AdminAuditLogListResult>('/admin/audit-logs?' + qs.toString());
}


// 反馈管理
export interface AdminFeedbackFilter { status?: string; type?: string; page?: number; pageSize?: number; }

export function fetchAdminFeedback(params: AdminFeedbackFilter): Promise<AdminFeedbackListResult> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 50));
  return api.get<AdminFeedbackListResult>('/admin/feedback?' + qs.toString());
}

export function replyAdminFeedback(id: number, input: { status: 'open' | 'done' | 'ignored'; reply?: string }): Promise<AdminFeedbackListResult['items'][number]> {
  return api.post<AdminFeedbackListResult['items'][number]>('/admin/feedback/' + id + '/reply', input);
}

