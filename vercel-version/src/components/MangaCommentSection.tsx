import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Minus, Plus, Reply, Send } from 'lucide-react';
import { soundManager } from '../utils/audio';
import {
  ComicComment,
  deleteOwnComicComment,
  loadComicComments,
  submitComicComment,
} from '../services/comicComments';

interface Props {
  bookId: string;
  bookTitle: string;
  onShowToast: (message: string) => void;
  onCommentCountChange?: () => void;
  previewMode?: boolean;
}

type CommentNode = ComicComment & { children: CommentNode[] };

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function mergeComments(current: ComicComment[], incoming: ComicComment[]) {
  const byId = new Map(current.map((comment) => [comment.id, comment]));
  incoming.forEach((comment) => {
    const existing = byId.get(comment.id);
    if (comment.unavailable && existing && !existing.unavailable) return;
    byId.set(comment.id, comment);
  });
  return Array.from(byId.values());
}

function buildCommentTree(comments: ComicComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  comments.forEach((comment) => nodes.set(comment.id, { ...comment, children: [] }));
  comments.forEach((comment) => {
    if (comment.parentId && !nodes.has(comment.parentId)) {
      nodes.set(comment.parentId, {
        id: comment.parentId, body: '', createdAt: '', unavailable: true, children: [],
      });
    }
  });

  const roots: CommentNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    let ancestor = parent;
    const visited = new Set([node.id]);
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined;
    }
    if (parent && !ancestor) parent.children.push(node);
    else roots.push(node);
  });
  const time = (node: CommentNode) => Date.parse(node.createdAt) || 0;
  const sortChildren = (node: CommentNode) => {
    node.children.sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id));
  roots.forEach(sortChildren);
  return roots;
}

type ComposerProps = {
  id: string;
  value: string;
  reply?: boolean;
  posting: boolean;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
};

function CommentComposer({ id, value, reply = false, posting, disabled, error, onChange, onSubmit, onCancel }: ComposerProps) {
  const [expanded, setExpanded] = useState(reply || Boolean(value));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const showActions = reply || expanded || Boolean(value);

  useEffect(() => {
    if (reply) textareaRef.current?.focus({ preventScroll: true });
  }, [reply]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const minHeight = showActions ? 88 : 46;
    textarea.style.height = `${Math.min(200, Math.max(minHeight, textarea.scrollHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [value, showActions]);

  return (
    <form
      className="comic-comment-composer"
      data-hide-back-to-top-on-focus
      onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!reply && !value && !event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
      }}
    >
      <label className="sr-only" htmlFor={id}>{reply ? '回复内容' : '评论内容'}</label>
      <div className="comic-ink-field">
        <textarea
          ref={textareaRef}
          id={id}
          data-hide-back-to-top-on-focus
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          maxLength={2000}
          rows={1}
          placeholder={reply ? '写下你的回复' : '写下你的评论'}
        />
        {showActions && (
          <div className="comic-composer-actions">
            <div className="flex items-center gap-2">
              {onCancel && (
                <button
                  type="button"
                  onClick={() => {
                    onCancel();
                    if (!reply) {
                      setExpanded(false);
                      textareaRef.current?.blur();
                    }
                  }}
                  disabled={posting}
                  className="comic-comment-action comic-composer-cancel"
                >
                  取消
                </button>
              )}
              <button type="submit" disabled={disabled || !value.trim()} className="comic-comment-submit">
                <Send size={14} aria-hidden="true" />
                {posting ? '发布中' : reply ? '发布回复' : '发表评论'}
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="comic-comment-error" role="alert">{error}</p>}
    </form>
  );
}

const previewComments: ComicComment[] = [
  { id: 'preview-1', body: '老大太会配音乐了，搭配这首歌看得人心暖暖的。', createdAt: '2026-11-18T08:38:00.000Z' },
  { id: 'preview-2', parentId: 'preview-1', body: '这里的画面和音乐真的很合适。', createdAt: '2026-11-18T09:12:00.000Z' },
  { id: 'preview-3', parentId: 'preview-2', body: '我也回去听了好几遍。', createdAt: '2026-11-18T09:26:00.000Z' },
  { id: 'preview-4', parentId: 'preview-1', body: '最后一页的细节也很喜欢。', createdAt: '2026-11-18T09:40:00.000Z' },
  { id: 'preview-5', body: '节奏和分镜都很舒服，读完还想再看一次。', createdAt: '2026-11-17T07:30:00.000Z' },
];

export const MangaCommentSection: React.FC<Props> = ({
  bookId, bookTitle, onShowToast, onCommentCountChange, previewMode = false,
}) => {
  const [comments, setComments] = useState<ComicComment[] | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [postingKey, setPostingKey] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState('');
  const [notice, setNotice] = useState('');
  const moreControllerRef = useRef<AbortController | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeBookRef = useRef(bookId);
  activeBookRef.current = bookId;
  const tree = useMemo(() => buildCommentTree(comments || []), [comments]);

  useEffect(() => {
    if (!previewMode || new URLSearchParams(window.location.search).get('previewScroll') !== 'comments') return;
    const frame = window.requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [previewMode]);

  useEffect(() => {
    setReplyTarget(null);
    setDrafts({});
    setCollapsed({});
    setPostingKey(null);
    setLoadingMore(false);
    setDeletingId('');
    setFormErrors({});
    setNotice('');
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    setComments(null);
    setLoadFailed(false);
    setNextCursor('');
    setMoreError('');
    if (previewMode) {
      setComments(previewComments.map((comment) => ({ ...comment })));
      setCommentCount(previewComments.length);
      return () => controller.abort();
    }
    loadComicComments(bookId, controller.signal)
      .then((result) => {
        setComments(result.comments);
        setCommentCount(result.count);
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setComments([]);
          setCommentCount(0);
          setLoadFailed(true);
        }
      });
    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [bookId, loadAttempt, previewMode]);

  const changeDraft = useCallback((key: string, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: '' }));
  }, []);

  const submit = useCallback(async (parentId?: string) => {
    const key = parentId || 'root';
    const body = (drafts[key] || '').trim();
    if (!body || postingKey) return;
    setPostingKey(key);
    setFormErrors((current) => ({ ...current, [key]: '' }));
    setNotice('');
    try {
      const comment: ComicComment = previewMode
        ? { id: `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body, createdAt: new Date().toISOString(), ...(parentId ? { parentId } : {}) }
        : await submitComicComment(bookId, body, parentId);
      if (activeBookRef.current !== bookId) return;
      setComments((current) => mergeComments(current || [], [{ ...comment, canDelete: true }]));
      setCommentCount((current) => current + 1);
      setDrafts((current) => ({ ...current, [key]: '' }));
      if (parentId) {
        setReplyTarget(null);
        setCollapsed((current) => ({ ...current, [parentId]: false }));
      }
      setNotice(parentId ? '回复已发布。' : '评论已发布。');
      soundManager.playCopySuccess();
      onShowToast(parentId ? '回复已发布' : '评论已发布');
      if (!previewMode) onCommentCountChange?.();
    } catch (error) {
      if (activeBookRef.current === bookId) {
        setFormErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : '发布失败，请稍后重试。' }));
      }
    } finally {
      if (activeBookRef.current === bookId) setPostingKey(null);
    }
  }, [bookId, drafts, onCommentCountChange, onShowToast, postingKey, previewMode]);

  const removeOwnComment = useCallback(async (comment: ComicComment) => {
    if (!comment.canDelete || deletingId) return;
    if (!window.confirm('删除这条评论？')) return;
    setDeletingId(comment.id);
    try {
      if (!previewMode) await deleteOwnComicComment(bookId, comment.id);
      if (activeBookRef.current !== bookId) return;
      setComments((current) => {
        if (!current) return current;
        const hasChildren = current.some((item) => item.parentId === comment.id);
        return hasChildren
          ? current.map((item) => item.id === comment.id ? { id: item.id, body: '', createdAt: item.createdAt, parentId: item.parentId, deleted: true } : item)
          : current.filter((item) => item.id !== comment.id);
      });
      if (replyTarget === comment.id) setReplyTarget(null);
      setCommentCount((current) => Math.max(0, current - 1));
      setNotice('评论已删除。');
      onShowToast('评论已删除');
      if (!previewMode) onCommentCountChange?.();
    } catch (error) {
      if (activeBookRef.current === bookId) onShowToast(error instanceof Error ? error.message : '删除失败，请稍后重试');
    } finally {
      if (activeBookRef.current === bookId) setDeletingId('');
    }
  }, [bookId, deletingId, onCommentCountChange, onShowToast, previewMode, replyTarget]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = await loadComicComments(bookId, controller.signal, nextCursor);
      if (controller.signal.aborted) return;
      setComments((current) => mergeComments(current || [], result.comments));
      setCommentCount(result.count);
      setNextCursor(result.nextCursor);
    } catch {
      if (!controller.signal.aborted) setMoreError('加载失败，请重试。');
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
      if (moreControllerRef.current === controller) moreControllerRef.current = null;
    }
  }, [bookId, loadingMore, nextCursor]);

  const renderNode = (node: CommentNode, depth: number, parent?: CommentNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = Boolean(collapsed[node.id]);
    const isMissing = Boolean(node.deleted || node.unavailable);
    return (
      <li key={node.id} className={`comic-thread-node${depth ? ' is-reply' : ''}`}>
        {depth > 0 && (
          <span className="comic-thread-connector" aria-hidden="true">
            <svg viewBox="0 0 4 100" preserveAspectRatio="none" focusable="false">
              <path d="M2 0 C1.65 18 2.35 33 2 50 S1.7 82 2 100" fill="none" stroke="currentColor" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </span>
        )}
        <div className={`comic-thread-row${hasChildren && !isCollapsed ? ' has-children' : ''}`}>
          <div className="comic-thread-marker">
            {hasChildren ? (
              <button
                type="button"
                className="comic-thread-toggle"
                aria-label={isCollapsed ? '展开回复' : '收起回复'}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((current) => ({ ...current, [node.id]: !isCollapsed }))}
              >
                <span>{isCollapsed ? <Plus size={11} /> : <Minus size={11} />}</span>
              </button>
            ) : <span className="comic-thread-dot" aria-hidden="true" />}
          </div>
          <article className="min-w-0 flex-1">
            <div className="comic-thread-meta">
              {node.createdAt && <time dateTime={node.createdAt}>{formatCommentTime(node.createdAt)}</time>}
              {node.canDelete && !isMissing && (
                <button type="button" className="comic-comment-action comic-comment-delete" disabled={Boolean(deletingId)} onClick={() => void removeOwnComment(node)}>
                  {deletingId === node.id ? '删除中' : '删除'}
                </button>
              )}
            </div>
            {isMissing ? (
              <p className="comic-thread-missing">{node.deleted ? '该评论已删除。' : '原评论不可用。'}</p>
            ) : (
              <>
                {depth > 2 && parent && (
                  <p className="comic-thread-context">
                    回复：{parent.deleted || parent.unavailable ? '原评论不可用' : parent.body.slice(0, 32)}
                  </p>
                )}
                <p className="comic-thread-body">{node.body}</p>
                <button
                  type="button"
                  className="comic-comment-action comic-reply-action"
                  disabled={Boolean(postingKey) || Boolean(deletingId)}
                  onClick={() => {
                    setReplyTarget((current) => current === node.id ? null : node.id);
                    setCollapsed((current) => ({ ...current, [node.id]: false }));
                  }}
                >
                  <Reply size={14} aria-hidden="true" /> 回复
                </button>
              </>
            )}
            {isCollapsed && hasChildren && <span className="comic-thread-collapsed">回复已收起</span>}
            {replyTarget === node.id && !isMissing && (
              <CommentComposer
                id={`comic-reply-${bookId}-${node.id}`}
                value={drafts[node.id] || ''}
                reply
                posting={postingKey === node.id}
                disabled={Boolean(postingKey)}
                error={formErrors[node.id]}
                onChange={(value) => changeDraft(node.id, value)}
                onSubmit={() => void submit(node.id)}
                onCancel={() => setReplyTarget(null)}
              />
            )}
          </article>
        </div>
        {hasChildren && !isCollapsed && (
          <ul className={`comic-thread-children${depth >= 2 ? ' is-flat' : ''}`}>
            {node.children.map((child) => renderNode(child, depth + 1, node))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section ref={sectionRef} className="comic-reader-content comic-comment-panel comic-paper-surface" aria-label={`《${bookTitle}》评论区`}>
      <div className="comic-comment-heading">
        <h3><MessageCircle size={16} aria-hidden="true" /> 评论</h3>
        <span aria-live="polite">{comments === null ? '加载中' : `${commentCount} 条评论`}</span>
      </div>
      <CommentComposer
        id={`comic-comment-${bookId}`}
        value={drafts.root || ''}
        posting={postingKey === 'root'}
        disabled={Boolean(postingKey)}
        error={formErrors.root}
        onChange={(value) => changeDraft('root', value)}
        onSubmit={() => void submit()}
        onCancel={() => changeDraft('root', '')}
      />
      {previewMode && <p className="comic-preview-note">本地预览示例，不会保存到服务器。</p>}
      {loadFailed && (
        <div className="comic-comment-load-error" role="status">
          <span>评论暂时无法加载。</span>
          <button type="button" className="comic-comment-action" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试加载</button>
        </div>
      )}
      {comments !== null && comments.length === 0 && !loadFailed && <p className="comic-comment-empty">还没有评论。</p>}
      {tree.length > 0 && <ul className="comic-comment-list">{tree.map((node) => renderNode(node, 0))}</ul>}
      {nextCursor && (
        <div className="comic-comment-more">
          {moreError && <span role="status">{moreError}</span>}
          <button type="button" className="comic-comment-action" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? '加载中' : '加载更多评论'}
          </button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    </section>
  );
};
