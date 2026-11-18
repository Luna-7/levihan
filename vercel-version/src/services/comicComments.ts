export interface ComicComment {
  id: string;
  body: string;
  createdAt: string;
  canDelete?: boolean;
}

const VISITOR_ID_KEY = 'levihan_comic_comment_visitor_v1';
let fallbackVisitorId = '';

type ComicCommentResponse = {
  ok?: boolean;
  error?: string;
  comments?: ComicComment[];
  count?: number;
  counts?: Record<string, number>;
  comment?: Pick<ComicComment, 'id' | 'body' | 'createdAt'>;
};

const COMIC_COMMENTS_ENDPOINT = typeof window !== 'undefined'
  && window.location.hostname === 'tudou.levihan.asia'
  ? 'https://www.levihan.asia/api/admin-content'
  : '/api/admin-content';

async function callComicComments(payload: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(COMIC_COMMENTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => ({})) as ComicCommentResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || '评论服务暂时无法使用');
  return data;
}

export function getAnonymousVisitorId() {
  if (typeof window === 'undefined') return '';
  try {
    const saved = window.localStorage.getItem(VISITOR_ID_KEY) || '';
    if (/^[A-Za-z0-9_-]{16,80}$/.test(saved)) return saved;
    const id = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    if (!fallbackVisitorId) {
      fallbackVisitorId = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }
    return fallbackVisitorId;
  }
}

export async function loadComicComments(bookId: string, signal?: AbortSignal) {
  const data = await callComicComments({
    action: 'comicCommentList',
    bookId,
    visitorId: getAnonymousVisitorId(),
  }, signal);
  const comments = Array.isArray(data.comments) ? data.comments : [];
  return { comments, count: Math.max(comments.length, Number(data.count) || 0) };
}

export async function loadComicCommentCounts(signal?: AbortSignal) {
  const data = await callComicComments({ action: 'comicCommentCounts' }, signal);
  return data.counts || {};
}

export async function submitComicComment(bookId: string, body: string) {
  const visitorId = getAnonymousVisitorId();
  if (!visitorId) throw new Error('无法创建匿名评论会话，请刷新页面后重试');
  const data = await callComicComments({ action: 'comicCommentSubmit', bookId, body, visitorId });
  if (!data.comment) throw new Error('评论提交结果无效，请刷新页面后重试');
  return data.comment;
}

export async function deleteOwnComicComment(bookId: string, commentId: string) {
  const visitorId = getAnonymousVisitorId();
  if (!visitorId) throw new Error('无法确认评论归属，请刷新页面后重试');
  await callComicComments({ action: 'comicCommentDeleteOwn', bookId, commentId, visitorId });
}
