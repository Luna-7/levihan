import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { soundManager } from '../utils/audio';
import {
  ComicComment,
  deleteOwnComicComment,
  loadComicComments,
  submitComicComment,
} from '../services/comicComments';
import { CardPatternOverlay } from './CardPatternOverlay';

interface Props {
  bookId: string;
  bookTitle: string;
  onShowToast: (message: string) => void;
  onCommentCountChange?: () => void;
  previewMode?: boolean;
}

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const MangaCommentSection: React.FC<Props> = ({
  bookId,
  bookTitle,
  onShowToast,
  onCommentCountChange,
  previewMode = false,
}) => {
  const [comments, setComments] = useState<ComicComment[] | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [submitNotice, setSubmitNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setComments(null);
    setLoadFailed(false);
    if (previewMode) {
      const createdAt = new Date().toISOString();
      setComments([
        {
          id: 'preview-comment-1',
          body: '节奏和分镜都很舒服，读完还想再看一次。',
          createdAt,
          canDelete: true,
        },
        {
          id: 'preview-comment-2',
          body: '这里的细节让我又回去看了一遍。',
          createdAt,
          canDelete: true,
        },
      ]);
      setCommentCount(2);
      return () => controller.abort();
    }
    loadComicComments(bookId, controller.signal)
      .then((result) => {
        setComments(result.comments);
        setCommentCount(result.count);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setComments([]);
          setCommentCount(0);
          setLoadFailed(true);
        }
      });
    return () => controller.abort();
  }, [bookId, previewMode]);

  const submit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setSubmitNotice('');
    try {
      const comment = previewMode
        ? {
            id: `preview-${Date.now()}`,
            body,
            createdAt: new Date().toISOString(),
          }
        : await submitComicComment(bookId, body);
      setComments((current) => [
        { ...comment, canDelete: true },
        ...(current || []).filter((item) => item.id !== comment.id),
      ]);
      setCommentCount((current) => current + 1);
      setDraft('');
      setSubmitNotice('评论已发布。');
      soundManager.playCopySuccess();
      onShowToast('评论已发布');
      if (!previewMode) onCommentCountChange?.();
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '评论提交失败，请稍后重试');
    } finally {
      setPosting(false);
    }
  }, [bookId, draft, onCommentCountChange, onShowToast, posting, previewMode]);

  const removeOwnComment = useCallback(async (comment: ComicComment) => {
    if (!comment.canDelete || deletingId) return;
    if (!window.confirm('删除这条评论？')) return;
    setDeletingId(comment.id);
    try {
      if (!previewMode) await deleteOwnComicComment(bookId, comment.id);
      setComments((current) => current?.filter((item) => item.id !== comment.id) || []);
      setCommentCount((current) => Math.max(0, current - 1));
      setSubmitNotice('评论已删除。');
      onShowToast('评论已删除');
      if (!previewMode) onCommentCountChange?.();
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '删除失败，请稍后重试');
    } finally {
      setDeletingId('');
    }
  }, [bookId, deletingId, onCommentCountChange, onShowToast, previewMode]);

  return (
    <section
      className="comic-reader-content relative isolate mt-3 select-text overflow-hidden rounded-lg border-[0.5px] border-[var(--amber-6)] bg-[var(--amber-2)] p-3.5 text-[var(--green-12)] sm:p-4"
      aria-label={`《${bookTitle}》评论区`}
    >
      <CardPatternOverlay opacity={0.08} mode="multiply" />
      <div className="relative z-10 flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--amber-6)] pb-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle size={16} aria-hidden="true" />
          评论
        </h3>
        <span className="shrink-0 text-xs tabular-nums text-[var(--gray-11)]" aria-live="polite">
          {comments === null ? '加载中' : `${commentCount} 条评论`}
        </span>
      </div>

      <form className="relative z-10 mt-3" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor={`comic-comment-${bookId}`}>评论内容</label>
        <textarea
          id={`comic-comment-${bookId}`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value.slice(0, 2000))}
          rows={3}
          maxLength={2000}
          placeholder="写下你的评论"
          className="min-h-24 w-full resize-y rounded-md border-[0.5px] border-[var(--amber-6)] bg-[var(--amber-1)] px-3 py-2.5 text-sm leading-relaxed text-[var(--gray-12)] placeholder:text-[var(--gray-9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--green-8)]"
        />
        <div className="mt-2 flex items-center justify-between gap-3 pr-14 md:pr-0">
          <span className="text-xs text-[var(--gray-11)]" aria-live="polite">
            {submitNotice || `${draft.length}/2000`}
          </span>
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-[var(--green-12)] px-3.5 text-xs font-semibold text-[var(--amber-1)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-8)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} aria-hidden="true" />
            {posting ? '发布中' : '发表评论'}
          </button>
        </div>
      </form>

      {previewMode && (
        <p className="relative z-10 mt-2 text-xs text-[var(--gray-11)]" role="status">
          本地预览示例，不会保存到服务器。
        </p>
      )}

      {loadFailed && (
        <p className="relative z-10 mt-3 text-xs text-[var(--red-11)]" role="status">
          评论暂时无法加载，请稍后重试。
        </p>
      )}

      {comments !== null && comments.length === 0 && !loadFailed && (
        <p className="relative z-10 mt-3 text-xs text-[var(--gray-11)]">还没有评论。</p>
      )}

      {comments && comments.length > 0 && (
        <ul className="relative z-10 mt-3 space-y-2.5">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border-[0.5px] border-[var(--amber-5)] bg-[var(--amber-1)] px-3 py-2.5">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <time className="text-xs text-[var(--gray-11)]">{formatCommentTime(comment.createdAt)}</time>
                {comment.canDelete && (
                  <button
                    type="button"
                    aria-label={`删除我在《${bookTitle}》的评论`}
                    disabled={Boolean(deletingId)}
                    onClick={() => void removeOwnComment(comment)}
                    className="min-h-11 shrink-0 px-2 text-xs font-medium text-[var(--red-11)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--green-8)] disabled:cursor-wait disabled:opacity-60"
                  >
                    {deletingId === comment.id ? '删除中' : '删除'}
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--gray-12)]">
                {comment.body}
              </p>
            </li>
          ))}
        </ul>
      )}

    </section>
  );
};
