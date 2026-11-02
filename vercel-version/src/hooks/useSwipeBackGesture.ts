import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent } from 'react';

const COMPLETE_DURATION_MS = 240;
const RETURN_DURATION_MS = 260;

export function useSwipeBackGesture(onBack: () => void, enabled: boolean) {
  const [offsetX, setOffsetX] = useState(0);
  const [settling, setSettling] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const offsetRef = useRef(0);
  const gestureRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const onBackRef = useRef(onBack);
  const timerRef = useRef<number | null>(null);

  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!enabled) {
      gestureRef.current = null;
      offsetRef.current = 0;
      setOffsetX(0);
      setSettling(false);
      setExiting(false);
    }
  }, [enabled]);

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (!enabled || exiting || event.touches.length !== 1) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const target = event.target as Element;
    if (target.closest('input, textarea, select, [data-zoomed="true"]')) return;
    const touch = event.touches[0];
    gestureRef.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    offsetRef.current = 0;
    setOffsetX(0);
    setSettling(false);
  }, [enabled, exiting]);

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = gestureRef.current;
    if (!enabled || !start || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx <= 0 || dx < 8 || dx < Math.abs(dy) * 1.15) return;
    if (event.cancelable) event.preventDefault();
    const next = Math.min(window.innerWidth, dx);
    offsetRef.current = next;
    setOffsetX(next);
  }, [enabled]);

  const reset = useCallback(() => {
    gestureRef.current = null;
    offsetRef.current = 0;
    setOffsetX(0);
    setSettling(true);
    timerRef.current = window.setTimeout(() => setSettling(false), RETURN_DURATION_MS);
  }, []);

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = gestureRef.current;
    const offset = offsetRef.current;
    gestureRef.current = null;
    if (!enabled || !start || offset <= 0) return;
    const touch = event.changedTouches[0];
    const elapsed = Math.max(1, performance.now() - start.time);
    const velocity = touch ? (touch.clientX - start.x) / elapsed : 0;
    const shouldClose = offset >= Math.max(96, window.innerWidth * 0.28) || (velocity >= 0.55 && offset >= 40);
    if (!shouldClose) {
      reset();
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onBackRef.current();
      return;
    }
    setExiting(true);
    setSettling(false);
    offsetRef.current = window.innerWidth;
    setOffsetX(window.innerWidth);
    timerRef.current = window.setTimeout(() => onBackRef.current(), COMPLETE_DURATION_MS);
  }, [enabled, reset]);

  const onTouchCancel = useCallback(() => {
    if (offsetRef.current > 0) reset();
    else gestureRef.current = null;
  }, [reset]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    style: {
      transform: `translate3d(${offsetX}px, 0, 0)`,
      opacity: 1 - Math.min(offsetX / 1400, 0.14),
      borderRadius: offsetX > 0 ? '12px 0 0 12px' : undefined,
      boxShadow: offsetX > 0 ? '-12px 0 28px rgb(0 0 0 / 12%)' : undefined,
      transition: reducedMotion
        ? 'none'
        : exiting
        ? `transform ${COMPLETE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${COMPLETE_DURATION_MS}ms ease-out`
        : settling
          ? `transform ${RETURN_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${RETURN_DURATION_MS}ms ease-out`
          : 'none',
      willChange: offsetX > 0 || settling || exiting ? 'transform, opacity' : undefined,
    },
  };
}
