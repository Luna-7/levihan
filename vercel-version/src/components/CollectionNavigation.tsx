import React, { useEffect, useRef } from 'react';
import type { DoujinBookItem } from '../types/doujinArchive';

type CollectionNavigationProps = {
  books: DoujinBookItem[];
  currentBookId: string;
  onNavigate: (book: DoujinBookItem) => void;
  frameClassName?: string;
};

type CollectionFooterNavigationProps = CollectionNavigationProps & {
  className?: string;
};

export function getCollectionBooks(books: DoujinBookItem[], currentBook: DoujinBookItem | null) {
  if (!currentBook?.collectionId) return [];
  const members = books.filter((book) => book.collectionId === currentBook.collectionId);
  if (!members.some((book) => book.id === currentBook.id)) members.push(currentBook);
  return members.slice().sort((a, b) => {
    const orderDiff = (Number(a.collectionOrder) || Number.MAX_SAFE_INTEGER) -
      (Number(b.collectionOrder) || Number.MAX_SAFE_INTEGER);
    return orderDiff || a.id.localeCompare(b.id, 'zh-Hans-CN', { numeric: true });
  });
}

function CollectionPosition({ books, currentBookId }: Pick<CollectionNavigationProps, 'books' | 'currentBookId'>) {
  const index = books.findIndex((book) => book.id === currentBookId);
  if (index < 0) return null;
  return <span className="sr-only">第 {index + 1} 篇，共 {books.length} 篇</span>;
}

export const CollectionNavigationBar: React.FC<CollectionNavigationProps> = ({
  books,
  currentBookId,
  onNavigate,
  frameClassName = 'max-w-2xl',
}) => {
  const activeItemRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }, [currentBookId]);

  if (!books.length) return null;

  return (
    <nav
      aria-label={`${books[0].collectionTitle || '合集'}篇目`}
      className={`collection-navigation mx-auto w-full ${frameClassName}`}
    >
      <div className="flex min-h-11 items-stretch gap-1 overflow-x-auto border-b-[0.5px] border-[var(--amber-6)] [scrollbar-width:thin]">
        {books.map((book, index) => book.id === currentBookId ? (
          <span
            key={book.id}
            ref={activeItemRef}
            aria-current="page"
            className="inline-flex min-h-11 shrink-0 items-center border-b-[1.5px] border-[var(--green-9)] bg-[var(--amber-2)] px-3 text-xs font-semibold text-[var(--green-12)]"
          >
            <span className="mr-1.5 tabular-nums">{index + 1}</span>
            <span className="max-w-52 truncate">{book.titleZh}</span>
          </span>
        ) : (
          <button
            key={book.id}
            type="button"
            onClick={() => onNavigate(book)}
            className="inline-flex min-h-11 shrink-0 items-center border-b-[1.5px] border-transparent px-3 text-xs font-medium text-[var(--gray-11)] transition-colors hover:border-[var(--green-8)] hover:bg-[var(--amber-3)] hover:text-[var(--green-12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--green-8)]"
            aria-label={`切换到第 ${index + 1} 篇：${book.titleZh}`}
          >
            <span className="mr-1.5 tabular-nums">{index + 1}</span>
            <span className="max-w-52 truncate">{book.titleZh}</span>
          </button>
        ))}
      </div>
      <CollectionPosition books={books} currentBookId={currentBookId} />
    </nav>
  );
};

export const CollectionFooterNavigation: React.FC<CollectionFooterNavigationProps> = ({
  books,
  currentBookId,
  onNavigate,
  frameClassName = 'max-w-2xl',
  className = '',
}) => {
  if (books.length < 2) return null;
  const index = books.findIndex((book) => book.id === currentBookId);
  if (index < 0) return null;
  const previous = books[index - 1];
  const next = books[index + 1];

  const buttonClass = 'grid min-h-11 w-full grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 border-b-[0.5px] border-[var(--amber-6)] px-3 py-2 text-left text-xs text-[var(--green-12)] transition-colors hover:bg-[var(--amber-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--green-8)] disabled:cursor-not-allowed disabled:text-[var(--gray-9)]';

  return (
    <nav
      aria-label="合集篇目翻页"
      className={`mx-auto grid w-full ${frameClassName} grid-cols-1 px-3 py-3 ${className}`}
    >
      {previous && (
        <button
          type="button"
          className={`${buttonClass} border-t-[0.5px]`}
          onClick={() => onNavigate(previous)}
          aria-label={`上一篇：${previous.titleZh}`}
        >
          <span className="font-semibold">上一篇</span>
          <span className="truncate">{previous.titleZh}</span>
        </button>
      )}
      {next && (
        <button
          type="button"
          className={buttonClass}
          onClick={() => onNavigate(next)}
          aria-label={`下一篇：${next.titleZh}`}
        >
          <span className="font-semibold">下一篇</span>
          <span className="truncate">{next.titleZh}</span>
        </button>
      )}
    </nav>
  );
};
