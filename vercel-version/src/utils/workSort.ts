import { DoujinBookItem, GroupNovel } from '../types/doujinArchive';

const timeOf = (updatedAt?: string, createdAt?: string): number => {
  const date = Date.parse(updatedAt || createdAt || '');
  return Number.isFinite(date) ? date : 0;
};

const bookNumber = (id: string): number => {
  const match = /^lh-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
};

export const newestBooksFirst = (books: DoujinBookItem[]): DoujinBookItem[] =>
  [...books].sort((a, b) =>
    timeOf(b.updatedAt, b.createdAt) - timeOf(a.updatedAt, a.createdAt) ||
    bookNumber(b.id) - bookNumber(a.id)
  );

export const newestNovelsFirst = (novels: GroupNovel[]): GroupNovel[] =>
  [...novels].sort((a, b) =>
    timeOf(b.updatedAt, b.createdAt) - timeOf(a.updatedAt, a.createdAt) ||
    b.id.localeCompare(a.id)
  );
