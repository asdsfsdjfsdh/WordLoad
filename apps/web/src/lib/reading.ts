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

// 点词查义：篇内词表未命中时回退单词库
export function lookupReadingWordApi(
  passageId: number,
  word: string,
): Promise<import('@word-journey/shared').ReadingWordLookupResult> {
  return api.get<import('@word-journey/shared').ReadingWordLookupResult>(
    `/reading/passages/${passageId}/words/lookup?word=${encodeURIComponent(word)}`,
  );
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
