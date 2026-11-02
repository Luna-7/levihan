import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  children?: ReactNode;
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
  children,
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
      }, 500);
      }, { root: null, rootMargin: '150% 0px 150% 0px', threshold: 0 });
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
        rootMargin: '60% 0px 90% 0px', // 只预加载相邻页面，避免一次拉取过多原图
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
                className={`absolute inset-0 w-full h-full object-contain block m-0 p-0 border-0 align-top select-none bg-[#F6F1E3] transition-opacity duration-150 ${displayReady ? 'opacity-100' : 'opacity-0'}`}
              />
          )}
          {children}
        </div>
      ) : (
        <>
          {failed && (
            <div
              className="w-full min-h-[240px] px-4 bg-[#1E2621] border-b border-dashed border-[#34483B] text-center text-[#A69C8E] font-retro-jp space-y-1 flex flex-col items-center justify-center"
              style={{ aspectRatio }}
            >
              <div className="text-sm font-pixel text-[#F9E79F]">第 {pageNumber} 页</div>
              <div className="text-xs text-[#C4B7A6] mt-0.5">图片加载失败</div>
              <div className="text-xs text-[#A69C8E]">请检查网络连接或存储桶配置</div>
              <button
                type="button"
                onClick={() => setFailed(false)}
                className="mt-3 min-h-10 px-4 text-xs text-[#F9E79F] underline underline-offset-4"
              >
                点击重试
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
