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
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    >
      {!shouldLoad ? (
        // 占位容器，维持滚动高度
        <div
          aria-hidden="true"
          className="w-full min-h-[240px]"
        />
      ) : (
        <>
          {loaded && (
            <img
              src={src}
              alt={alt || `第 ${pageNumber} 页`}
              referrerPolicy={referrerPolicy}
              loading="lazy"
              decoding="async"
              className="w-full h-auto block m-0 p-0 border-0 align-top select-none"
            />
          )}

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
