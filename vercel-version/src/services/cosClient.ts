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

  /**
   * 加载在线小说索引（novels.json，只含元数据不含正文）。读不到 → 空数组
   */
  public async loadNovelList(): Promise<GroupNovel[]> {
    if (!this.config.cdnBaseUrl) return [];
    try {
      requestDebug.recordJsonRequest();
      const resp = await fetch(this.getObjectUrl('novels.json'), { mode: 'cors', cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) return data;
      }
    } catch (e) {
      // 在线小说缺失时优雅降级
    }
    return [];
  }

  /** 在线小说正文直链（novels/{id}.txt，点开卡片时才加载） */
  public getNovelBodyUrl(id: string): string {
    return this.getObjectUrl(`novels/${id}.txt`);
  }

  /**
   * 动态加载远程归档数据：
   * 1. 尝试从 COS 根目录读取 archive.json 或 books.json
   * 2. 若无则从本地默认 Excel 统计数据加载
   */
  public async loadArchiveData(): Promise<DoujinBookItem[]> {
    if (!this.config.cdnBaseUrl) {
      // 尚未配置新桶公开域名时，直接走本地兜底数据
      return DOUJIN_ARCHIVE_DATA;
    }
    const remoteUrl = this.getObjectUrl('archive.json');
    try {
      requestDebug.recordJsonRequest();
      const resp = await fetch(remoteUrl, { mode: 'cors', cache: 'default' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log('[COSService] Successfully fetched remote archive.json:', data.length, 'books');
          return data;
        }
      }
    } catch (e) {
      // 远端暂无 archive.json 时，优雅使用本地录入的本子数据
    }
    return DOUJIN_ARCHIVE_DATA;
  }

  /**
   * 「周边橱窗」清单（goods/manifest.json）。读不到 → 空数组（区块显示「还没上货」）。
   * 加图不改代码：把 PNG 丢进本地 goods-src/，跑一次 npm run sync:goods 即可上架。
   */
  public async loadGoodsList(): Promise<GoodsItem[]> {
    if (!this.config.cdnBaseUrl) return [];
    try {
      requestDebug.recordJsonRequest();
      const resp = await fetch(this.getObjectUrl('goods/manifest.json'), {
        mode: 'cors',
        cache: 'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        const list = Array.isArray(data) ? data : data?.items;
        if (Array.isArray(list)) {
          return list.filter(
            (it: Partial<GoodsItem> | null): it is GoodsItem =>
              Boolean(it && typeof it.file === 'string' && it.file),
          );
        }
      }
    } catch (e) {
      // 清单缺失时优雅降级为空橱窗
    }
    return [];
  }

  /** 周边原图直链（「下载」和「看原图」用它；桶已配 CORS + Content-Disposition: attachment） */
  public getGoodsOriginalUrl(file: string): string {
    return this.getObjectUrl(`goods/${file.replace(/^\//, '')}`);
  }

  /**
   * 周边展示图直链：**同一张原图由 COS 现场缩放**，不需要额外存一份缩略图。
   * 实测 115 KB 的原图取 360px 只要 34 KB —— 列表只加载它，原图留给「下载」。
   */
  public getGoodsImageUrl(file: string, width: number, quality = 82): string {
    return `${this.getGoodsOriginalUrl(file)}?imageMogr2/thumbnail/${width}x/format/webp/quality/${quality}`;
  }

  /** 列表缩略图（420px，列表里每张只花几十 KB） */
  public getGoodsThumbUrl(file: string, width = 420): string {
    return this.getGoodsImageUrl(file, width, 80);
  }

  /** 灯箱预览（1600px，够看清细节但不是原图） */
  public getGoodsPreviewUrl(file: string, width = 1600): string {
    return this.getGoodsImageUrl(file, width, 88);
  }
}

export const cosService = new COSService();
