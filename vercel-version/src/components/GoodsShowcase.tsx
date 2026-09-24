import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GoodsItem } from '../types';
import { cosService } from '../services/cosClient';
import { soundManager } from '../utils/audio';
import { imageLoadQueue } from '../utils/imageLoadQueue';
import { requestDebug } from '../utils/requestDebug';
import { CardPatternOverlay } from './CardPatternOverlay';

interface Props {
  onShowToast: (msg: string) => void;
}

/**
 * 「周边橱窗」—— 巨人资源里的周边图片（PNG）区块。
 *
 * 设计要点（三条都是为「不占内存」服务的）：
 * 1. **图片不进仓库、不进构建产物**：原图放在 COS 的 goods/ 目录，清单是 goods/manifest.json。
 *    仓库里只有这份组件，所以 Workbox 预缓存（2 MiB 上限）和访客首屏都不受图片体积影响。
 * 2. **列表只加载缩略图**：同一张原图加 `?imageMogr2/thumbnail/420x/format/webp` 由 COS 现场生成，
 *    实测 115 KB → 34 KB；灯箱看大图用 1600px 预览，**只有点「下载」才取真正的原图**。
 * 3. **图片离开视口就卸载**：IntersectionObserver 管两件事——进视口才排队加载（并发 2，走 imageLoadQueue），
 *    出视口就把 <img> 从 DOM 摘掉（只留占位高度），长列表滚到底也不会把几十张图堆在内存里。
 *
 * 下载走 fetch → blob → objectURL → <a download> → 立刻 revokeObjectURL（用完即释放）；
 * 桶本身带 CORS 与 Content-Disposition: attachment，所以取流失败时退回「新标签打开原图」也能直接保存。
 */

/** 列表缩略图宽度（CSS px 的 2 倍左右，够清晰又不费流量） */
const THUMB_WIDTH = 420;
/** 灯箱预览宽度：够看清细节，但不是原图（原图留给「下载」） */
const PREVIEW_WIDTH = 1600;
/** 加载触发/卸载留白：距视口 300px 就开始加载，出了这个范围就卸载 */
const VIEW_MARGIN = '300px 0px 300px 0px';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* 单张周边卡：自身负责「什么时候加载、什么时候卸载」                     */
/* ------------------------------------------------------------------ */
const GoodsCard: React.FC<{
  item: GoodsItem;
  index: number;
  downloading: boolean;
  onOpen: (index: number) => void;
  onDownload: (item: GoodsItem) => void;
}> = ({ item, index, downloading, onOpen, onDownload }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [inRange, setInRange] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          setInRange(true);
        } else {
          setInRange(false);
        }
      },
      { root: null, rootMargin: VIEW_MARGIN, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad || loaded || failed) return;
    let cancelled = false;
    const thumbUrl = cosService.getGoodsThumbUrl(item.file, THUMB_WIDTH);

    // 并发 2 的队列：几十张缩略图不会瞬间打满连接、也不会一次性全进内存
    imageLoadQueue
      .add(
        () =>
          new Promise<void>((resolve, reject) => {
            requestDebug.recordImageRequest(thumbUrl);
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
              requestDebug.recordImageLoad();
              resolve();
            };
            img.onerror = () => {
              requestDebug.recordImageError();
              reject(new Error(`thumb failed: ${thumbUrl}`));
            };
            img.src = thumbUrl;
          }),
      )
      .then(() => {
        if (!cancelled && aliveRef.current) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled && aliveRef.current) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, loaded, failed, item.file]);

  // 占位比例：清单里有真实尺寸就用真实比例，避免图片到位时列表跳动
  const aspectRatio = item.width && item.height ? `${item.width} / ${item.height}` : '3 / 4';

  return (
    <div
      className="relative overflow-hidden bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#1E4334] rounded-md p-2 sm:p-2.5 flex flex-col transition-all hover:shadow-md group select-none"
      onMouseEnter={() => soundManager.playCardHover()}
    >
      <CardPatternOverlay opacity={0.08} mode="multiply" />

      <div
        ref={boxRef}
        onClick={() => {
          soundManager.playPageTurn();
          onOpen(index);
        }}
        className="relative z-10 w-full rounded-xs overflow-hidden bg-[#F2ECE0] border border-[#E0D5BE] cursor-pointer"
        style={{ aspectRatio }}
        title="点击看大图"
      >
        {loaded && inRange ? (
          <img
            src={cosService.getGoodsThumbUrl(item.file, THUMB_WIDTH)}
            alt={item.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="w-full h-full object-contain block"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-lg text-[#C4B7A6] font-pixel">
            {failed ? '🖼' : ''}
          </div>
        )}
        {failed && (
          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-[#1E2621]/85 text-center font-retro-jp text-[9px] text-[#C4B7A6]">
            缩略图加载失败
          </div>
        )}
      </div>

      <div className="relative z-10 pt-1.5 space-y-1">
        <h4 className="font-pixel text-[11px] sm:text-xs font-bold text-[#1E3A2B] leading-snug break-words">
          {item.title}
        </h4>
        {(item.note || item.bytes) && (
          <p className="font-retro-jp text-[10px] text-[#8C7A68] leading-tight break-words">
            {item.note}
            {item.note && item.bytes ? ' · ' : ''}
            {item.bytes ? `PNG ${formatBytes(item.bytes)}` : ''}
          </p>
        )}
        <div className="flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => {
              soundManager.playCoin();
              onDownload(item);
            }}
            disabled={downloading}
            className="flex-1 px-1.5 py-1 bg-[#1E4334] text-[#F9E79F] border border-[#153025] font-pixel text-[10px] font-bold rounded-xs cursor-pointer enabled:hover:bg-[#2B5E4A] disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
            title="下载 PNG 原图"
          >
            {downloading ? '取图中…' : '⬇ 下载'}
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playPageTurn();
              onOpen(index);
            }}
            className="px-1.5 py-1 bg-[#FAF5E8] text-[#5B4636] border border-[#D5C9AF] font-pixel text-[10px] font-bold rounded-xs cursor-pointer hover:bg-[#F3EAD5] whitespace-nowrap"
            title="看大图"
          >
            看大图
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 区块本体                                                            */
/* ------------------------------------------------------------------ */
export const GoodsShowcase: React.FC<Props> = ({ onShowToast }) => {
  const [items, setItems] = useState<GoodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [downloading, setDownloading] = useState('');

  // 只在切到「周边橱窗」分类时才挂载 → 才去读清单，不进这个分类就零请求
  useEffect(() => {
    let cancelled = false;
    cosService
      .loadGoodsList()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.title.toLowerCase().includes(q) || (it.note || '').toLowerCase().includes(q),
    );
  }, [items, keyword]);

  const activeItem = activeIndex >= 0 ? filtered[activeIndex] : undefined;

  const handleDownload = async (item: GoodsItem) => {
    const url = cosService.getGoodsOriginalUrl(item.file);
    setDownloading(item.file);
    try {
      // COS 桶已配 CORS，可以直接取流；blob 用完立刻释放，不把原图留在内存里
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = item.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
      onShowToast('原图下载中，若没反应可长按图片保存 📥');
    } catch {
      // iOS Safari 对 download 属性支持不一、或跨域取流被拦：退回新标签打开原图
      window.open(url, '_blank', 'noopener,noreferrer');
      onShowToast('已在新标签打开原图，长按或右键即可保存 📥');
    } finally {
      setDownloading('');
    }
  };

  const handleCopyLink = (item: GoodsItem) => {
    const url = cosService.getGoodsOriginalUrl(item.file);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => onShowToast('原图直链已复制 🔗'),
        () => onShowToast(`原图直链：${url}`),
      );
    } else {
      onShowToast(`原图直链：${url}`);
    }
  };

  const step = (delta: number) => {
    if (filtered.length === 0) return;
    soundManager.playNavClick();
    setActiveIndex((cur) => (cur + delta + filtered.length) % filtered.length);
  };

  return (
    <div id="goods-showcase-root" className="space-y-2.5">
      {/* 说明条 */}
      <div className="p-2 px-3 bg-[#FBF3E4] border-l-3 border-[#B7791F] rounded-r-xs font-retro-jp text-[11px] text-[#5B4636] flex items-center">
        <div>
          <span className="font-bold">🖼 周边橱窗：</span>
          陈列利韩相关的官方/同人周边 PNG 原图。列表只加载缩略图，点开看大图，<b>「⬇ 下载」拿到的才是原图</b>。
        </div>
      </div>

      {/* 搜索（图多了才有意义，少于一屏时不占地方） */}
      {items.length > 8 && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="搜索周边名称、材质、年份…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="px-2.5 py-1.5 text-xs sm:text-sm font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full focus:outline-none focus:border-[#1E4334]"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="text-xs sm:text-sm text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-[#FFFEEF] border-2 border-[#D5C9AF] rounded-md p-2.5 animate-pulse"
            >
              <div className="w-full rounded-xs bg-[#EFE7D8]" style={{ aspectRatio: '3 / 4' }} />
              <div className="h-2.5 mt-2 rounded-xs bg-[#EFE7D8]" />
              <div className="h-2.5 mt-1.5 w-2/3 rounded-xs bg-[#EFE7D8]" />
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 items-start">
          {filtered.map((item, i) => (
            <GoodsCard
              key={item.file}
              item={item}
              index={i}
              downloading={downloading === item.file}
              onOpen={setActiveIndex}
              onDownload={handleDownload}
            />
          ))}
        </div>
      ) : (
        <div className="p-6 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md font-retro-jp text-xs text-[#8C7A68] space-y-1">
          <div className="text-2xl">🖼</div>
          {items.length === 0 ? (
            <>
              <p className="font-bold text-[#5B4636]">橱窗还没上货</p>
              <p>把周边 PNG 放进本地 goods-src/ 目录，跑一次 npm run sync:goods 就会上架。</p>
            </>
          ) : (
            <p>没有匹配「{keyword}」的周边，换个词试试～</p>
          )}
        </div>
      )}

      {/* 灯箱：只有点开才请求 1600px 预览；关闭即卸载 DOM，图不在内存里常驻 */}
      {activeItem && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[1400] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-3 select-none animate-in fade-in duration-150"
          onClick={() => setActiveIndex(-1)}
        >
          <div
            className="w-full max-w-3xl max-h-[88dvh] flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex-1 min-h-0 flex items-center justify-center">
              <img
                src={cosService.getGoodsPreviewUrl(activeItem.file, PREVIEW_WIDTH)}
                alt={activeItem.title}
                decoding="async"
                draggable={false}
                onLoad={() => requestDebug.recordImageLoad()}
                className="max-h-[74dvh] max-w-full object-contain rounded-md border-2 border-[#C5A059]/50 shadow-2xl bg-[#FFFEEF]"
              />
              {filtered.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-12 bg-black/45 hover:bg-black/70 text-[#F9E79F] font-pixel rounded-xs cursor-pointer"
                    title="上一张"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-12 bg-black/45 hover:bg-black/70 text-[#F9E79F] font-pixel rounded-xs cursor-pointer"
                    title="下一张"
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            <div className="shrink-0 bg-[#FAF5EA] border border-[#C5A059]/50 rounded-md px-3 py-2 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-pixel text-xs sm:text-sm font-bold text-[#1E3A2B] break-words">
                  {activeItem.title}
                </span>
                <span className="font-retro-jp text-[10px] text-[#8C7A68] whitespace-nowrap shrink-0">
                  {activeIndex + 1} / {filtered.length}
                  {activeItem.bytes ? ` · PNG ${formatBytes(activeItem.bytes)}` : ''}
                </span>
              </div>
              {activeItem.note && (
                <p className="font-retro-jp text-[10px] text-[#7A6958]">{activeItem.note}</p>
              )}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => handleDownload(activeItem)}
                  disabled={downloading === activeItem.file}
                  className="flex-1 px-2 py-1.5 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-pixel text-[11px] font-bold rounded-xs cursor-pointer enabled:hover:bg-[#2B5E4A] disabled:opacity-60 disabled:cursor-wait"
                >
                  {downloading === activeItem.file ? '取图中…' : '⬇ 下载原图 PNG'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyLink(activeItem)}
                  className="px-2 py-1.5 bg-[#FAF5E8] text-[#5B4636] border-2 border-[#D5C9AF] font-pixel text-[11px] font-bold rounded-xs cursor-pointer hover:bg-[#F3EAD5] whitespace-nowrap"
                >
                  🔗 直链
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setActiveIndex(-1);
                  }}
                  className="px-2 py-1.5 bg-[#FAF5E8] text-[#5B4636] border-2 border-[#D5C9AF] font-pixel text-[11px] font-bold rounded-xs cursor-pointer hover:bg-[#F3EAD5] whitespace-nowrap"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
