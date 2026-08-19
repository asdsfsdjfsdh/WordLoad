// 意见 / Bug 反馈（用户侧）
import type { FeedbackCreateInput, FeedbackListResult, FeedbackView } from '@word-journey/shared';
import { api } from './api';

export function submitFeedback(input: FeedbackCreateInput): Promise<FeedbackView> {
  return api.post<FeedbackView>('/feedback', input);
}

export function fetchMyFeedback(): Promise<FeedbackListResult> {
  return api.get<FeedbackListResult>('/feedback/mine');
}
