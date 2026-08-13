import { buildReviewQueue, reviewPriorityOf, sortReviews, type ReviewCandidate } from './review-queue';

describe('review-queue 复习优先级', () => {
  const now = Date.now();

  it('错词最优先（inWrongBook）', () => {
    const wrong = reviewPriorityOf({ wordId: 'a', inWrongBook: true });
    expect(wrong).toBe('wrong');
    expect(reviewPriorityOf({ wordId: 'b' })).not.toBe('wrong');
  });

  it('排序：错词 → 已学未复测 → 到期 → 将到期 → 低掌握 → 其他', () => {
    const candidates: ReviewCandidate[] = [
      { wordId: 'low', mastery: 30 },
      { wordId: 'wrong', inWrongBook: true },
      { wordId: 'soon', dueAt: now + 86400000 },
      { wordId: 'due', dueAt: now - 1000 },
      { wordId: 'seen', seenCount: 1 },
      { wordId: 'other', mastery: 80 },
    ];
    const sorted = sortReviews(candidates).map((c) => c.wordId);
    expect(sorted).toEqual(['wrong', 'seen', 'due', 'soon', 'low', 'other']);
  });

  it('buildReviewQueue：取 need 个，剔除当天已排词', () => {
    const candidates: ReviewCandidate[] = [
      { wordId: 'wrong', inWrongBook: true },
      { wordId: 'due', dueAt: now - 1000 },
      { wordId: 'other' },
    ];
    const picked = buildReviewQueue({
      candidates,
      need: 2,
      usedInDay: new Set(['due']),
    }).map((c) => c.wordId);
    expect(picked).toEqual(['wrong', 'other']);
  });

  it('need<=0 返回空', () => {
    expect(buildReviewQueue({ candidates: [], need: 0 })).toHaveLength(0);
  });
});