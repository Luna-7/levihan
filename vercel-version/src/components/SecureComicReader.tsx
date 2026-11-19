import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// ?url 让 Vite 把 1MB 的 worker 原样 emit 成 assets/ 下的一个文件并返回其 URL（同源，走站点自己的 CDN）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import type { DoujinBookItem } from '../types/doujinArchive';
import { CollectionFooterNavigation, CollectionNavigationBar } from './CollectionNavigation';
import { MangaCommentSection } from './MangaCommentSection';
import { cosService } from '../services/cosClient';
import { decryptOuterLayer } from '../utils/secureComicDecrypt';
import { useSwipeBackGesture } from '../hooks/useSwipeBackGesture';
import { ComicMusicPlayer, isComicMusicFile } from './ComicMusicPlayer';
import { SecureComicLoadingDialog } from './SecureComicLoadingDialog';
import { ComicReaderHeader } from './ComicReaderHeader';
import { CardPatternOverlay } from './CardPatternOverlay';

/**
 * ============================================================================
 * SecureComicReader —— 加密作品的「自动解析弹窗 + Canvas 瀑布流」
 * ----------------------------------------------------------------------------
 * 与 public/admin/secure-upload.js 配套：管理台勾选「含有敏感元素」上传后，
 * COS 上存放 AES-256-CBC 密文，伪装成纯文本；旧作品仍使用 {id}_secure.txt 固定路径，
 * 新上传作品通过归档中的 secureFile 指向独立版本路径。
 * 站点上不给任何图片或 .pdf 直链，必须由本组件在浏览器内存里解开才看得到。
 *
 * 解密是两层，共用上传端现有的固定口令：
 *   外层：Web Crypto 解 AES-256-CBC —— key = SHA-256('levihan')，IV = 'levihan-vault-iv'
 *         解出来**直接就是 PDF 的二进制字节**（不要再做一次 Base64 解码）
 *   内层：把同一个口令透传给 pdfjs 的 password 参数，解 jsPDF 施加的 PDF 标准口令
 *         若管理台上传的是图片（内层没加口令），多传这个参数会被 pdf.js 忽略 —— 都成立
 *
 * ⚠️ 诚实的边界：这套东西挡的是"顺手另存 / 右键查看 / 简易爬虫"，
 *    不是密码学意义上的机密。密码、IV 都在前端代码里，任何人都能离线解开。
 *    下面那些禁用右键 / F12 的代码同理 —— 提高门槛，不构成安全防线。
 * ============================================================================
 */

/** 密文目录与文件名规则，必须和 secure-upload.js 的 buildVaultKey() 完全一致 */
const VAULT_DIR = 'comic_vault';

/**
 * PDF.js 的 worker：版本必须与依赖里的 pdfjs-dist 严格一致，否则会解析错乱
 * （?url 直接指向 node_modules 里那个 3.11.174 的 worker，天然同步）。
 *
 * 曾经**刻意**走第三方 CDN 以免在 Vite 里配 ?url —— 实测这个取舍是错的：
 * 那家 CDN 上 1MB 的 worker 单请求就要数秒（320KB 的 pdf.min.js 尚需 2.7~3.0s），
 * 手机网络下更慢，而 worker 没下载完这本就打不开，症状是「一直卡在解密/加载中」。
 * 改成随包发布后：同源、走站点自己的 CDN，且与 CloudBase 管理台用的是同一份字节。
 */
const PDFJS_WORKER_SRC = pdfWorkerUrl;

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

type SecureComicReaderProps = {
  book: DoujinBookItem;
  collectionBooks?: DoujinBookItem[];
  onNavigateCollectionBook?: (book: DoujinBookItem) => void;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
  onCommentCountChange?: () => void;
  commentPreviewMode?: boolean;
};

type Phase = 'locked' | 'working' | 'ready';
type SecureResourceFailureKind = 'offline' | 'timeout' | 'network' | 'http' | 'empty';

class SecureResourceFetchError extends Error {
  constructor(readonly kind: SecureResourceFailureKind, readonly status?: number) {
    super(kind);
    this.name = 'SecureResourceFetchError';
  }
}

const SECURE_RESOURCE_TIMEOUT_MS = 60_000;
const SECURE_CIPHER_CACHE_NAME = 'levihan-secure-cipher-v1';
const SECURE_CIPHER_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const SECURE_CIPHER_CACHE_MAX_ENTRIES = 2;
const SECURE_CIPHER_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SECURE_CIPHER_CACHE_TIME_HEADER = 'x-levihan-cached-at';
const SECURE_CIPHER_CACHE_SIZE_HEADER = 'x-levihan-cache-bytes';
const SECURE_COMIC_PASSWORD = 'levihan';

async function readCachedSecureResource(url: string): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SECURE_CIPHER_CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    const cachedAt = Number(response.headers.get(SECURE_CIPHER_CACHE_TIME_HEADER));
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > SECURE_CIPHER_CACHE_MAX_AGE_MS) {
      await cache.delete(url);
      return null;
    }
    const resource = (await response.text()).trim();
    return resource || null;
  } catch {
    return null;
  }
}

async function cacheSecureResource(url: string, response: Response, resourceSize: number): Promise<void> {
  if (typeof caches === 'undefined' || response.status !== 200) return;

  const declaredSize = Number(response.headers.get('content-length'));
  const size = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : resourceSize;
  if (size <= 0 || size > SECURE_CIPHER_CACHE_MAX_BYTES) return;

  try {
    const cache = await caches.open(SECURE_CIPHER_CACHE_NAME);
    const requests = await cache.keys();
    const entries = await Promise.all(requests.map(async (request) => {
      const cached = await cache.match(request);
      return {
        request,
        size: Number(cached?.headers.get(SECURE_CIPHER_CACHE_SIZE_HEADER)) || 0,
        cachedAt: Number(cached?.headers.get(SECURE_CIPHER_CACHE_TIME_HEADER)) || 0,
      };
    }));

    const existingIndex = entries.findIndex((entry) => entry.request.url === url);
    let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
    if (existingIndex >= 0) {
      const [existing] = entries.splice(existingIndex, 1);
      totalBytes -= existing.size;
      await cache.delete(existing.request);
    }

    entries.sort((a, b) => a.cachedAt - b.cachedAt);
    while (
      entries.length >= SECURE_CIPHER_CACHE_MAX_ENTRIES ||
      totalBytes + size > SECURE_CIPHER_CACHE_MAX_BYTES
    ) {
      const oldest = entries.shift();
      if (!oldest) return;
      totalBytes -= oldest.size;
      await cache.delete(oldest.request);
    }

    const headers = new Headers(response.headers);
    headers.set(SECURE_CIPHER_CACHE_TIME_HEADER, String(Date.now()));
    headers.set(SECURE_CIPHER_CACHE_SIZE_HEADER, String(size));
    await cache.put(url, new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }));
  } catch {
    // Storage pressure or private browsing must not block opening the book.
  }
}

async function fetchSecureResource(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SECURE_RESOURCE_TIMEOUT_MS);

  try {
    const cachedResource = await readCachedSecureResource(url);
    if (cachedResource) return cachedResource;
    if (!navigator.onLine) throw new SecureResourceFetchError('offline');
    const response = await fetch(url, {
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new SecureResourceFetchError('http', response.status);

    const cacheableResponse = typeof caches !== 'undefined' && response.status === 200
      ? response.clone()
      : null;
    const resource = (await response.text()).trim();
    if (!resource) throw new SecureResourceFetchError('empty');
    if (cacheableResponse) {
      void cacheSecureResource(url, cacheableResponse, resource.length);
    }
    return resource;
  } catch (error) {
    if (error instanceof SecureResourceFetchError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new SecureResourceFetchError('timeout');
    }
    throw new SecureResourceFetchError('network');
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// PDF.js 绘制会占用主线程和大块位图内存；每个阅读器实例独立排队，
// 关闭阅读器时可以一次性取消旧实例的任务，不让旧漫画继续占用主线程。
type QueuedRender = {
  cancelled: boolean;
  draw: () => Promise<void>;
  priority: () => number;
};

class ComicRenderScheduler {
  private queue: QueuedRender[] = [];
  private active: QueuedRender | null = null;
  private running = false;

  schedule(draw: () => Promise<void>, priority: () => number): () => void {
    const item: QueuedRender = { cancelled: false, draw, priority };
    this.queue.push(item);
    this.pump();
    return () => {
      item.cancelled = true;
      this.queue = this.queue.filter((queued) => queued !== item);
    };
  }

  cancelAll() {
    this.queue.forEach((item) => { item.cancelled = true; });
    this.queue = [];
    if (this.active) this.active.cancelled = true;
  }

  private pump() {
    if (this.running) return;
    this.queue.sort((a, b) => a.priority() - b.priority());
    const item = this.queue.shift();
    if (!item) return;
    this.running = true;
    this.active = item;
    Promise.resolve()
      .then(() => item.cancelled ? undefined : item.draw())
      .catch(() => undefined)
      .finally(() => {
        if (this.active === item) this.active = null;
        this.running = false;
        this.pump();
      });
  }
}

type RenderedCanvasEntry = { lastUsed: number; release: () => boolean };

/** 只保留当前页及邻近页，避免整本漫画的 Canvas 长期占用内存。 */
class ComicCanvasWindow {
  private readonly maxPages = 3;
  private entries = new Map<number, RenderedCanvasEntry>();

  markRendered(pageNumber: number, release: () => boolean) {
    this.entries.set(pageNumber, { lastUsed: performance.now(), release });
    this.evict(pageNumber);
  }

  touch(pageNumber: number) {
    const entry = this.entries.get(pageNumber);
    if (entry) entry.lastUsed = performance.now();
    this.evict(pageNumber);
  }

  remove(pageNumber: number) { this.entries.delete(pageNumber); }

  private evict(currentPage: number) {
    while (this.entries.size > this.maxPages) {
      const candidates = [...this.entries.entries()]
        .filter(([pageNumber]) => pageNumber !== currentPage)
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
      const oldest = candidates[0];
      if (!oldest || !oldest[1].release()) return;
      this.entries.delete(oldest[0]);
    }
  }
}

/** 新上传使用版本化 Key；旧归档仍回退到固定 Key。 */
export const getSecureVaultUrl = (book: DoujinBookItem): string => {
  const secureFile = String(book.secureFile || '').trim();
  const key = /^comic_vault\/[A-Za-z0-9_-]{1,40}_secure\.txt$/i.test(secureFile)
    ? secureFile
    : `${VAULT_DIR}/${String(book.id).replace(/[^A-Za-z0-9_-]/g, '')}_secure.txt`;
  return cosService.getObjectUrl(key);
};

/** PDF 文件头魔数：解出来必须是个 PDF，否则宁可直接失败也不要把乱码喂给 pdf.js */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/* ============================================================================
 * 单页 Canvas：进入滑动窗口才画，离开窗口一段时间后才释放。
 * 快速反向滚动时保留已完成的 Canvas，优先保证 iOS 惯性滚动稳定。
 * ========================================================================== */
const SecureCanvasPage: React.FC<{
  doc: any;
  pageNumber: number;
  aspect: number;
  scheduler: ComicRenderScheduler;
  canvasWindow: ComicCanvasWindow;
}> = ({ doc, pageNumber, aspect, scheduler, canvasWindow }) => {
  const OBSERVER_ROOT_MARGIN = '100% 0px 100% 0px';
  const LEAVE_GRACE_MS = 1800;
  // 移动端惯性滚动会让观察区边缘短暂反复进出，延长保留时间，避免
  // 刚画完就清空，下一帧又从占位重新开始。
  const RELEASE_DELAY_MS = 2600;
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const leaveTimerRef = useRef<number | null>(null);
  const renderedRef = useRef(false);
  const renderingRef = useRef(false);
  const pageRef = useRef<any>(null);
  const visibleRef = useRef(false);
  const releaseRequestedRef = useRef(false);
  const releaseAfterRef = useRef(0);

  const releaseCanvasIfSafe = () => {
    if (visibleRef.current || renderingRef.current || performance.now() < releaseAfterRef.current) {
      releaseRequestedRef.current = true;
      return false;
    }
    const canvas = canvasRef.current;
    if (canvas?.width) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
    try {
      pageRef.current?.cleanup?.();
    } catch {
      /* PDF.js 页面已清理时忽略 */
    }
    pageRef.current = null;
    renderedRef.current = false;
    releaseRequestedRef.current = false;
    canvasWindow.remove(pageNumber);
    setRendered(false);
    return true;
  };

  // 只提前约 1.2 屏开始画，避免一次性创建过多高分辨率 Canvas。
  // 已画好的页面不会因为刚离开范围就被清空；延迟释放形成约前后 2–3 页的滑动窗口。
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
        visibleRef.current = true;
        releaseAfterRef.current = 0;
        releaseRequestedRef.current = false;
        setVisible(true);
        canvasWindow.touch(pageNumber);
        return;
      }
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = window.setTimeout(() => {
        visibleRef.current = false;
        releaseAfterRef.current = performance.now() + RELEASE_DELAY_MS;
        setVisible(false);
      }, LEAVE_GRACE_MS);
    }, { root: null, rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0 });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    };
  }, []);

  useEffect(() => () => {
    canvasWindow.remove(pageNumber);
    releaseCanvasIfSafe();
  }, [canvasWindow, pageNumber]);

  useEffect(() => {
    if (!doc || !visible || renderedRef.current) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    const draw = async () => {
      if (cancelled) return;
      renderingRef.current = true;
      try {
        const page = pageRef.current || await doc.getPage(pageNumber);
        if (cancelled) return;
        pageRef.current = page;
        const baseViewport = page.getViewport({ scale: 1 });
        const displayWidth = Math.min(holderRef.current?.clientWidth || window.innerWidth, baseViewport.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const maxPixels = 4 * 1024 * 1024;
        const desiredScale = (displayWidth * pixelRatio) / baseViewport.width;
        const scale = Math.min(desiredScale, Math.sqrt(maxPixels / (baseViewport.width * baseViewport.height)));
        const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
        if (!cancelled) {
          renderedRef.current = true;
          setRendered(true);
          canvasWindow.markRendered(pageNumber, releaseCanvasIfSafe);
        }
      } catch (err: any) {
        // 渲染被打断（快速滚动、切页、卸载）是常态，不算失败
        if (err && (err.name === 'RenderingCancelledException' || err.name === 'AbortException')) return;
        if (!cancelled) setFailed(true);
      } finally {
        renderingRef.current = false;
        if (releaseRequestedRef.current && !visibleRef.current) releaseCanvasIfSafe();
      }
    };

    const getViewportDistance = () => {
      const element = holderRef.current;
      if (!element) return Number.POSITIVE_INFINITY;
      const rect = element.getBoundingClientRect();
      return Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
    };
    const cancelQueued = scheduler.schedule(draw, getViewportDistance);

    return () => {
      cancelled = true;
      cancelQueued();
      try {
        task?.cancel();
      } catch {
        /* 已结束的渲染任务取消会抛错，忽略 */
      }
    };
  }, [doc, pageNumber, visible]);

  // 只有真正离开滑动窗口一段时间后才释放；快速反向滚动会保留已画好的 Canvas。
  useEffect(() => {
    if (visible) return;
    const canvas = canvasRef.current;
    if (!renderedRef.current && !renderingRef.current && !canvas?.width) return undefined;
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      if (renderingRef.current || visible) return;
      if (canvasRef.current?.width) releaseCanvasIfSafe();
    }, RELEASE_DELAY_MS);
    return () => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    };
  }, [visible]);

  return (
    <div
      ref={holderRef}
      className="relative w-full max-w-3xl mx-auto bg-white shadow-[0_1px_0_rgba(0,0,0,.08)]"
      style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      data-page={pageNumber}
    >
      <div aria-hidden="true" style={{ paddingBottom: `${aspect * 100}%` }} />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center px-4 py-12 text-center font-mono text-xs text-[#8892a4]">
          第 {pageNumber} 页渲染失败，请刷新后重试
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full select-none transition-opacity duration-150 ease-out motion-reduce:transition-none"
          style={{ opacity: rendered ? 1 : 0, WebkitTouchCallout: 'none' }}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
};

export const SecureComicReader: React.FC<SecureComicReaderProps> = ({
  book,
  collectionBooks = [],
  onNavigateCollectionBook,
  onClose,
  onShowToast,
  onCommentCountChange,
  commentPreviewMode = false,
}) => {
  const [phase, setPhase] = useState<Phase>('locked');
  const [workingStage, setWorkingStage] = useState('解析中…');
  const [errorMsg, setErrorMsg] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const [doc, setDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageAspects, setPageAspects] = useState<number[]>([]);
  const autoStartRef = useRef(false);
  const docRef = useRef<any>(null);
  const schedulerRef = useRef<ComicRenderScheduler | null>(null);
  if (!schedulerRef.current) schedulerRef.current = new ComicRenderScheduler();
  const canvasWindowRef = useRef<ComicCanvasWindow | null>(null);
  if (!canvasWindowRef.current) canvasWindowRef.current = new ComicCanvasWindow();
  const readerRef = useRef<HTMLDivElement | null>(null);
  const swipeBack = useSwipeBackGesture(onClose, true);
  const uploaderNote = book.uploaderNote?.trim() || '';
  const hasComicMusic = isComicMusicFile(book.musicFile);
  const renderUploaderNote = () => uploaderNote ? (
    <section className="comic-reader-content relative isolate mb-2 mt-3 overflow-hidden rounded-lg border-[0.5px] border-[var(--amber-6)] bg-[var(--amber-2)] px-3.5 py-3 text-[var(--green-12)]">
      <CardPatternOverlay opacity={0.08} mode="multiply" />
      <h3 className="relative z-10 mb-1 text-xs font-semibold">想说的话</h3>
      <p className="relative z-10 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--amber-12)]">{uploaderNote}</p>
    </section>
  ) : null;

  /* ---------------- 反爬与防手滑：只在阅读器挂载期间生效 ---------------- */
  useEffect(() => {
    const prevContextMenu = document.oncontextmenu;
    const prevDragStart = document.ondragstart;

    document.oncontextmenu = () => false;
    document.ondragstart = () => false;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const blocked =
        k === 'f12' ||
        (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
        (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k)) ||
        ((e.ctrlKey || e.metaKey) && k === 'u') ||
        ((e.ctrlKey || e.metaKey) && k === 's');
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.oncontextmenu = prevContextMenu;
      document.ondragstart = prevDragStart;
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // 组件卸载时销毁 pdf 文档，释放 worker 里的那份数据
  useEffect(
    () => () => {
      schedulerRef.current?.cancelAll();
      try {
        docRef.current?.destroy();
      } catch {
        /* 已销毁则忽略 */
      }
    },
    [],
  );

  /**
   * 打开加密作品后自动拉取密文，并用上传端固定口令解密。
   * 全程在内存里完成，不产生任何 .pdf 文件或直链。
   */
  const handleUnlock = useCallback(
    async () => {
      if (phase === 'working') return;

      setPhase('working');
      setWorkingStage('下载数据中…');
      setErrorMsg('');
      setCanRetry(false);

      try {
        const startedAt = performance.now();
        // ① 从 COS 取回伪装成 .txt 的密文
        const url = getSecureVaultUrl(book);
        const cipherText = await fetchSecureResource(url);
        const downloadedAt = performance.now();

        // ② 解外层 AES-256-CBC（纯内存；解出来就是 PDF 二进制）
        setWorkingStage('解密数据中…');
        const pdfBytes = await decryptOuterLayer(cipherText, SECURE_COMIC_PASSWORD);
        if (!looksLikePdf(pdfBytes)) throw new Error('节点数据无法解析');
        const decryptedAt = performance.now();

        // ③ 解内层 PDF 标准口令：同一个密码直接透传
        setWorkingStage('解析页面中…');
        const task = pdfjsLib.getDocument({ data: pdfBytes, password: SECURE_COMIC_PASSWORD, isEvalSupported: false });
        const loaded = await task.promise;
        const pdfParsedAt = performance.now();
        setWorkingStage('准备页面布局中…');
        const aspects = await Promise.all(
          Array.from({ length: loaded.numPages }, async (_, index) => {
            const page = await loaded.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1 });
            return viewport.height / viewport.width;
          }),
        );
        const readerReadyAt = performance.now();
        console.info('[漫画解析耗时]', {
          bookId: book.id,
          downloadMs: Math.round(downloadedAt - startedAt),
          decryptMs: Math.round(decryptedAt - downloadedAt),
          pdfParseMs: Math.round(pdfParsedAt - decryptedAt),
          pageLayoutMs: Math.round(readerReadyAt - pdfParsedAt),
          totalMs: Math.round(readerReadyAt - startedAt),
        });

        docRef.current = loaded;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPageAspects(aspects);
        setPhase('ready');
        onShowToast?.(`《${book.titleZh}》节点解析完成，共 ${loaded.numPages} 页`);
      } catch (err: any) {
        // 失败文案也保持在"系统页"的语境里，不暴露加密方式与文件类型
        const raw = String(err?.message || err);
        let friendly = '解析失败，请稍后重试。';
        let retryable = false;
        if (err instanceof SecureResourceFetchError) {
          switch (err.kind) {
            case 'offline':
              friendly = '当前设备处于离线状态，连接网络后可重试。';
              retryable = true;
              break;
            case 'timeout':
              friendly = '安全节点响应超时，请检查网络后重试。';
              retryable = true;
              break;
            case 'network':
              friendly = '无法连接安全节点，请检查网络后重试。';
              retryable = true;
              break;
            case 'empty':
              friendly = '安全节点返回空文件，请稍后重试。';
              retryable = true;
              break;
            case 'http':
              if (err.status === 404) {
                friendly = '当前节点未提供该资源，请联系管理员检查文件。';
              } else if (err.status === 401 || err.status === 403) {
                friendly = '安全节点拒绝了此请求。';
              } else if (err.status === 408 || err.status === 429 || (err.status || 0) >= 500) {
                friendly = '安全节点暂时繁忙，请稍后重试。';
                retryable = true;
              } else {
                friendly = '安全节点暂时无法提供此资源。';
              }
              break;
          }
        } else if (/password|校验码|Malformed|不匹配|节点数据无法解析/i.test(raw) || err?.name === 'PasswordException' || err?.name === 'OperationError') {
          friendly = '节点数据无法解析，请联系管理员检查资源。';
        }
        setCanRetry(retryable);
        setErrorMsg(friendly);
        setPhase('locked');
      }
    },
    [book, onShowToast, phase],
  );

  useEffect(() => {
    if (autoStartRef.current) return;
    autoStartRef.current = true;
    void handleUnlock();
  }, [handleUnlock]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const frame = window.requestAnimationFrame(() => {
      readerRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  /* ========================== 自动解析弹窗 ========================== */
  if (phase !== 'ready') {
    return (
      <SecureComicLoadingDialog
        title={`正在解析《${book.titleZh}》`}
        message={workingStage}
        error={errorMsg || undefined}
        canRetry={canRetry}
        onRetry={() => void handleUnlock()}
        onClose={onClose}
      />
    );
  }

  /* ========================== 解析成功后的阅读容器 ========================== */
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div
      id="secure-doujin-reader"
      ref={readerRef}
      className="comic-paper-surface w-full scroll-mt-3 pb-28 select-none"
      style={{ ...swipeBack.style, '--comic-reader-content-width': '48rem' } as React.CSSProperties}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={swipeBack.onTouchStart}
      onTouchMove={swipeBack.onTouchMove}
      onTouchEnd={swipeBack.onTouchEnd}
      onTouchCancel={swipeBack.onTouchCancel}
    >
      <CollectionNavigationBar
        books={collectionBooks}
        currentBookId={book.id}
        onNavigate={(nextBook) => onNavigateCollectionBook?.(nextBook)}
        frameClassName="max-w-3xl"
      />
      <ComicReaderHeader book={book} onClose={onClose} hasReaderIntro={Boolean(uploaderNote) || hasComicMusic} />
      {renderUploaderNote()}
      {hasComicMusic && (
        <ComicMusicPlayer title={book.musicTitle || book.titleZh} />
      )}

      <div className="pt-3 space-y-3">
        {pages.map((n) => (
          <SecureCanvasPage
            key={n}
            doc={doc}
            pageNumber={n}
            aspect={pageAspects[n - 1] || 1.4}
            scheduler={schedulerRef.current!}
            canvasWindow={canvasWindowRef.current!}
          />
        ))}
      </div>

      <CollectionFooterNavigation
        books={collectionBooks}
        currentBookId={book.id}
        onNavigate={(nextBook) => onNavigateCollectionBook?.(nextBook)}
        frameClassName="max-w-3xl"
        className="comic-navigation-before-comments"
      />

      <MangaCommentSection
        bookId={book.id}
        bookTitle={book.titleZh}
        onShowToast={onShowToast || (() => {})}
        onCommentCountChange={onCommentCountChange}
        previewMode={commentPreviewMode}
      />
    </div>
  );
};

export default SecureComicReader;
