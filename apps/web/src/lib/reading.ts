// 真题阅读 API 封装
import type {
  ReadingMarkWordResponse,
  ReadingPaperSummary,
  ReadingPassageDetail,
  ReadingPassageSummary,
  ReadingProgressUpdateRequest,
  ReadingSubmitAnswerInput,
  ReadingSubmitResponse,
} from '@word-journey/shared';
import { api } from './api';

export function fetchReadingPapers(): Promise<ReadingPaperSummary[]> {
  return api.get<ReadingPaperSummary[]>('/reading/papers');
}

export function fetchReadingPassages(paperId: number): Promise<ReadingPassageSummary[]> {
  return api.get<ReadingPassageSummary[]>(`/reading/papers/${paperId}/passages`);
}

export function fetchReadingPassageDetail(passageId: number): Promise<ReadingPassageDetail> {
  return api.get<ReadingPassageDetail>(`/reading/passages/${passageId}`);
}

export function submitReadingAnswers(
  passageId: number,
  answers: ReadingSubmitAnswerInput[],
): Promise<ReadingSubmitResponse> {
  return api.post<ReadingSubmitResponse>(`/reading/passages/${passageId}/submit`, { answers });
}

export function saveReadingProgress(
  passageId: number,
  body: ReadingProgressUpdateRequest,
): Promise<{ ok: true }> {
  return api.post<{ ok: true }>(`/reading/passages/${passageId}/progress`, body);
}

export function markReadingWord(
  passageId: number,
  word: string,
  action: 'save' | 'remove',
): Promise<ReadingMarkWordResponse> {
  return api.post<ReadingMarkWordResponse>(`/reading/passages/${passageId}/words/mark`, { word, action });
}
