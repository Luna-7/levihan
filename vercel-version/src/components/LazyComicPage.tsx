import { useEffect, useRef, useState } from 'react';
import { imageLoadQueue } from '../utils/imageLoadQueue';
import { requestDebug } from '../utils/requestDebug';

type LazyComicPageProps = {
  pageNumber: number;
  src: string;
  className?: string;
  alt?: string;
  referrerPolicy?: string;
  onLoad?: () => void;
  onError?: () => void;
};

/**
 * 懒加载漫画页面组件
 * - 使用 IntersectionObserver 控制加载窗口
 * - 通过 imageLoadQueue 严格控制并发（最多 2 个）
 * - 依赖浏览器缓存避免重复请求
 * - 使用 React state 管理错误状态
 */
export default function LazyComicPage({
  pageNumber,
  src,
  className,
  alt,
  referrerPolicy,
  onLoad,
  onError,
}: LazyComicPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [displayReady, setDisplayReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [inRange, setInRange] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(2 / 3);
  const mountedRef = useRef(true);
  const unloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 已加载的长篇图片离开阅读区域后卸载 DOM 图像，保留占位高度。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (unloadTimerRef.current !== null) window.clearTimeout(unloadTimerRef.current);
        unloadTimerRef.current = null;
        setInRange(true);
        return;
      }
      // iOS 惯性滚动时观察器边界会快速往返。延迟摘图可避免刚离开边界就清空、
      // 下一帧又重新插入造成整块闪屏，同时仍能释放真正远离视口的图片。
      unloadTimerRef.current = window.setTimeout(() => {
        setInRange(false);
        setDisplayReady(false);
      }, 500);
    }, { root: null, rootMargin: '300% 0px 300% 0px', threshold: 0 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (unloadTimerRef.current !== null) window.clearTimeout(unloadTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin: '120% 0px 180% 0px', // 加载窗口：上方 120%，下方 180%
        threshold: 0,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!shouldLoad || loaded || failed) {
      return;
    }

    // 预加载图片到浏览器缓存
    const loadImage = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        requestDebug.recordImageRequest(src);

        const image = new Image();

        image.onload = () => {
          requestDebug.recordImageLoad();
          if (mountedRef.current && image.naturalWidth && image.naturalHeight) {
            setAspectRatio(image.naturalWidth / image.naturalHeight);
          }
          resolve();
        };

        image.onerror = () => {
          requestDebug.recordImageError();
          reject(new Error(`Failed to load image: ${src}`));
        };

        image.decoding = 'async';
        image.src = src;
      });
    };

    // 通过队列控制并发
    imageLoadQueue
      .add(() => loadImage())
      .then(() => {
        if (!mountedRef.current) return;

        setLoaded(true);
        onLoad?.();
      })
      .catch(() => {
        if (!mountedRef.current) return;

        setFailed(true);
        onError?.();
      });
  }, [shouldLoad, loaded, failed, src, onLoad, onError]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-page={pageNumber}
      style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
    >
      {!failed ? (
        <div className="relative w-full min-h-[240px] bg-[#F6F1E3]" style={{ aspectRatio }}>
          {!displayReady && <div aria-hidden="true" className="absolute inset-0 bg-[#F6F1E3]" />}
          {loaded && inRange && (
            <img
              src={src}
              alt={alt || `第 ${pageNumber} 页`}
              referrerPolicy={referrerPolicy}
              decoding="async"
              draggable={false}
              onLoad={() => setDisplayReady(true)}
              className={`absolute inset-0 w-full h-full object-contain block m-0 p-0 border-0 align-top select-none touch-pan-x touch-pan-y bg-[#F6F1E3] transition-opacity duration-150 ${displayReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
            />
          )}
        </div>
      ) : (
        <>
          {failed && (
            <div className="w-full py-10 px-4 bg-[#1E2621] border-b border-dashed border-[#34483B] text-center text-[#A69C8E] font-retro-jp space-y-1 block">
              <div className="text-sm font-pixel text-[#F9E79F]">第 {pageNumber} 页</div>
              <div className="text-[11px] text-[#C4B7A6] mt-0.5">图片加载失败</div>
              <div className="text-[9px] text-[#7A6958]">请检查网络连接或存储桶配置</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
