import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, X } from 'lucide-react';
import { soundManager } from '../utils/audio';
import { cloudbase } from '../utils/cloudbase';

type ForumComment = { id: string; author: string; body: string; createdAt: string; potatoes?: number; potatoGiven?: boolean };
type ForumPost = {
  id: string;
  author: string;
  title: string;
  body: string;
  image?: string;
  potatoes: number;
  potatoGiven?: boolean;
  createdAt: string;
  comments: ForumComment[];
};

const STORAGE_KEY = 'levihan_restaurant_forum_v1';
const FORUM_ENDPOINT = 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload';
const seedPosts: ForumPost[] = [
  {
    id: 'restaurant-welcome',
    author: '餐厅值班兵',
    title: '巨树餐厅今日开门',
    body: '这里是同好论坛。可以发布文字或图片，也可以在评论区继续聊天。',
    potatoes: 28,
    createdAt: '刚刚',
    comments: [{ id: 'welcome-comment', author: '调查兵', body: '先送一颗土豆！', createdAt: '刚刚' }],
  },
  {
    id: 'restaurant-topic',
    author: '眼镜维修班',
    title: '今天重看了森林篇',
    body: '那些没有说出口的默契，隔了很多年再看依然很动人。',
    potatoes: 16,
    createdAt: '2 小时前',
    comments: [],
  },
];

const loadPosts = (): ForumPost[] => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : seedPosts;
  } catch {
    return seedPosts;
  }
};

interface Props { onBack: () => void; onShowToast: (message: string) => void }

export const RestaurantForum: React.FC<Props> = ({ onBack, onShowToast }) => {
  const [posts, setPosts] = useState<ForumPost[]>(loadPosts);
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | undefined>();
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [nickname, setNickname] = useState('');
  const [publishing, setPublishing] = useState(false);

  const api = async (action: string, fields: Record<string, unknown> = {}) => {
    const response = await fetch(FORUM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ action, ...fields }) });
    const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || '论坛服务暂不可用'); return result;
  };
  useEffect(() => {
    void api('forumList').then((result) => { if (Array.isArray(result.posts)) persist(result.posts); }).catch(() => undefined);
    void (async () => { try { const user = await cloudbase.auth().getCurrentUser(); if (!user) return; const response = await cloudbase.callFunction({ name: 'getUserAccount', data: {} }); setNickname((response?.result || response)?.profile?.nickname || ''); } catch { setNickname(''); } })();
  }, []);

  const sortedPosts = useMemo(() => posts, [posts]);
  const persist = (next: ForumPost[]) => {
    setPosts(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  };

  const handleImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return onShowToast('发布仅支持图片文件');
    if (file.size > 2 * 1024 * 1024) return onShowToast('图片不能超过 2MB');
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nickname) { onShowToast('请先在登录页面设置昵称并登录'); window.dispatchEvent(new Event('levihan-open-login')); return; }
    if (!title.trim() || (!body.trim() && !image)) return onShowToast('请填写标题，并添加正文或图片');
    setPublishing(true);
    try {
      const result = await api('forumPublish', { author: nickname, title: title.trim(), body: body.trim(), imageBase64: image?.split(',')[1] || '' });
      persist(result.posts || posts); setTitle(''); setBody(''); setImage(undefined); setShowComposer(false);
      soundManager.playCoin(); onShowToast('帖子发布成功');
    } catch (error) { onShowToast(error instanceof Error ? error.message : '发布失败'); }
    finally { setPublishing(false); }
  };

  const givePotato = (id: string) => {
    persist(posts.map((post) => post.id === id ? {
      ...post,
      potatoGiven: !post.potatoGiven,
      potatoes: Math.max(0, post.potatoes + (post.potatoGiven ? -1 : 1)),
    } : post));
    soundManager.playCoin();
  };

  const addComment = async (postId: string) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    if (!nickname) { onShowToast('请先登录后评论'); window.dispatchEvent(new Event('levihan-open-login')); return; }
    try { const result = await api('forumComment', { postId, author: nickname, body: text }); persist(result.posts || posts); setCommentDrafts((drafts) => ({ ...drafts, [postId]: '' })); }
    catch (error) { onShowToast(error instanceof Error ? error.message : '评论失败'); }
  };

  const giveCommentPotato = (postId: string, commentId: string) => {
    persist(posts.map((post) => post.id === postId ? {
      ...post,
      comments: post.comments.map((comment) => comment.id === commentId ? {
        ...comment,
        potatoGiven: !comment.potatoGiven,
        potatoes: Math.max(0, (comment.potatoes || 0) + (comment.potatoGiven ? -1 : 1)),
      } : comment),
    } : post));
    soundManager.playCoin();
  };

  return (
    <div className="w-full h-full pb-20 sm:pb-22 bg-[#E9E2CC] text-[#1D2922] flex flex-col overflow-hidden">
      <header className="shrink-0 bg-[#F8F1DE] border-b-2 border-[#1E4334] px-3 sm:px-5 py-2.5">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={onBack} className="text-sm text-[#285A46] font-bold cursor-pointer whitespace-nowrap">← 返回</button>
            <h1 className="font-serif-title text-base sm:text-lg font-black text-[#1E4334] truncate">巨树餐厅论坛</h1>
          </div>
          <button type="button" onClick={() => setShowComposer(true)} className="px-3 py-1.5 rounded-full bg-[#1E4334] text-white text-xs font-bold cursor-pointer flex items-center gap-1 active:scale-95">
            <Plus size={14} /> 发布
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto bg-[#FFFBEF] sm:my-3 sm:border-2 sm:border-[#8C6C47] sm:rounded-xl overflow-hidden shadow-[4px_4px_0_rgba(30,67,52,.18)]">
          {sortedPosts.map((post) => (
            <article
              key={post.id}
              onClick={() => setOpenComments(openComments === post.id ? null : post.id)}
              className="px-4 py-4 border-b border-[#DCE5DF] last:border-b-0 cursor-pointer hover:bg-[#FAFCFA] transition-colors"
              aria-expanded={openComments === post.id}
            >
              <div className="text-xs text-[#627269]"><b className="text-[#285A46]">u/{post.author}</b><span className="mx-1.5">·</span>{post.createdAt}</div>
              <h2 className="mt-2 text-base sm:text-lg font-bold leading-snug text-[#17221C]">{post.title}</h2>
              {post.body && <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-[#35463C]">{post.body}</p>}
              {post.image && <img src={post.image} alt="帖子图片" className="mt-3 max-h-[460px] w-full object-contain rounded-lg bg-[#E8EFEA] border border-[#CAD7CF]" />}

              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={(event) => { event.stopPropagation(); givePotato(post.id); }} className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer ${post.potatoGiven ? 'bg-[#D8EBDD] text-[#1E4334]' : 'bg-[#E8EEEA] text-[#35463C]'}`}>
                  <span aria-hidden="true">🥔</span><span>送土豆</span><span>{post.potatoes}</span>
                </button>
                <span className="px-3 py-1.5 rounded-full bg-[#E8EEEA] text-[#35463C] text-xs font-bold flex items-center gap-1.5">
                  <MessageCircle size={14} /><span>{post.comments.length} 条评论</span>
                </span>
              </div>

              {openComments === post.id && (
                <section onClick={(event) => event.stopPropagation()} className="mt-4 pt-3 border-t border-[#DCE5DF] space-y-4 cursor-default">
                  <div className="flex gap-2">
                    <input value={commentDrafts[post.id] || ''} onChange={(e) => setCommentDrafts((drafts) => ({ ...drafts, [post.id]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && addComment(post.id)} placeholder="加入评论" className="min-w-0 flex-1 px-3 py-2 rounded-full border border-[#B8C8BE] text-sm outline-none focus:border-[#285A46]" />
                    <button type="button" onClick={() => addComment(post.id)} className="px-4 py-2 rounded-full bg-[#285A46] text-white text-xs font-bold cursor-pointer">评论</button>
                  </div>

                  <div className="border-l-2 border-[#CAD7CF] ml-1.5 pl-4 space-y-0">
                  {post.comments.map((comment, index) => (
                    <div key={comment.id} className={`relative py-3 ${index < post.comments.length - 1 ? 'border-b border-[#E4EAE6]' : ''}`}>
                      <span className="absolute -left-[22px] top-5 w-3 h-px bg-[#CAD7CF]" aria-hidden="true" />
                      <div className="text-[11px] text-[#627269]"><b className="text-[#285A46]">u/{comment.author}</b><span className="mx-1">·</span>{comment.createdAt}</div>
                      <p className="mt-1.5 text-sm leading-relaxed text-[#35463C] whitespace-pre-wrap">{comment.body}</p>
                      <div className="mt-2 flex items-center gap-4 text-[11px] font-bold text-[#627269]">
                        <button type="button" onClick={() => giveCommentPotato(post.id, comment.id)} className={`flex items-center gap-1 cursor-pointer ${comment.potatoGiven ? 'text-[#1E4334]' : ''}`}>
                          <span>🥔</span><span>{comment.potatoes || 0}</span>
                        </button>
                        <button type="button" onClick={() => setCommentDrafts((drafts) => ({ ...drafts, [post.id]: `@${comment.author} ` }))} className="flex items-center gap-1 cursor-pointer">
                          <MessageCircle size={13} /><span>回复</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {!post.comments.length && <p className="py-4 text-xs text-[#708077]">还没有评论。</p>}
                  </div>
                </section>
              )}
            </article>
          ))}
        </div>
      </main>

      {showComposer && (
        <div className="fixed inset-0 z-[100] bg-black/55 flex items-center justify-center p-3" onMouseDown={(e) => e.target === e.currentTarget && setShowComposer(false)}>
          <form onSubmit={publish} className="w-full max-w-lg bg-white rounded-xl border border-[#8FB9A3] p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="font-bold text-[#1E4334]">发布帖子</h2><button type="button" onClick={() => setShowComposer(false)} aria-label="关闭" className="cursor-pointer"><X size={18} /></button></div>
            <p className="text-xs text-[#6F7D75] bg-[#F2F5F1] border border-[#CAD7CF] rounded-lg p-2">昵称是在登录页面统一设置，沿用到后面所有需要昵称的地方。{nickname ? ` 当前昵称：${nickname}` : ' 当前尚未登录。'}</p>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="标题" className="w-full p-2.5 border border-[#B8C8BE] rounded-lg outline-none focus:border-[#285A46]" required />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={3000} placeholder="正文（可选）" className="w-full p-2.5 border border-[#B8C8BE] rounded-lg outline-none focus:border-[#285A46] resize-y" />
            <label className="block p-3 text-center border border-dashed border-[#8FB9A3] rounded-lg bg-[#F2F7F3] cursor-pointer text-xs font-bold text-[#285A46]">
              {image ? '已选择图片，点击更换' : '添加图片（可选，最大 2MB）'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImage(e.target.files?.[0])} />
            </label>
            {image && <img src={image} alt="待发布图片预览" className="max-h-48 w-full object-contain rounded-lg bg-[#E8EFEA]" />}
            <button type="submit" disabled={publishing} className="w-full py-2.5 rounded-full bg-[#1E4334] text-white text-sm font-bold cursor-pointer disabled:opacity-50">{publishing ? '发布中…' : '发布'}</button>
          </form>
        </div>
      )}
    </div>
  );
};
