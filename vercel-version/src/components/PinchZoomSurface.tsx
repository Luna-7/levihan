import React, { useCallback, useRef } from 'react';

type Point = { x: number; y: number };
type Transform = { scale: number; x: number; y: number };
type Gesture =
  | { kind: 'pan'; start: Point; origin: Transform }
  | { kind: 'pinch'; distance: number; midpoint: Point; origin: Transform };

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export const PinchZoomSurface: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const gestureRef = useRef<Gesture | null>(null);

  const applyTransform = useCallback((next: Transform) => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) return;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next.scale));
    const maxX = (frame.clientWidth * (scale - 1)) / 2;
    const maxY = (frame.clientHeight * (scale - 1)) / 2;
    const x = scale === 1 ? 0 : Math.max(-maxX, Math.min(maxX, next.x));
    const y = scale === 1 ? 0 : Math.max(-maxY, Math.min(maxY, next.y));
    transformRef.current = { scale, x, y };
    content.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    content.style.zIndex = scale > 1 ? '2' : '';
    frame.style.zIndex = scale > 1 ? '2' : '';
    frame.style.touchAction = scale > 1 ? 'none' : 'pan-x pan-y';
    frame.dataset.zoomed = scale > 1 ? 'true' : 'false';
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const points = pointersRef.current;
    const point = { x: event.clientX, y: event.clientY };
    points.set(event.pointerId, point);
    if (points.size >= 2) {
      const pair: Point[] = [...points.values()].slice(0, 2);
      gestureRef.current = {
        kind: 'pinch',
        distance: Math.max(1, distance(pair[0], pair[1])),
        midpoint: midpoint(pair[0], pair[1]),
        origin: transformRef.current,
      };
    } else if (transformRef.current.scale > 1) {
      gestureRef.current = { kind: 'pan', start: point, origin: transformRef.current };
    } else {
      gestureRef.current = null;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const points = pointersRef.current;
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.kind === 'pinch' && points.size >= 2) {
      const pair: Point[] = [...points.values()].slice(0, 2);
      const nextMidpoint = midpoint(pair[0], pair[1]);
      const scale = gesture.origin.scale * distance(pair[0], pair[1]) / gesture.distance;
      const frame = frameRef.current;
      if (!frame) return;
      const centerX = frame.getBoundingClientRect().left + frame.clientWidth / 2;
      const centerY = frame.getBoundingClientRect().top + frame.clientHeight / 2;
      applyTransform({
        scale,
        x: nextMidpoint.x - centerX -
          ((gesture.midpoint.x - centerX - gesture.origin.x) / gesture.origin.scale) * scale,
        y: nextMidpoint.y - centerY -
          ((gesture.midpoint.y - centerY - gesture.origin.y) / gesture.origin.scale) * scale,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === 'pan' && points.size === 1) {
      const point = points.get(event.pointerId)!;
      applyTransform({
        scale: gesture.origin.scale,
        x: gesture.origin.x + point.x - gesture.start.x,
        y: gesture.origin.y + point.y - gesture.start.y,
      });
      event.preventDefault();
    }
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const points = pointersRef.current;
    points.delete(event.pointerId);
    if (points.size >= 2) {
      const pair: Point[] = [...points.values()].slice(0, 2);
      gestureRef.current = {
        kind: 'pinch',
        distance: Math.max(1, distance(pair[0], pair[1])),
        midpoint: midpoint(pair[0], pair[1]),
        origin: transformRef.current,
      };
    } else if (points.size === 1 && transformRef.current.scale > 1) {
      const point: Point = [...points.values()][0];
      gestureRef.current = { kind: 'pan', start: point, origin: transformRef.current };
    } else {
      gestureRef.current = null;
    }
  };

  return (
    <div
      ref={frameRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ touchAction: 'pan-x pan-y', WebkitUserSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div ref={contentRef} className="absolute inset-0" style={{ transformOrigin: 'center center' }}>
        {children}
      </div>
    </div>
  );
};
