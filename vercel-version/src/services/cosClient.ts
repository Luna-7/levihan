import { DoujinBookItem, GroupNovel } from '../types/doujinArchive';
import { GoodsItem } from '../types';
import { DOUJIN_ARCHIVE_DATA, TENCENT_COS_CONFIG } from '../data/doujinArchiveData';
import { requestDebug } from '../utils/requestDebug';

export interface COSConfigState {
  region: string;
  s3ApiEndpoint: string;
  bucketName: string;
  cdnBaseUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const STORAGE_KEY = 'lh_cos_custom_config_v1';
const GOODS_MANIFEST_URL = '/goods/manifest.json';
const GOODS_THUMB_BASE = '/goods/thumbs';
const GOODS_PREVIEW_BASE = '/goods/previews';
const REMOTE_CACHE_TTL_MS = 5 * 60 * 1000;
// 旧 Cloudflare R2 配置的本地存储键，迁移时清理
const LEGACY_R2_STORAGE_KEY = 'lh_r2_custom_config_v1';

export const getStoredCOSConfig = (): COSConfigState => {
  try {
    // 清理旧 R2 配置残留
    localStorage.removeItem(LEGACY_R2_STORAGE_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...TENCENT_COS_CONFIG,
        ...parsed,
      };
    }
  } catch (e) {
    console.warn('Failed to parse stored COS config:', e);
  }
  return {
    ...TENCENT_COS_CONFIG,
    accessKeyId: '',
    secretAccessKey: '',
  };
};

export const saveStoredCOSConfig = (config: Partial<COSConfigState>) => {
  const current = getStoredCOSConfig();
  const next = { ...current, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
};

/**
 * 腾讯云 COS S3 兼容逻辑层管理器
 */
export class COSService {
  private config: COSConfigState;

  constructor() {
    this.config = getStoredCOSConfig();
  }

  public updateConfig(partial: Partial<COSConfigState>) {
    this.config = saveStoredCOSConfig(partial);
  }

  public getConfig(): COSConfigState {
    return { ...this.config };
  }

  public hasS3Credentials(): boolean {
    return Boolean(this.config.accessKeyId && this.config.secretAccessKey && this.config.s3ApiEndpoint);
  }

  /**
   * 生成规范的 COS 资源访问 URL (使用公开访问域名 / CDN 直链)
   */
  public getObjectUrl(key: string): string {
    const cleanKey = key.replace(/^\//, '');
    const base = this.config.cdnBaseUrl.replace(/\/$/, '');
    return `${base}/${cleanKey}`;
  }

  /**
   * 获取某本书的封面 URL
   */
  public getCoverUrl(book: DoujinBookItem): string {
    const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
    const coverName = book.coverFile || 'image01.webp';
    if (coverName.startsWith('http://') || coverName.startsWith('https://')) {
      return coverName;
    }
    return this.getObjectUrl(`${folder}/${coverName.replace(/^\//, '')}`);
  }

  /**
   * 获取某本书指定页码的无缝长图 URL
   */
  public getPageUrl(book: DoujinBookItem, pageIndex: number): string {
    const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
    const actualName = book.pageFiles?.[pageIndex - 1];
    if (actualName) return this.getObjectUrl(`${folder}/${actualName.replace(/^\//, '')}`);
    const prefix = book.pagePrefix ?? 'image';
    const padDigits = book.pagePadDigits ?? 2;
    const pageNumStr = pageIndex.toString().padStart(padDigits, '0');
    const ext = book.coverFile?.match(/\.(webp|jpe?g|png|gif|avif)$/i)?.[1] || 'webp';
    return this.getObjectUrl(`${folder}/${prefix}${pageNumStr}.${ext}`);
  }

  /**
   * 探测特定 URL 资源是否存在 (使用轻量 HEAD/GET 请求)
   */
  public async probeResource(url: string): Promise<{ ok: boolean; status: number; contentType?: string }> {
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
      return {
        ok: resp.ok,
        status: resp.status,
        contentType: resp.headers.get('content-type') || undefined,
      };
    } catch (e) {
      // 某些 CDN 对 HEAD 方法做限制，降级尝试 GET (仅获取前几字节)
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          mode: 'cors',
        });
        return {
          ok: resp.ok || resp.status === 206,
          status: resp.status,
          contentType: resp.headers.get('content-type') || undefined,
        };
      } catch (err2) {
        return { ok: false, status: 0 };
      }
    }
  }

  /**
   * 自动探测 lh-XXX 目录下的真实页数与图片存在性
   * 限制并发数为 2，遇到连续 3 页缺失才认为到达结尾
   */
  public async detectBookPages(book: DoujinBookItem, maxProbe = 100): Promise<number> {
    const detected: number[] = [];
    const concurrency = 2;
    let consecutiveMissing = 0;
    const MAX_CONSECUTIVE_MISSING = 3;

    for (let i = 1; i <= maxProbe; i += concurrency) {
      const chunk = Array.from({ length: Math.min(concurrency, maxProbe - i + 1) }, (_, idx) => i + idx);
      const results = await Promise.all(
        chunk.map(async (pageIdx) => {
          const url = this.getPageUrl(book, pageIdx);
          const probe = await this.probeResource(url);
          return { pageIdx, ok: probe.ok };
        })
      );

      for (const res of results) {
        if (res.ok) {
          detected.push(res.pageIdx);
          consecutiveMissing = 0;
        } else {
          consecutiveMissing++;
          if (consecutiveMissing >= MAX_CONSECUTIVE_MISSING) {
            // 连续 3 页缺失，认为到达结尾
            return detected.length > 0 ? Math.max(...detected) : book.pages || 10;
          }
        }
      }
    }

    return detected.length > 0 ? Math.max(...detected) : book.pages || 10;
  }

  /**
   * 若配置了 S3 API 密钥，调用 AWS SDK 的 ListObjectsV2Command 动态扫描 COS 存储桶文件
   * （腾讯云 COS 兼容 S3 API，密钥为 COS 的 SecretId / SecretKey）
   */
  public async listS3Objects(prefix = 'lh-'): Promise<string[]> {
    if (!this.hasS3Credentials()) {
      throw new Error('未配置腾讯云 COS S3 密钥 (SecretId / SecretKey)');
    }

    try {
      // Public archive reads never load the S3 SDK.
      const { scanCosObjects } = await import('./cosS3Scanner');
      return scanCosObjects(this.config, prefix);
    } catch (err) {
      console.error('S3 ListObjectsV2 error:', err);
      throw err;
    }
  }

  private cachedNovelList: GroupNovel[] | null = null;
  private novelFetchPromise: Promise<GroupNovel[]> | null = null;
  private novelFetchedAt = 0;
  private cachedArchive: DoujinBookItem[] | null = null;
  private archiveFetchPromise: Promise<DoujinBookItem[]> | null = null;
  private archiveFetchedAt = 0;
  private cachedGoods: GoodsItem[] | null = null;
  private goodsFetchPromise: Promise<GoodsItem[]> | null = null;
  private goodsFetchedAt = 0;

  /**
   * 同步获取内存或本地持久化缓存的在线小说列表（用于首屏/切页瞬时直出，杜绝加载闪烁）
   */
  public getCachedNovelList(): GroupNovel[] {
    if (this.cachedNovelList && this.cachedNovelList.length > 0) {
      return this.cachedNovelList;
    }
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('lh_cached_novels_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.cachedNovelList = parsed;
            return parsed;
          }
        }
      } catch {}
    }
    return [];
  }

  public hasCachedNovelList(): boolean {
    return (this.cachedNovelList !== null && this.cachedNovelList.length > 0) || (
      typeof window !== 'undefined' && Boolean(localStorage.getItem('lh_cached_novels_v1'))
    );
  }

  public clearNovelCache(): void {
    this.cachedNovelList = null;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('lh_cached_novels_v1');
      } catch {}
    }
  }

  /**
   * 加载在线小说索引（novels.json，只含元数据不含正文）。SWR 策略优先返回缓存，后台静默拉取
   */
  public async loadNovelList(forceRefresh = false): Promise<GroupNovel[]> {
    const cached = this.getCachedNovelList();
    if (!this.config.cdnBaseUrl) return cached;

    if (!forceRefresh && cached.length > 0 && Date.now() - this.novelFetchedAt < REMOTE_CACHE_TTL_MS) {
      return cached;
    }

    // 非强制刷新且已有缓存：先秒回缓存，并在后台静默拉取更新
    if (!forceRefresh && cached.length > 0) {
      void this.fetchNovelListFromRemote();
      return cached;
    }

    return this.fetchNovelListFromRemote();
  }

  private async fetchNovelListFromRemote(): Promise<GroupNovel[]> {
    if (this.novelFetchPromise) return this.novelFetchPromise;
    this.novelFetchPromise = (async () => {
      try {
        requestDebug.recordJsonRequest();
        const resp = await fetch(this.getObjectUrl('novels.json'), { mode: 'cors', cache: 'default' });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            this.cachedNovelList = data;
            this.novelFetchedAt = Date.now();
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('lh_cached_novels_v1', JSON.stringify(data));
              } catch {}
            }
            return data;
          }
        }
      } catch (e) {
        // 在线小说缺失时优雅降级
      } finally {
        this.novelFetchPromise = null;
      }
      return this.getCachedNovelList();
    })();
    return this.novelFetchPromise;
  }

  /** 在线小说正文直链（novels/{id}.txt，点开卡片时才加载） */
  public getNovelBodyUrl(id: string): string {
    return this.getObjectUrl(`novels/${id}.txt`);
  }

  /**
   * 动态加载 COS 归档数据，失败时使用本地默认数据。
   */
  public async loadArchiveData(): Promise<DoujinBookItem[]> {
    if (!this.config.cdnBaseUrl) {
      // 尚未配置新桶公开域名时，直接走本地兜底数据
      return DOUJIN_ARCHIVE_DATA;
    }
    if (this.cachedArchive && Date.now() - this.archiveFetchedAt < REMOTE_CACHE_TTL_MS) {
      return this.cachedArchive;
    }
    if (this.archiveFetchPromise) return this.archiveFetchPromise;

    this.archiveFetchPromise = (async () => {
      try {
        requestDebug.recordJsonRequest();
        const resp = await fetch(this.getObjectUrl('archive.json'), { mode: 'cors', cache: 'default' });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            console.log('[COSService] Loaded COS archive.json:', data.length, 'books');
            this.cachedArchive = data;
            this.archiveFetchedAt = Date.now();
            return data;
          }
        }
      } catch {
        // COS 不可用时使用本地兜底数据。
      }
      return this.cachedArchive || DOUJIN_ARCHIVE_DATA;
    })();
    try {
      return await this.archiveFetchPromise;
    } finally {
      this.archiveFetchPromise = null;
    }
  }

  /**
   * 「周边素材」清单（goods/manifest.json）。读不到 → 空数组（区块显示空状态）。
   * 加图不改代码：把 PNG 丢进本地 goods-src/，跑一次 npm run sync:goods 即可上架。
   */
  public async loadGoodsList(): Promise<GoodsItem[]> {
    if (!this.config.cdnBaseUrl) return [];
    if (this.cachedGoods && Date.now() - this.goodsFetchedAt < REMOTE_CACHE_TTL_MS) {
      return this.cachedGoods;
    }
    if (this.goodsFetchPromise) return this.goodsFetchPromise;

    this.goodsFetchPromise = (async () => {
    try {
      requestDebug.recordJsonRequest();
      // 清单和缩略图随 Vercel 部署，列表页不再访问 COS。
      const resp = await fetch(GOODS_MANIFEST_URL, { cache: 'default' });
      if (resp.ok) {
        const data = await resp.json();
        const list = Array.isArray(data) ? data : data?.items;
        if (Array.isArray(list)) {
          const result = list.filter(
            (it: Partial<GoodsItem> | null): it is GoodsItem =>
              Boolean(it && typeof it.file === 'string' && it.file && it.visible !== false),
          ).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
          this.cachedGoods = result;
          this.goodsFetchedAt = Date.now();
          return result;
        }
      }
    } catch (e) {
      // 清单缺失时优雅降级为空橱窗
    }
    return this.cachedGoods || [];
    })();
    try {
      return await this.goodsFetchPromise;
    } finally {
      this.goodsFetchPromise = null;
    }
  }

  /** 私有 COS 原图地址，仅供服务端签名下载流程使用，前端不要直接渲染。 */
  public getGoodsOriginalUrl(file: string): string {
    return this.getObjectUrl(`goods/${file.replace(/^\//, '')}`);
  }

  /** 兼容旧调用的 COS 图片处理地址；列表和灯箱已经使用预生成静态图。 */
  public getGoodsImageUrl(file: string, width: number, quality = 82): string {
    const ops =
      width > 0
        ? `thumbnail/${width}x/format/webp/quality/${quality}`
        : `format/webp/quality/${quality}`;
    return `${this.getGoodsOriginalUrl(file)}?imageMogr2/${ops}`;
  }

  /** 列表缩略图（420px，列表里每张只花几十 KB） */
  public getGoodsThumbUrl(file: string, width = 420): string {
    // 列表缩略图已经随 Vercel 发布，避免每张卡片都回源 COS。
    const stem = file.replace(/^\//, '').replace(/\.[^.]+$/, '');
    return `${GOODS_THUMB_BASE}/${encodeURIComponent(stem)}.jpg`;
  }

  /** 灯箱预览（1600px，够看清细节但不是原图） */
  public getGoodsPreviewUrl(file: string, width = 1600): string {
    const stem = file.replace(/^\//, '').replace(/\.[^.]+$/, '');
    return `${GOODS_PREVIEW_BASE}/${encodeURIComponent(stem)}.jpg`;
  }
}

export const cosService = new COSService();
