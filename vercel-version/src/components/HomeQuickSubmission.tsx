import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardPatternOverlay } from './CardPatternOverlay';
import { soundManager } from '../utils/audio';
import { useAuthStore } from '../stores/authStore';
import { useAppShellStore } from '../stores/appShellStore';
import { submitToInbox } from '../utils/submissionInbox';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { getAccessToken } from '../utils/cloudbaseToken';

type Mode = 'menu' | 'novel' | 'art';

async function fileToWebpBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法转换图片');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) throw new Error(`无法转换 ${file.name}`);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(blob);
  });
}

export const HomeQuickSubmission: React.FC<{ onShowToast: (message: string) => void; characterImageUrl?: string }> = ({ onShowToast, characterImageUrl }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const profile = useAuthStore((state) => state.profile);
  const [title, setTitle] = useState('');
  const [homepage, setHomepage] = useState('');
  const [body, setBody] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<File[]>([]);

  useEffect(() => {
    if (!open) {
      setMode('menu');
      setTitle(''); setHomepage(''); setBody(''); setNotes(''); setTags(''); setImages([]);
    }
  }, [open]);

  const requireLogin = (next: Mode) => {
    soundManager.playWoodTap();
    if (!profile?.uid) {
      onShowToast('请先登录账号再投递');
      useAppShellStore.getState().openLogin();
      setOpen(false);
      return;
    }
    setMode(next);
  };

  const submitNovel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.nickname || !title.trim() || !body.trim()) return onShowToast('请填写标题和小说正文');
    setBusy(true);
    try {
      await submitToInbox('submitNovel', { title:title.trim(), author:profile.nickname, authorUrl:homepage.trim(), body:body.trim(), notes:notes.trim(), tags:tags.trim() });
      setOpen(false);
      onShowToast('小说已投递，等待管理员收录 📬');
    } catch (error) { onShowToast(error instanceof Error ? error.message : '小说投递失败'); }
    finally { setBusy(false); }
  };

  const submitArt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.nickname || !title.trim() || !images.length) return onShowToast('请填写标题并选择至少一张图片');
    const token = await getAccessToken();
    if (!token) { useAppShellStore.getState().openLogin(); return onShowToast('登录状态已失效，请重新登录'); }
    setBusy(true);
    try {
      const submissionId = `art-${Date.now().toString(36)}`;
      let folder = '';
      const files: string[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const imageBase64 = await fileToWebpBase64(images[index]);
        const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8', Authorization:`Bearer ${token}`}, body:JSON.stringify({ action:'submissionImageUpload', submissionId, index:index + 1, imageBase64 }) });
        const result = await response.json() as { ok?: boolean; error?: string; folder?: string; fileName?: string };
        if (!response.ok || !result.ok || !result.folder || !result.fileName) throw new Error(result.error || '图片上传失败');
        folder = result.folder; files.push(result.fileName);
      }
      await submitToInbox('submitArtwork', { title:title.trim(), author:profile.nickname, homepage:homepage.trim(), notes:notes.trim(), folder, files });
      setOpen(false);
      onShowToast('插画已转换为 WebP 并投递，等待管理员收录 🎨');
    } catch (error) { onShowToast(error instanceof Error ? error.message : '插画投递失败'); }
    finally { setBusy(false); }
  };

  const field = 'mt-1 w-full rounded-md border border-[#CDBA91] bg-white px-3 py-2 text-sm outline-none focus:border-[#1E4334]';
  return <>
    <section className="home-quick-action-shell mx-2.5 sm:mx-4 lg:mx-6 mt-1.5">
      <button id="btn-home-quick-submission" type="button" onClick={() => { soundManager.playWoodTap(); setOpen(true); }} className="home-quick-card relative block h-full w-full overflow-hidden rounded-xl bg-[#FAF3E3]/95 pl-3 pr-16 text-left shadow-[0_2px_7px_rgba(140,108,71,.18)] transition-transform hover:bg-[#FFF8E9] active:scale-[.99] cursor-pointer">
        <CardPatternOverlay opacity={0.07} mode="multiply" />
        {characterImageUrl && <img src={characterImageUrl} alt="随机人物" className="absolute bottom-0 right-1 h-[92%] w-14 object-contain" loading="lazy" decoding="async" />}
        <span className="relative z-10 flex h-full min-w-0 flex-col items-start justify-center text-left">
          <span className="font-serif-title text-sm sm:text-base font-black text-[#1E4334]">📮 一键投递</span>
          <span className="mt-0.5 flex items-center gap-1 text-[9px] text-[#8C6C47]">文字 · 企划 · 插画 <b className="text-[10px]">›</b></span>
        </span>
      </button>
    </section>
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}><div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-[#1E4334] bg-[#FFFDF6] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><CardPatternOverlay opacity={0.08} mode="multiply"/><div className="relative z-10"><div className="flex items-start justify-between"><div><h3 className="font-serif-title text-lg font-black text-[#1E4334]">📮 {mode === 'menu' ? '一键投递' : mode === 'novel' ? '投递文' : '投递画'}</h3><p className="mt-1 text-[10px] text-[#8C7A68]">{mode === 'menu' ? '所有内容均在当前页面完成投递' : `创作者：${profile?.nickname || '请先登录'}`}</p></div><button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-lg text-[#8C6C47] cursor-pointer" aria-label="关闭">✕</button></div>
      {mode === 'menu' && <div className="mt-4 grid gap-2"><button type="button" onClick={() => requireLogin('novel')} className="rounded-lg bg-[#1E4334] px-4 py-3 text-left text-[#FFF6D8] cursor-pointer"><b className="block text-sm">✍️ 投递文</b><span className="text-[10px] opacity-80">即时填写小说正文</span></button><button type="button" onClick={() => { if (!profile?.uid) { onShowToast('请先登录账号再投递'); useAppShellStore.getState().openLogin(); setOpen(false); return; } useAppShellStore.getState().requestSubmission('announcement'); setOpen(false); }} className="rounded-lg bg-[#8F3426] px-4 py-3 text-left text-white cursor-pointer"><b className="block text-sm">📜 投递利韩企划 / 公告</b><span className="text-[10px] opacity-80">即时填写企划与公告</span></button><button type="button" onClick={() => requireLogin('art')} className="rounded-lg bg-[#B7791F] px-4 py-3 text-left text-[#FFF9EC] cursor-pointer"><b className="block text-sm">🎨 投递画</b><span className="text-[10px] opacity-80">图片自动转换为 WebP</span></button></div>}
      {mode === 'novel' && <form onSubmit={submitNovel} className="mt-4 space-y-3"><label className="block text-xs font-bold">标题 *<input value={title} onChange={(e)=>setTitle(e.target.value)} className={field} required /></label><label className="block text-xs font-bold">作者<input value={profile?.nickname || ''} readOnly className={`${field} bg-[#EEE8D8]`} /></label><label className="block text-xs font-bold">主页链接（选填）<input type="url" value={homepage} onChange={(e)=>setHomepage(e.target.value)} className={field} /></label><label className="block text-xs font-bold">标签（选填）<input value={tags} onChange={(e)=>setTags(e.target.value)} placeholder="原作向,R" className={field} /></label><label className="block text-xs font-bold">小说正文 *<textarea value={body} onChange={(e)=>setBody(e.target.value)} rows={9} className={field} required /></label><label className="block text-xs font-bold">备注（选填）<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} className={field} /></label><button disabled={busy} className="w-full rounded-md bg-[#1E4334] px-4 py-2.5 font-bold text-[#FFF6D8] cursor-pointer">{busy?'提交中…':'提交'}</button></form>}
      {mode === 'art' && <form onSubmit={submitArt} className="mt-4 space-y-3"><label className="block text-xs font-bold">标题 *<input value={title} onChange={(e)=>setTitle(e.target.value)} className={field} required /></label><label className="block text-xs font-bold">创作者<input value={profile?.nickname || ''} readOnly className={`${field} bg-[#EEE8D8]`} /></label><label className="block text-xs font-bold">主页链接（选填）<input type="url" value={homepage} onChange={(e)=>setHomepage(e.target.value)} className={field} /></label><div><span className="block text-xs font-bold">上传图片 *</span><label className="mt-1 flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#B7791F] bg-[#FFF8E8] px-3 py-3 text-[#6B4515] transition-colors hover:bg-[#F8EBCB]"><span className="text-xl">🎨</span><span className="text-sm font-bold">{images.length ? `已选择 ${images.length} 张图片` : '选择插画或短漫图片'}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e)=>setImages(Array.from(e.target.files || []).slice(0,60))} className="sr-only" required /></label></div><p className="text-[10px] text-[#8C7A68]">保留原图宽高比，提交时统一转换为 WebP，最长边不超过 2200px。</p><label className="block text-xs font-bold">备注（选填）<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={3} className={field} /></label><button disabled={busy} className="w-full rounded-md bg-[#B7791F] px-4 py-2.5 font-bold text-white cursor-pointer">{busy?'提交中…':'提交'}</button></form>}
      {mode !== 'menu' && !busy && <button type="button" onClick={()=>setMode('menu')} className="mt-3 text-xs font-bold text-[#6B5138] cursor-pointer">← 返回投递类型</button>}</div></div></div>, document.body)}
  </>;
};
