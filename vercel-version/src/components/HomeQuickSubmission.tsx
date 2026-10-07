import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Send } from 'lucide-react';
import { CardPatternOverlay } from './CardPatternOverlay';
import { soundManager } from '../utils/audio';
import { useAuthStore } from '../stores/authStore';
import { useAppShellStore } from '../stores/appShellStore';
import { submitToInbox } from '../utils/submissionInbox';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { getAccessToken } from '../utils/cloudbaseToken';
import { formatNotificationBody, notifyBrowser } from '../utils/browserNotifications';

type Mode = 'menu' | 'art';

type ArtworkImage = { file: File; preview: string };

type CropState = {
  index: number;
  zoom: number;
  offset: { x: number; y: number };
};

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

export const HomeQuickSubmission: React.FC<{ onShowToast: (message: string) => void; characterImageUrl?: string }> = React.memo(({ onShowToast, characterImageUrl }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const profile = useAuthStore((state) => state.profile);
  const [text, setText] = useState('');
  const [homepage, setHomepage] = useState('');
  const [images, setImages] = useState<ArtworkImage[]>([]);
  const [crop, setCrop] = useState<CropState | null>(null);
  const dragStart = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('menu');
      setText(''); setHomepage(''); setCrop(null);
      setImages((current) => {
        current.forEach((image) => URL.revokeObjectURL(image.preview));
        return [];
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'art') return;
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!pasted.length) return;
      event.preventDefault();
      addImages(pasted);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, open]);

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

  const openOriginalNovelSubmission = () => {
    soundManager.playWoodTap();
    if (!profile?.uid) {
      onShowToast('请先登录账号再投递');
      useAppShellStore.getState().openLogin();
      setOpen(false);
      return;
    }
    const shell = useAppShellStore.getState();
    shell.requestSubmission('novel');
    shell.openNovelCategory();
    shell.navigate('resources');
    setOpen(false);
  };

  const submitArt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.nickname || !images.length) return onShowToast('请选择至少一张图片');
    const token = await getAccessToken();
    if (!token) { useAppShellStore.getState().openLogin(); return onShowToast('登录状态已失效，请重新登录'); }
    const pendingImages = images.map((item) => item.file);
    const pendingText = text.trim();
    const pendingHomepage = homepage.trim();
    const pendingAuthor = profile.nickname;
    setOpen(false);
    setBusy(false);
    void (async () => {
      try {
      const submissionId = `art-${Date.now().toString(36)}`;
      let folder = '';
      const files: string[] = [];
      for (let index = 0; index < pendingImages.length; index += 1) {
        const imageBase64 = await fileToWebpBase64(pendingImages[index]);
        const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8', Authorization:`Bearer ${token}`}, body:JSON.stringify({ action:'submissionImageUpload', submissionId, index:index + 1, imageBase64 }) });
        const result = await response.json() as { ok?: boolean; error?: string; folder?: string; fileName?: string };
        if (!response.ok || !result.ok || !result.folder || !result.fileName) throw new Error(result.error || '图片上传失败');
        folder = result.folder; files.push(result.fileName);
      }
      await submitToInbox('submitArtwork', { text:pendingText, author:pendingAuthor, homepage:pendingHomepage, folder, files });
      notifyBrowser('新图出锅', { body: formatNotificationBody('图片已转换为 WebP，已直接发布到插画集。'), tag: 'artwork-submission' });
      onShowToast('插画已成功上架 🎨');
      } catch (error) { onShowToast(error instanceof Error ? error.message : '插画后台上传失败'); }
    })();
  };

  const addImages = (files: File[]) => {
    const incoming = files.filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 60 - images.length));
    if (!incoming.length) return onShowToast('请选择 JPG、PNG、GIF 或 WebP 图片');
    setImages((current) => [...current, ...incoming.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const applyCrop = async () => {
    if (!crop) return;
    const target = images[crop.index];
    if (!target) return;
    const image = new Image();
    image.src = target.preview;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片读取失败'));
    });
    const viewport = 280;
    const scale = Math.max(viewport / image.naturalWidth, viewport / image.naturalHeight) * crop.zoom;
    const sourceSize = viewport / scale;
    const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceSize, (image.naturalWidth - viewport / scale) / 2 - crop.offset.x / scale));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceSize, (image.naturalHeight - viewport / scale) / 2 - crop.offset.y / scale));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(2200, Math.max(1, Math.round(sourceSize)));
    canvas.height = canvas.width;
    const context = canvas.getContext('2d');
    if (!context) return onShowToast('当前浏览器无法裁剪图片');
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return onShowToast('图片裁剪失败');
    const file = new File([blob], target.file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
    const preview = URL.createObjectURL(file);
    URL.revokeObjectURL(target.preview);
    setImages((current) => current.map((item, index) => index === crop.index ? { file, preview } : item));
    setCrop(null);
  };

  const field = 'mt-1 w-full rounded-md border border-[#CDBA91] bg-white px-3 py-2 text-sm outline-none focus:border-[#1E4334]';
  return <>
    <section className="home-quick-action-shell mx-2.5 sm:mx-4 lg:mx-6 mt-1.5">
      <button id="btn-home-quick-submission" type="button" onClick={() => { soundManager.playWoodTap(); setOpen(true); }} className="home-quick-card relative block h-full w-full overflow-hidden rounded-xl bg-[#FAF3E3]/95 pl-3 pr-16 text-left shadow-[0_2px_7px_rgba(140,108,71,.18)] transition-transform hover:bg-[#FFF8E9] active:scale-[.99] cursor-pointer">
        <CardPatternOverlay opacity={0.07} mode="multiply" />
        {characterImageUrl && <img src={characterImageUrl} alt="随机人物" className="home-quick-character absolute right-1 object-contain object-bottom" loading="lazy" decoding="async" />}
        <span className="relative z-10 flex h-full min-w-0 flex-col items-start justify-center text-left">
        <span className="flex items-center gap-1.5 font-serif-title text-sm sm:text-base font-black text-[#1E4334]"><Send size={16} strokeWidth={2.5} aria-hidden="true" />一键投递</span>
          <span className="mt-0.5 flex items-center gap-1 text-[9px] text-[#8C6C47]">文字 · 企划 · 插画 <b className="text-[10px]">›</b></span>
        </span>
      </button>
    </section>
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}><div role="dialog" aria-modal="true" aria-labelledby="home-submission-title" className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-[#1E4334] bg-[#FFFDF6] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><CardPatternOverlay opacity={0.08} mode="multiply"/><div className="relative z-10"><div className="flex items-start justify-between"><div><h3 id="home-submission-title" className="flex items-center gap-2 font-serif-title text-lg font-black text-[#1E4334]"><Send size={18} strokeWidth={2.5} aria-hidden="true" />{mode === 'menu' ? '一键投递' : '投递画'}</h3><p className="mt-1 text-[10px] text-[#8C7A68]">{mode === 'menu' ? '选择投递类型' : `创作者：${profile?.nickname || '请先登录'}`}</p></div><button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-lg text-[#8C6C47] cursor-pointer" aria-label="关闭">✕</button></div>
      {mode === 'menu' && <div className="mt-4 grid gap-2"><button type="button" onClick={openOriginalNovelSubmission} className="rounded-lg bg-[#1E4334] px-4 py-3 text-left text-[#FFF6D8] cursor-pointer"><b className="block text-sm">✍️ 投递文</b><span className="text-[10px] opacity-80">打开原版表单，可上传文件、添加预警并加密正文</span></button><button type="button" onClick={() => { if (!profile?.uid) { onShowToast('请先登录账号再投递'); useAppShellStore.getState().openLogin(); setOpen(false); return; } useAppShellStore.getState().requestSubmission('announcement'); setOpen(false); }} className="rounded-lg bg-[#8F3426] px-4 py-3 text-left text-white cursor-pointer"><b className="block text-sm">📜 投递利韩企划 / 公告</b><span className="text-[10px] opacity-80">即时填写企划与公告</span></button><button type="button" onClick={() => requireLogin('art')} className="rounded-lg bg-[#B7791F] px-4 py-3 text-left text-[#FFF9EC] cursor-pointer"><b className="block text-sm">🎨 投递画</b><span className="text-[10px] opacity-80">图片自动转换为 WebP</span></button></div>}
      {mode === 'art' && <form onSubmit={submitArt} className="mt-4 space-y-3">
        <label className="block text-xs font-bold">文本（选填）<textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="可以写作品说明、角色或配图文字" className={field} /></label>
        <label className="block text-xs font-bold">创作者<input value={profile?.nickname || ''} readOnly className={`${field} bg-[#EEE8D8]`} /></label>
        <label className="block text-xs font-bold">主页链接（选填）<input type="url" value={homepage} onChange={(e) => setHomepage(e.target.value)} className={field} /></label>
        <div>
          <span className="block text-xs font-bold">上传图片 *</span>
          <label className="mt-1 flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#B7791F] bg-[#FFF8E8] px-3 py-3 text-[#6B4515] transition-colors hover:bg-[#F8EBCB]">
            <Palette size={20} strokeWidth={2.5} aria-hidden="true" />
            <span className="text-sm font-bold">{images.length ? `已选择 ${images.length} 张图片` : '点击或粘贴图片'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => addImages(Array.from(e.target.files || []))} className="sr-only" required={!images.length} />
          </label>
          {images.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((image, index) => <div key={`${image.file.name}-${index}`} className="relative overflow-hidden rounded-md border border-[#D5C19A] bg-[#FAF5E8]">
              <img src={image.preview} alt={`第 ${index + 1} 张预览`} className="aspect-square w-full object-cover" />
              <div className="absolute inset-x-1 bottom-1 flex gap-1">
                <button type="button" onClick={() => setCrop({ index, zoom: 1, offset: { x: 0, y: 0 } })} className="flex-1 rounded bg-[#1E4334]/90 px-1 py-1 text-[10px] font-bold text-white">裁剪</button>
                <button type="button" onClick={() => removeImage(index)} className="rounded bg-[#7A1F1F]/90 px-2 py-1 text-[10px] font-bold text-white" aria-label={`移除第 ${index + 1} 张图片`}>×</button>
              </div>
            </div>)}
          </div>}
        </div>
        <p className="text-[10px] text-[#8C7A68]">支持多图、复制粘贴和预览；提交时统一转换为 WebP，最长边不超过 2200px。</p>
        <button disabled={busy} className="w-full rounded-md bg-[#B7791F] px-4 py-2.5 font-bold text-white cursor-pointer">{busy ? '提交中…' : '提交'}</button>
      </form>}
      {crop && images[crop.index] && <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="裁剪图片">
        <div className="w-full max-w-sm rounded-xl border-2 border-[#1E4334] bg-[#FFFDF6] p-4">
          <div className="mb-3 flex items-center justify-between"><b className="text-[#1E4334]">裁剪图片</b><button type="button" onClick={() => setCrop(null)} className="text-xl text-[#8C6C47]" aria-label="关闭裁剪">×</button></div>
          <div className="relative mx-auto h-[280px] w-[280px] touch-none overflow-hidden rounded-md bg-[#2C241D]" onPointerDown={(event) => { dragStart.current = { x: event.clientX, y: event.clientY, offset: crop.offset }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragStart.current) return; setCrop((current) => current ? { ...current, offset: { x: dragStart.current!.offset.x + event.clientX - dragStart.current!.x, y: dragStart.current!.offset.y + event.clientY - dragStart.current!.y } } : current); }} onPointerUp={() => { dragStart.current = null; }}>
            <img src={images[crop.index].preview} alt="待裁剪图片" className="absolute inset-0 h-full w-full object-cover select-none" style={{ transform: `translate(${crop.offset.x}px, ${crop.offset.y}px) scale(${crop.zoom})` }} draggable={false} />
            <div className="pointer-events-none absolute inset-0 border-2 border-[#F9E79F]" />
          </div>
          <label className="mt-3 block text-xs font-bold text-[#5B4636]">缩放<input type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={(event) => setCrop((current) => current ? { ...current, zoom: Number(event.target.value) } : current)} className="mt-1 w-full accent-[#B7791F]" /></label>
          <div className="mt-3 flex gap-2"><button type="button" onClick={() => setCrop(null)} className="flex-1 rounded-md border border-[#BFA985] px-3 py-2 text-sm font-bold text-[#5B4636]">取消</button><button type="button" onClick={() => void applyCrop()} className="flex-1 rounded-md bg-[#1E4334] px-3 py-2 text-sm font-bold text-[#FFF6D8]">应用裁剪</button></div>
        </div>
      </div>}
      {mode !== 'menu' && !busy && <button type="button" onClick={()=>setMode('menu')} className="mt-3 text-xs font-bold text-[#6B5138] cursor-pointer">← 返回投递类型</button>}</div></div></div>, document.body)}
  </>;
});
