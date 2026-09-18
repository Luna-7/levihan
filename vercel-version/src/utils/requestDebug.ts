/**
 * 开发期请求诊断工具
 * 只在开发环境启用，用于统计网络请求行为
 */

interface RequestStats {
  imagesRequested: number;
  imagesLoaded: number;
  imagesFailed: number;
  duplicateRequests: number;
  maxConcurrentImages: number;
  jsonRequests: number;
  requestedUrls: Set<string>;
}

class RequestDebug {
  private stats: RequestStats = {
    imagesRequested: 0,
    imagesLoaded: 0,
    imagesFailed: 0,
    duplicateRequests: 0,
    maxConcurrentImages: 0,
    jsonRequests: 0,
    requestedUrls: new Set(),
  };

  private currentConcurrentImages = 0;

  constructor() {
    if (import.meta.env.DEV) {
      this.initConsoleLogging();
    }
  }

  private initConsoleLogging() {
    // 每 5 秒输出一次统计信息
    setInterval(() => {
      this.logStats();
    }, 5000);
  }

  private logStats() {
    if (!import.meta.env.DEV) return;

    console.log('[Levihan Traffic]', {
      imagesRequested: this.stats.imagesRequested,
      imagesLoaded: this.stats.imagesLoaded,
      imagesFailed: this.stats.imagesFailed,
      duplicateRequests: this.stats.duplicateRequests,
      maxConcurrentImages: this.stats.maxConcurrentImages,
      jsonRequests: this.stats.jsonRequests,
      currentConcurrentImages: this.currentConcurrentImages,
    });
  }

  recordImageRequest(url: string): void {
    if (!import.meta.env.DEV) return;

    this.stats.imagesRequested++;
    this.currentConcurrentImages++;
    this.stats.maxConcurrentImages = Math.max(
      this.stats.maxConcurrentImages,
      this.currentConcurrentImages
    );

    if (this.stats.requestedUrls.has(url)) {
      this.stats.duplicateRequests++;
    } else {
      this.stats.requestedUrls.add(url);
    }
  }

  recordImageLoad(): void {
    if (!import.meta.env.DEV) return;

    this.stats.imagesLoaded++;
    this.currentConcurrentImages--;
  }

  recordImageError(): void {
    if (!import.meta.env.DEV) return;

    this.stats.imagesFailed++;
    this.currentConcurrentImages--;
  }

  recordJsonRequest(): void {
    if (!import.meta.env.DEV) return;

    this.stats.jsonRequests++;
  }

  getStats(): RequestStats {
    return { ...this.stats, requestedUrls: new Set(this.stats.requestedUrls) };
  }

  reset(): void {
    this.stats = {
      imagesRequested: 0,
      imagesLoaded: 0,
      imagesFailed: 0,
      duplicateRequests: 0,
      maxConcurrentImages: 0,
      jsonRequests: 0,
      requestedUrls: new Set(),
    };
    this.currentConcurrentImages = 0;
  }
}

export const requestDebug = new RequestDebug();
