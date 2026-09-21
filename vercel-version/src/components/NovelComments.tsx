import React, { useState, useEffect, useCallback } from 'react';
import { ADMIN_UPLOAD_ENDPOINT } from '../utils/cloudbaseEndpoint';
import { getAccessToken } from '../utils/cloudbaseToken';
import { useAuthStore } from '../stores/authStore';
import { useAppShellStore } from '../stores/appShellStore';
import { soundManager } from '../utils/audio';

interface NovelComment {
  id: string;
  author: string;
  body: string;
  uid?: string; // 评论人 uid：判定「我的评论」（可删）与「作者回复」徽章
  createdAt: string;
}

interface Props {
  novelId: string;
  /** 小说作者的 uid：匹配的评论会带「作者」徽章 */
  novelAuthorUid?: string;
  onToast?: (msg: string) => void;
}

/** POST 到 admin-upload：text/plain 绕过 CORS 预检；带 Bearer 时服务端绑定 uid（与小说投稿同款） */
async function callNovelApi(payload: Record<string, unknown>, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    comments?: NovelComment[];
  };
  if (!resp.ok || !data.ok) throw new Error(data.error || '请求失败，请稍后重试');
  return data;
}

const fmtTime = (iso: string): string => (iso || '').slice(0, 10);

/** 在线小说评论区：读公开、写需登录；本人可删自己的评论，管理员可删任意评论 */
export const NovelComments: React.FC<Props> = ({ novelId, novelAuthorUid, onToast }) => {
  const [comments, setComments] = useState<NovelComment[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const profile = useAuthStore((state) => state.profile);
  const myUid = profile?.uid || null;
  const myNickname = profile?.nickname || '';
  const [confirmId, setConfirmId] = useState<string>('');

  useEffect(() => {
    let alive = true;
    setComments(null);
    setLoadFailed(false);
    setConfirmId('');
    callNovelApi({ action: 'novelCommentList', id: novelId })
      .then((d) => {
        if (alive) setComments(d.comments || []);
      })
      .catch(() => {
        if (alive) {
          setComments([]);
          setLoadFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [novelId]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    let token = await getAccessToken();
    if (!token) {
      onToast?.('请先登录账号再评论');
      useAppShellStore.getState().openLogin();
      return;
    }
    setPosting(true);
    try {
      const d = await callNovelApi(
        { action: 'novelCommentAdd', id: novelId, body: text, author: myNickname || '佚名' },
        token
      );
      setComments(d.comments || []);
      setDraft('');
      soundManager.playCopySuccess();
      onToast?.('评论已发表 💬');
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : '评论失败，请稍后重试');
    } finally {
      setPosting(false);
    }
  }, [draft, myNickname, novelId, onToast]);

  const remove = useCallback(
    async (commentId: string) => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const d = await callNovelApi(
          { action: 'novelCommentDelete', id: novelId, commentId },
          token
        );
        setComments(d.comments || []);
        setConfirmId('');
        onToast?.('评论已删除');
      } catch (error) {
        onToast?.(error instanceof Error ? error.message : '删除失败');
        setConfirmId('');
      }
    },
    [novelId, onToast]
  );

  return (
    <section className="pt-2 space-y-2.5">
      <div className="flex items-center gap-2 border-t border-dashed border-[#D5C9AF] pt-4">
        <span className="font-pixel text-xs font-bold text-[#1E4334]">💬 兵团评论</span>
        <span className="text-[10px] font-retro-jp text-[#8C7A68]">
          {comments === null ? '加载中…' : `共 ${comments.length} 条`}
        </span>
      </div>

      {loadFailed && (
        <p className="text-[10px] font-retro-jp text-[#B45309]">评论加载失败，可刷新重试。</p>
      )}

      {comments !== null && comments.length === 0 && (
        <p className="text-[11px] font-retro-jp text-[#8C7A68]">
          还没有评论，抢个沙发～
        </p>
      )}

      {comments !== null && comments.length > 0 && (
        <ul className="space-y-2">
          {comments.map((c) => {
            const isMine = Boolean(c.uid && myUid && c.uid === myUid);
            const isNovelAuthor = Boolean(c.uid && novelAuthorUid && c.uid === novelAuthorUid);
            return (
              <li
                key={c.id}
                className="bg-[#FAF5E8]/80 border border-[#EBE3D0] rounded-xs px-2.5 py-2 space-y-1"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-retro-jp text-[11px] font-bold text-[#3E342B]">
                    {c.author}
                  </span>
                  {isNovelAuthor && (
                    <span className="text-[9px] font-retro-jp px-1.5 py-0.5 rounded-full bg-[#1E4334] text-[#F9E79F] font-bold">
                      作者
                    </span>
                  )}
                  <span className="text-[10px] font-retro-jp text-[#A79780]">{fmtTime(c.createdAt)}</span>
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => (confirmId === c.id ? void remove(c.id) : setConfirmId(c.id))}
                      className={`ml-auto text-[10px] font-retro-jp cursor-pointer transition-colors ${
                        confirmId === c.id
                          ? 'text-[#A32D2D] font-bold underline'
                          : 'text-[#A79780] hover:text-[#A32D2D]'
                      }`}
                    >
                      {confirmId === c.id ? '再点一次确认删除' : '删除'}
                    </button>
                  )}
                </div>
                <p className="font-retro-jp text-[11px] sm:text-xs text-[#5B4636] leading-relaxed whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* 发表框：未登录时引导登录 */}
      {myUid ? (
        <div className="space-y-1.5 pt-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={`以 ${myNickname || '佚名'} 的身份评论…`}
            className="w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y font-retro-jp text-xs leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-retro-jp text-[#A79780]">{draft.length}/2000</span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={posting || !draft.trim()}
              className="px-3 py-1.5 rounded-xs bg-[#1E4334] text-[#F9E79F] font-pixel text-[11px] font-bold cursor-pointer disabled:opacity-40 hover:bg-[#2B5E4A] transition-colors"
            >
              {posting ? '发表中…' : '发表评论'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 bg-[#FAF5E8] border border-dashed border-[#D5C9AF] rounded-xs px-2.5 py-2">
          <span className="text-[10px] font-retro-jp text-[#7A6958]">登录后即可参与评论</span>
          <button
            type="button"
            onClick={() => useAppShellStore.getState().openLogin()}
            className="px-2.5 py-1 rounded-xs bg-[#1E4334] text-[#F9E79F] font-pixel text-[10px] font-bold cursor-pointer hover:bg-[#2B5E4A] transition-colors"
          >
            去登录
          </button>
        </div>
      )}
    </section>
  );
};
