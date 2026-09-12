import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { DoujinBookItem } from '../types/doujinArchive';
import { DOUJIN_ARCHIVE_DATA, CLOUDFLARE_R2_CONFIG } from '../data/doujinArchiveData';

export interface R2ConfigState {
  accountId: string;
  s3ApiEndpoint: string;
  bucketName: string;
  cdnBaseUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const STORAGE_KEY = 'lh_r2_custom_config_v1';

export const getStoredR2Config = (): R2ConfigState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...CLOUDFLARE_R2_CONFIG,
        ...parsed,
      };
    }
  } catch (e) {
    console.warn('Failed to parse stored R2 config:', e);
  }
  return {
    ...CLOUDFLARE_R2_CONFIG,
    accessKeyId: '',
    secretAccessKey: '',
  };
};

export const saveStoredR2Config = (config: Partial<R2ConfigState>) => {
  const current = getStoredR2Config();
  const next = { ...current, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
};

/**
 * Cloudflare R2 S3 逻辑层管理器
 */
export class R2Service {
  private config: R2ConfigState;
  private s3Client: S3Client | null = null;

  constructor() {
    this.config = getStoredR2Config();
    this.initS3Client();
  }

  public updateConfig(partial: Partial<R2ConfigState>) {
    this.config = saveStoredR2Config(partial);
    this.initS3Client();
  }

  public getConfig(): R2ConfigState {
    return { ...this.config };
  }

  private initS3Client() {
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      try {
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint: this.config.s3ApiEndpoint,
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
        });
      } catch (err) {
        console.error('Failed to initialize AWS S3 Client for R2:', err);
        this.s3Client = null;
      }
    } else {
      this.s3Client = null;
    }
  }

  public hasS3Credentials(): boolean {
    return Boolean(this.config.accessKeyId && this.config.secretAccessKey && this.s3Client);
  }

  /**
   * 生成规范的 R2 资源访问 URL (默认使用公开 CDN / S3 直链)
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
    const prefix = book.pagePrefix ?? 'image';
    const padDigits = book.pagePadDigits ?? 2;
    const pageNumStr = pageIndex.toString().padStart(padDigits, '0');
    return this.getObjectUrl(`${folder}/${prefix}${pageNumStr}.webp`);
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
   */
  public async detectBookPages(book: DoujinBookItem, maxProbe = 100): Promise<number> {
    const detected: number[] = [];
    const concurrency = 6;
    let stop = false;

    for (let i = 1; i <= maxProbe && !stop; i += concurrency) {
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
        } else {
          stop = true;
          break;
        }
      }
    }

    return detected.length > 0 ? Math.max(...detected) : book.pages || 10;
  }

  /**
   * 若配置了 S3 API Key，调用 AWS SDK 的 ListObjectsV2Command 动态扫描 R2 存储桶文件
   */
  public async listS3Objects(prefix = 'lh-'): Promise<string[]> {
    if (!this.s3Client) {
      throw new Error('未配置 Cloudflare R2 S3 凭据 (AccessKeyId / SecretAccessKey)');
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        MaxKeys: 100,
      });

      const response = await this.s3Client.send(command);
      return (response.Contents || []).map((item) => item.Key || '').filter(Boolean);
    } catch (err) {
      console.error('S3 ListObjectsV2 error:', err);
      throw err;
    }
  }

  /**
   * 动态加载远程归档数据：
   * 1. 尝试从 R2 根目录读取 archive.json 或 books.json
   * 2. 若无则从本地默认 Excel 统计数据加载
   */
  public async loadArchiveData(): Promise<DoujinBookItem[]> {
    const remoteUrl = this.getObjectUrl('archive.json');
    try {
      const resp = await fetch(remoteUrl, { mode: 'cors', cache: 'no-cache' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log('[R2Service] Successfully fetched remote archive.json:', data.length, 'books');
          return data;
        }
      }
    } catch (e) {
      // 远端暂无 archive.json 时，优雅使用本地录入的本子数据
    }
    return DOUJIN_ARCHIVE_DATA;
  }
}

export const r2Service = new R2Service();
