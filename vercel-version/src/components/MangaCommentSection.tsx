import React, { useEffect, useState } from 'react';
import { soundManager } from '../utils/audio';
import { createComment, listComments, type CommentItem } from '../features/interactions/api';

interface Props {
  bookId: string;
  bookTitle: string;
  onShowToast: (msg: string) => void;
  onCommentCountChange?: (newCount: number) => void;
}

export const MangaCommentSection: React.FC<Props> = ({
  bookId,
  bookTitle,
  onShowToast,
  onCommentCountChange,
}) => {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentContent, setCommentContent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const load = async () => {
    try {
      const response = await listComments(bookId);
      setComments(response.items); setCommentCount(response.count);
      onCommentCountChange?.(response.count);
    } catch { onShowToast('评论加载失败，请稍后重试'); }
  };

  useEffect(() => { void load(); }, [bookId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentContent.trim()) {
      onShowToast('请输入评论内容 ✍️');
      return;
    }

    setIsSubmitting(true);
    soundManager.playScrollOpen();

    try {
      const result = await createComment(bookId, commentContent, globalThis.crypto.randomUUID());
      setCommentContent('');
      if (result.status === 'pending') onShowToast('评论已提交，审核通过后显示');
      else { onShowToast('🎉 评论发表成功'); await load(); }
    } catch { onShowToast('评论提交失败，请稍后重试'); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-8 bg-[#FAF5E8] border border-[#1E4334] rounded-md p-4 sm:p-5 space-y-4 text-[#2C241D] select-text">
      {/* 标题 */}
      <div className="border-b border-[#1E4334]/30 pb-2 flex items-center justify-between">
        <h3 className="font-serif-title font-bold text-sm sm:text-base text-[#1E3A2B]">
          评论 ({commentCount})
        </h3>
        <span className="text-[11px] font-retro-jp text-[#8C7A68]">
          《{bookTitle}》
        </span>
      </div>

      {/* 极简评论输入框 (仅保留评论内容输入框，已去除账号名框) */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <textarea
          value={commentContent}
          onChange={(e) => setCommentContent(e.target.value)}
          placeholder="写下你的评论..."
          rows={3}
          maxLength={500}
          className="w-full p-3 text-xs font-retro-jp bg-white border border-[#1E4334]/40 rounded-xs focus:outline-none focus:border-[#1E4334] resize-y leading-relaxed text-[#2C241D] placeholder:text-[#A0907E]"
        />

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !commentContent.trim()}
            className="px-4 py-1.5 bg-[#1E4334] hover:bg-[#2B5E4A] disabled:bg-[#A0907E] text-[#F9E79F] disabled:text-white/70 font-pixel text-xs rounded-xs cursor-pointer shadow-xs transition-all active:scale-95"
          >
            {isSubmitting ? '发送中...' : '发表评论'}
          </button>
        </div>
      </form>

      {/* 评论列表：账号名 + 评论内容 */}
      <div className="space-y-3 pt-2">
        {comments.map((item) => (
          <div
            key={item.id}
            className="bg-white border border-[#1E4334]/20 rounded-xs p-3 space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs font-serif-title text-[#1E3A2B]">
                {item.authorName}
              </span>
              <span className="text-[10px] font-mono text-[#8C7A68]">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-xs font-retro-jp text-[#3E342B] leading-relaxed whitespace-pre-wrap break-words">
              {item.body}
            </p>
          </div>
        ))}

        {comments.length === 0 && (
          <div className="p-6 text-center text-xs font-retro-jp text-[#8C7A68]">
            暂无评论，快来发表第一条评论吧～
          </div>
        )}
      </div>
    </div>
  );
};
