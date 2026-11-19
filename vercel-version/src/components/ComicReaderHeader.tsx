import type { DoujinBookItem } from '../types/doujinArchive';
import { AuthorWithLink } from '../utils/authorLink';

interface Props {
  book: DoujinBookItem;
  onClose: () => void;
  hasReaderIntro: boolean;
}

export function ComicReaderHeader({ book, onClose, hasReaderIntro }: Props) {
  return (
    <header
      className={`relative z-10 flex items-center gap-4 rounded-b-xl border-[0.5px] border-[var(--amber-6)] bg-[var(--amber-2)] px-3.5 py-2.5 ${hasReaderIntro ? '' : '-mb-4'}`}
      style={{ paddingTop: 'max(10px, env(safe-area-inset-top, 0px))' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="返回书架"
        title="返回书架"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--green-12)] p-0 text-2xl leading-none text-[var(--amber-1)] hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-[var(--green-8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-8)] active:opacity-80"
      >
        <span aria-hidden="true">←</span>
      </button>
      <div className="min-w-0">
        <h2 className="comic-title-font font-pixel truncate text-sm font-bold text-[var(--green-12)] sm:text-base">
          {book.titleZh}
        </h2>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-retro-jp text-xs text-[var(--gray-11)]">
          <span>
            作者：<AuthorWithLink author={book.circle} customUrl={book.authorUrl} defaultColorClass="text-[var(--gray-11)]" orangeColorClass="text-[var(--green-12)] underline decoration-[var(--amber-8)] underline-offset-2" />
          </span>
          {book.source && <span>来源：{book.source}</span>}
        </div>
        {(book.translator || book.typesetter) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-retro-jp text-xs text-[var(--gray-11)]">
            {book.translator && <span>汉化：{book.translator}</span>}
            {book.typesetter && <span>嵌字：{book.typesetter}</span>}
          </div>
        )}
      </div>
    </header>
  );
}
