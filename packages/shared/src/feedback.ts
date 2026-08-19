// ── 意见 / Bug 反馈 ──
export type FeedbackType = 'suggestion' | 'bug' | 'other';
export type FeedbackStatus = 'open' | 'done' | 'ignored';

// 用户可见的反馈视图
export interface FeedbackView {
  id: number;
  type: FeedbackType;
  content: string;
  contact?: string;
  status: FeedbackStatus;
  reply?: string;
  createdAt: string;
  repliedAt?: string;
}

// 提交反馈入参
export interface FeedbackCreateInput {
  type: FeedbackType;
  content: string;
  contact?: string;
}

// 我的反馈列表
export interface FeedbackListResult {
  items: FeedbackView[];
  total: number;
}

// 后台反馈行
export interface AdminFeedbackRow extends FeedbackView {
  userId: number;
  username: string;
}

export interface AdminFeedbackListResult {
  items: AdminFeedbackRow[];
  total: number;
}

// 后台回复/改状态入参
export interface AdminFeedbackReplyInput {
  status: FeedbackStatus;
  reply?: string;
}
