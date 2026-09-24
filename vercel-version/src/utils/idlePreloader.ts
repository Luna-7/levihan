/**
 * 闲时智能预加载器 (Idle Asset & Resource Preloader)
 * 利用 requestIdleCallback 在浏览器空闲阶段按优先级预拉取并缓存：
 * 1. 核心游戏与 UI 静态雪碧图 (WebP)
 * 2. 塔塔开 / 拯救韩吉 / 利了个韩小游戏入口页面 (Iframe HTML)
 * 3. 游戏背景音乐 (Audio BGM Metadata)
 * 4. 底部 TAB 与深层组件的 JS Chunk
 */

type RequestIdleCallbackHandle = number;
type RequestIdleCallbackOptions = {
  timeout?: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

const requestIdle = (
  callback: (deadline: RequestIdleCallbackDeadline) => void,
  options?: RequestIdleCallbackOptions
): RequestIdleCallbackHandle => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return (window as unknown as { requestIdleCallback: typeof requestIdle }).requestIdleCallback(callback, options);
  }
  return setTimeout(() => {
    const start = Date.now();
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
    });
  }, 100) as unknown as number;
};

// 内存中常驻的 Image 实例缓存，避免 GC 回收导致浏览器再次请求
const preloadedImages = new Set<HTMLImageElement>();
const preloadedLinks = new Set<string>();
const preloadedAudio = new Set<HTMLAudioElement>();

// 高优先级 Core 雪碧图与关键图片
const TIER_1_IMAGES = [
  '/images/lihan/lihan-tray.webp',
  '/images/lihan/lihan-tiles-clean.webp',
  '/images/lihan/lihan-victory.webp',
  '/favicon.svg',
];

// 游戏与音频 Prefetch 链接
const TIER_2_RESOURCE_URLS = [
  '/daxigua/index.html',
  '/save-hange/index.html',
  '/sounds/bgm.mp3',
  '/sounds/lihan-bgm.mp3',
];

// 预加载图片并缓存解码
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    const img = new Image();
    img.onload = () => {
      preloadedImages.add(img);
      // 若浏览器支持 img.decode()，提前触发 GPU 解码
      if ('decode' in img && typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(() => resolve());
      } else {
        resolve();
      }
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

// 插入 `<link rel="prefetch">` 标签预拉取远程静态资源
function prefetchUrl(url: string, asType?: string): void {
  if (typeof document === 'undefined' || preloadedLinks.has(url)) return;
  try {
    preloadedLinks.add(url);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    if (asType) {
      link.as = asType;
    }
    document.head.appendChild(link);
  } catch {
    // ignore errors
  }
}

// 预热 BGM 音频 header，加速进入游戏时的播放速度
function warmAudioBgm(src: string): void {
  if (typeof window === 'undefined' || preloadedAudio.has(src as unknown as HTMLAudioElement)) return;
  try {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = src;
    preloadedAudio.add(audio);
  } catch {
    // ignore
  }
}

// 预加载 React Lazy 动态 Chunk
async function preloadLazyComponents(): Promise<void> {
  try {
    await Promise.all([
      import('../components/DoujinshiArchive'),
      import('../components/RestaurantForum'),
      import('../components/DispatchHub'),
      import('../components/ResourceHub'),
    ]);
  } catch {
    // ignore chunk load failures during idle
  }
}

let isInitialized = false;

/**
 * 初始化空闲资源预加载器
 * 在 App 挂载 1 秒后自动在浏览器 Idle 期间逐级预热全站资源
 */
export function initIdlePreloader(): void {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // 延迟 1000ms 执行，避开首屏 JS 解析与 DOM 首次渲染主线程高峰
  window.setTimeout(() => {
    // 阶段 1：预加载 Core 游戏雪碧图与高频 Icon
    requestIdle((deadline) => {
      let idx = 0;
      const processImages = () => {
        while (idx < TIER_1_IMAGES.length && (deadline.timeRemaining() > 5 || deadline.didTimeout)) {
          const imgUrl = TIER_1_IMAGES[idx++];
          void preloadImage(imgUrl);
        }
        if (idx < TIER_1_IMAGES.length) {
          requestIdle(processImages, { timeout: 1500 });
        }
      };
      processImages();
    }, { timeout: 1000 });

    // 阶段 2：预热游戏 HTML 与 BGM 音频
    requestIdle(() => {
      TIER_2_RESOURCE_URLS.forEach((url) => {
        if (url.endsWith('.mp3')) {
          warmAudioBgm(url);
          prefetchUrl(url, 'audio');
        } else {
          prefetchUrl(url, 'document');
        }
      });
    }, { timeout: 2000 });

    // 阶段 3：预加载下游 Tab 动态 JS Chunk
    requestIdle(() => {
      void preloadLazyComponents();
    }, { timeout: 3000 });
  }, 1000);
}
