import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  message: string;
  error?: string;
  canRetry?: boolean;
  onRetry?: () => void;
  onClose: () => void;
}

export const SecureComicLoadingDialog: React.FC<Props> = ({
  title,
  message,
  error,
  canRetry = false,
  onRetry,
  onClose,
}) => {
  const dialogRef = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    firstActionRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const actions = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!actions?.length) {
        event.preventDefault();
        return;
      }
      const first = actions[0];
      const last = actions[actions.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return createPortal(
  <div className="comic-paper-surface fixed inset-0 z-[1400] flex min-h-[100dvh] items-center justify-center overflow-y-auto overscroll-contain px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-[var(--green-12)]">
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="secure-comic-dialog-title"
      aria-describedby="secure-comic-dialog-message"
      tabIndex={-1}
      className="comic-loading-paper my-auto w-full max-w-sm break-words border-[0.5px] border-[var(--amber-6)] px-5 py-6 text-center focus:outline-none"
    >
      {!error && <div className="secure-comic-loader mx-auto" aria-hidden="true" />}
      <h1 id="secure-comic-dialog-title" className="mt-4 break-words text-base font-semibold">
        {error ? '解析未能完成' : title}
      </h1>
      <p
        id="secure-comic-dialog-message"
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={error
          ? 'mt-2 text-sm leading-relaxed text-[var(--red-11)]'
          : 'mt-2 text-sm leading-relaxed text-[var(--gray-11)]'}
      >
        {error || message}
      </p>
      {!error && (
        <p className="mt-1 text-xs text-[var(--gray-11)]">完成后自动进入阅读</p>
      )}
      <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <button
          type="button"
          ref={firstActionRef}
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center rounded-md border-[0.5px] border-[var(--green-8)] px-4 text-xs font-semibold text-[var(--green-12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-8)]"
        >
          返回归档
        </button>
        {error && canRetry && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center justify-center rounded-md border-[0.5px] border-[var(--green-8)] bg-[var(--green-3)] px-4 text-xs font-semibold text-[var(--green-12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-8)]"
          >
            重试解析
          </button>
        )}
      </div>
    </section>
  </div>,
    document.body,
  );
};
