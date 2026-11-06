import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { MangaPreviewBook } from '../data/mangaPreviewBooks';

type Props = {
  book: MangaPreviewBook;
  onClose: () => void;
};

export const MangaPageReader: React.FC<Props> = ({ book, onClose }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  const [pageNumber, setPageNumber] = useState(1);
  const pageRotated = book.defaultRotatedPages.includes(pageNumber);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

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
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'ArrowRight') changePage(pageNumber + 1);
      if (event.key === 'ArrowLeft') changePage(pageNumber - 1);
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

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (startX === null || endX === undefined || Math.abs(endX - startX) < 48) return;
    changePage(pageNumber + (endX < startX ? 1 : -1));
  };

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
          className="manga-reader-page-area"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
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
            key={String(pageNumber) + '-' + String(retryKey)}
            className={'manga-reader-page' + (pageRotated ? ' is-rotated' : '')}
            src={pageUrl}
            alt={book.title + ' ' + book.volumeLabel + '，第 ' + pageNumber + ' 页'}
            draggable={false}
            decoding="async"
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
