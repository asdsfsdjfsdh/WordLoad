import { useEffect, useState } from 'react';

// 触屏检测：iPad Safari 对 (pointer: coarse) 可能误报为 false，
// 需 any-pointer + maxTouchPoints + ontouchstart 多重兜底
function computeTouch(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = (q: string): boolean => window.matchMedia(q).matches;
  if (mq('(pointer: coarse)') || mq('(any-pointer: coarse)')) return true;
  if (navigator.maxTouchPoints > 0) return true;
  return 'ontouchstart' in window;
}

export function isTouchDevice(): boolean {
  return computeTouch();
}

// 触屏（iPad/手机）检测：粗指针视为触屏设备，用于切换输入方式与布局
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState<boolean>(() => computeTouch());

  useEffect(() => {
    const qs = ['(pointer: coarse)', '(any-pointer: coarse)'];
    const mqs = qs.map((q) => window.matchMedia(q));
    const onChange = (): void => setTouch(computeTouch());
    mqs.forEach((m) => m.addEventListener('change', onChange));
    return () => mqs.forEach((m) => m.removeEventListener('change', onChange));
  }, []);

  return touch;
}
