import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import type { DoujinBookItem } from '../types/doujinArchive';
import { cosService } from '../services/cosClient';

type Props = {
  book: DoujinBookItem;
  onClose: () => void;
  onShowToast: (message: string) => void;
};

export function BookShareModal({ book, onClose, onShowToast }: Props) {
  const posterRef = useRef<HTMLDivElement>(null);
  const [posterUrl, setPosterUrl] = useState('');
  const [imageReady, setImageReady] = useState(book.secure && !book.coverFile);
  const [coverFailed, setCoverFailed] = useState(false);
  const [generating, setGenerating] = useState(true);
  const canShowCover = (!book.secure || Boolean(book.coverFile)) && !coverFailed;
  const shareUrl = `${window.location.origin}/api/comic-share?id=${encodeURIComponent(book.id)}`;

  useEffect(() => {
    if (!imageReady || !posterRef.current) return;
    let cancelled = false;
    setGenerating(true);
    void toPng(posterRef.current, {
      cacheBust: true,
      pixelRatio: 2.2,
      backgroundColor: '#FAF3E3',
    }).then((url) => {
      if (!cancelled) setPosterUrl(url);
    }).catch(() => {
      if (!cancelled) onShowToast('分享海报生成失败，仍可分享链接');
    }).finally(() => {
      if (!cancelled) setGenerating(false);
    });
    return () => { cancelled = true; };
  }, [imageReady, onShowToast]);

  const shareLink = async () => {
    const title = `《${book.titleZh}》`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text: `${title} · 利韩典藏`, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      onShowToast('本子链接已复制 ✨');
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(shareUrl);
        onShowToast('分享面板不可用，链接已复制');
      } catch {
        onShowToast(`请复制分享链接：${shareUrl}`);
      }
    }
  };

  const savePoster = () => {
    if (!posterUrl) return;
    const link = document.createElement('a');
    link.download = `分享_${book.titleZh}_${Date.now()}.png`;
    link.href = posterUrl;
    link.click();
    onShowToast('分享卡片已保存 ✨');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] bg-black/60 flex items-center justify-center p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`分享《${book.titleZh}》`}
      onClick={onClose}
    >
      <div className="w-full max-w-[340px] space-y-2.5" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto w-[300px] max-w-full">
          <div ref={posterRef} className="bg-[#FAF3E3] border-2 border-[#1E4334] rounded-lg overflow-hidden shadow-xl">
            <div className="px-3 py-2 bg-[#1E4334] text-[#F9E79F] font-pixel text-[10px] flex justify-between">
              <span>✦ 利韩 · 典藏分享</span>
              <span>{book.secure ? '🔒 解析本' : '漫画本'}</span>
            </div>
            <div className="flex gap-3 p-3">
              <div className="w-[112px] shrink-0 aspect-[2/3] bg-[#EDEFF2] border border-[#D5C9AF] overflow-hidden flex items-center justify-center">
                {canShowCover ? (
                  <img
                    src={cosService.getCoverUrl(book)}
                    alt=""
                    crossOrigin="anonymous"
                    draggable={false}
                    className="w-full h-full object-cover"
                    onLoad={() => setImageReady(true)}
                    onError={() => { setCoverFailed(true); setImageReady(true); }}
                  />
                ) : (
                  <div className="p-2 text-center">
                    <div className="text-3xl">{book.secure ? '🔒' : '📖'}</div>
                    <div className="mt-1 text-[10px] font-pixel text-[#1E3A2B] break-words">{book.titleZh}</div>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5 text-left">
                <div className="font-pixel text-sm font-bold text-[#1E3A2B] leading-snug break-words">{book.titleZh}</div>
                {book.titleJp && <div className="text-[10px] text-[#8C7A68] italic break-words">{book.titleJp}</div>}
                <div className="text-[11px] text-[#3E342B]">作者：{book.circle || '未知'}</div>
                <div className="text-[11px] text-[#5B4636]">共 {book.pages || 0} 页{book.secure ? ' · 需校验码解析' : ''}</div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {book.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="text-[9px] px-1.5 py-0.5 border border-[#DECFA9] bg-[#F4EEDF] text-[#7A6958]">#{tag}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-3 py-1.5 border-t border-dashed border-[#D5C9AF] flex justify-between text-[9px] text-[#8C7A68]">
              <span>{window.location.host}</span>
              <span>{book.id}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-2">
          <button type="button" onClick={() => void shareLink()} className="px-4 py-2 bg-[#1E4334] text-[#F9E79F] border border-[#153025] font-pixel text-xs rounded-md shadow-md">
            ↗ 分享链接
          </button>
          <button type="button" onClick={savePoster} disabled={!posterUrl} className="px-4 py-2 bg-[#FFFEEF] text-[#1E4334] border border-[#1E4334] font-pixel text-xs rounded-md disabled:opacity-50">
            {generating ? '生成中…' : '保存卡片'}
          </button>
        </div>
        <button type="button" onClick={onClose} className="block mx-auto px-3 py-1 text-xs text-white/80">关闭</button>
      </div>
    </div>,
    document.body,
  );
}
