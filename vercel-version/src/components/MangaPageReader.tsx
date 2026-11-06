import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { MangaPreviewBook } from '../data/mangaPreviewBooks';

type Props = {
  book: MangaPreviewBook;
  onClose: () => void;
};

type Point = { x: number; y: number };
type PointerPosition = { clientX: number; clientY: number };
type ReaderGesture =
  | { type: 'swipe'; startX: number; startY: number }
  | { type: 'pan'; startX: number; startY: number; offset: Point }
  | {
      type: 'pinch';
      distance: number;
      zoom: number;
      offset: Point;
      midpoint: Point;
    };

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

export const MangaPageReader: React.FC<Props> = ({ book, onClose }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pageAreaRef = useRef<HTMLDivElement>(null);
  const pageImageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef<Map<number, PointerPosition>>(new Map());
  const gestureRef = useRef<ReaderGesture | null>(null);
  const closeRef = useRef(onClose);
  const [pageNumber, setPageNumber] = useState(1);
  const pageRotated = book.defaultRotatedPages.includes(pageNumber);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const zoomRef = useRef(MIN_ZOOM);
  const [imageOffset, setImageOffset] = useState<Point>({ x: 0, y: 0 });
  const imageOffsetRef = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [book.pageCount]);

  const changePage = (nextPage: number) => {
    const boundedPage = Math.min(Math.max(nextPage, 1), book.pageCount);
    if (boundedPage === pageNumber) return;
    setPageLoading(true);
    setPageError(false);
    setPageNumber(boundedPage);
    zoomRef.current = MIN_ZOOM;
    setZoom(MIN_ZOOM);
    imageOffsetRef.current = { x: 0, y: 0 };
    setImageOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    gestureRef.current = null;
  };

  const updateImageOffset = (offset: Point, scale = zoomRef.current) => {
    const area = pageAreaRef.current;
    const image = pageImageRef.current;
    let boundedOffset = offset;

    if (area && image) {
      const maxX = Math.max(0, (image.clientWidth * scale - area.clientWidth) / 2);
      const maxY = Math.max(0, (image.clientHeight * scale - area.clientHeight) / 2);
      boundedOffset = {
        x: Math.min(maxX, Math.max(-maxX, offset.x)),
        y: Math.min(maxY, Math.max(-maxY, offset.y)),
      };
    }

    imageOffsetRef.current = boundedOffset;
    setImageOffset(boundedOffset);
  };

  const updateZoom = (nextZoom: number) => {
    const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    zoomRef.current = boundedZoom;
    setZoom(boundedZoom);
    if (boundedZoom === MIN_ZOOM) {
      updateImageOffset({ x: 0, y: 0 }, MIN_ZOOM);
    } else {
      updateImageOffset(imageOffsetRef.current, boundedZoom);
    }
  };

  const relativeMidpoint = (first: PointerPosition, second: PointerPosition) => {
    const area = pageAreaRef.current;
    if (!area) return { x: 0, y: 0 };
    const rect = area.getBoundingClientRect();
    return {
      x: (first.clientX + second.clientX) / 2 - rect.left - rect.width / 2,
      y: (first.clientY + second.clientY) / 2 - rect.top - rect.height / 2,
    };
  };

  const beginPointerGesture = () => {
    const pointers = [...pointersRef.current.values()] as PointerPosition[];
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const midpoint = relativeMidpoint(first, second);
      gestureRef.current = {
        type: 'pinch',
        distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
        zoom: zoomRef.current,
        offset: imageOffsetRef.current,
        midpoint,
      };
      return;
    }

    const [pointer] = pointers;
    if (!pointer) return;
    gestureRef.current = zoomRef.current > MIN_ZOOM
      ? { type: 'pan', startX: pointer.clientX, startY: pointer.clientY, offset: imageOffsetRef.current }
      : { type: 'swipe', startX: pointer.clientX, startY: pointer.clientY };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest('.manga-reader-error')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    beginPointerGesture();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const pointers = [...pointersRef.current.values()] as PointerPosition[];

    if (pointers.length >= 2) {
      if (gestureRef.current?.type !== 'pinch') beginPointerGesture();
      const gesture = gestureRef.current;
      if (gesture?.type !== 'pinch') return;

      const [first, second] = pointers;
      const distance = Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY));
      const midpoint = relativeMidpoint(first, second);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom * distance / gesture.distance));
      const ratio = nextZoom / gesture.zoom;
      updateZoom(nextZoom);
      updateImageOffset({
        x: midpoint.x + (gesture.offset.x - gesture.midpoint.x) * ratio,
        y: midpoint.y + (gesture.offset.y - gesture.midpoint.y) * ratio,
      }, nextZoom);
      event.preventDefault();
      return;
    }

    const gesture = gestureRef.current;
    if (gesture?.type === 'pan' && zoomRef.current > MIN_ZOOM) {
      updateImageOffset({
        x: gesture.offset.x + event.clientX - gesture.startX,
        y: gesture.offset.y + event.clientY - gesture.startY,
      });
      event.preventDefault();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      if (gesture?.type === 'swipe' && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY)) {
          changePage(pageNumber + (deltaX < 0 ? 1 : -1));
        }
      }
      return;
    }

    beginPointerGesture();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size > 0) beginPointerGesture();
    else gestureRef.current = null;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'ArrowRight') changePage(pageNumber + 1);
      if (event.key === 'ArrowLeft') changePage(pageNumber - 1);
      if (event.key === '+' || event.key === '=') updateZoom(zoomRef.current + ZOOM_STEP);
      if (event.key === '-') updateZoom(zoomRef.current - ZOOM_STEP);
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      const focusable: HTMLButtonElement[] = dialog
        ? Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        : [];
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [book.pageCount, pageNumber]);

  const pageFileNumber = pageNumber + (book.pageNumberOffset ?? 0);
  const pageUrl = book.pageUrlPrefix
    + '/'
    + (book.pageFilePrefix ?? 'page-')
    + String(pageFileNumber).padStart(3, '0')
    + '.webp';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="manga-reader-backdrop manga-preview-ui">
      <section
        ref={dialogRef}
        className="manga-reader-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manga-reader-title"
      >
        <header className="manga-reader-header">
          <div className="manga-reader-heading">
            <h2 id="manga-reader-title">{book.title}</h2>
            <span>{book.volumeLabel}</span>
          </div>
          <div className="manga-reader-header-actions">
            <button
              className="manga-reader-icon-button manga-reader-zoom-button"
              type="button"
              onClick={() => updateZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="缩小图片"
              title="缩小图片"
            >
              <ZoomOut size={18} aria-hidden="true" />
            </button>
            <span className="manga-reader-zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button
              className="manga-reader-icon-button manga-reader-zoom-button"
              type="button"
              onClick={() => updateZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="放大图片"
              title="放大图片"
            >
              <ZoomIn size={18} aria-hidden="true" />
            </button>
            <button
              ref={closeButtonRef}
              className="manga-reader-icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭阅读器"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          ref={pageAreaRef}
          className="manga-reader-page-area"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {pageLoading && !pageError && <p className="manga-reader-status" role="status">正在载入页面…</p>}
          {pageError && (
            <div className="manga-reader-error" role="alert">
              <p>这一页暂时无法加载，请检查网络后重试。</p>
              <button
                type="button"
                onClick={() => {
                  setPageLoading(true);
                  setPageError(false);
                  setRetryKey((key) => key + 1);
                }}
              >
                重试
              </button>
            </div>
          )}
          <img
            ref={pageImageRef}
            key={String(pageNumber) + '-' + String(retryKey)}
            className={'manga-reader-page' + (pageRotated ? ' is-rotated' : '') + (zoom > MIN_ZOOM ? ' is-zoomed' : '')}
            src={pageUrl}
            alt={book.title + ' ' + book.volumeLabel + '，第 ' + pageNumber + ' 页'}
            draggable={false}
            decoding="async"
            style={{
              transform: pageRotated
                ? `translate(-50%, -50%) translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) rotate(90deg) scale(${zoom})`
                : `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${zoom})`,
              transformOrigin: 'center',
            }}
            aria-hidden={pageError}
            onLoad={() => {
              setPageLoading(false);
              setPageError(false);
            }}
            onError={() => {
              setPageLoading(false);
              setPageError(true);
            }}
          />
        </div>

        <footer className="manga-reader-controls">
          <button
            className="manga-reader-control-button"
            type="button"
            onClick={() => changePage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            aria-label="上一页"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>上一页</span>
          </button>
          <span className="manga-reader-page-count" aria-live="polite">
            第 {pageNumber} 页 / {book.pageCount} 页
          </span>
          <button
            className="manga-reader-control-button"
            type="button"
            onClick={() => changePage(pageNumber + 1)}
            disabled={pageNumber >= book.pageCount}
            aria-label="下一页"
          >
            <span>下一页</span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
};
