import { DoujinBookItem } from '../types/doujinArchive';

/**
 * Cloudflare R2 存储桶配置与 CDN 链接映射
 * 
 * 账户 ID: a0c9d308416fd43fed5546a5c7d444c4
 * S3 API: https://a0c9d308416fd43fed5546a5c7d444c4.r2.cloudflarestorage.com
 * 
 * 您的实际存储规则：
 * 1. 文件名与目录格式：lh-001/
 * 2. 封面默认为：image01.webp（即 lh-001/image01.webp）
 * 3. 内页无缝长图为：image01.webp, image02.webp, image03.webp ... image30.webp
 */
export const CLOUDFLARE_R2_CONFIG = {
  accountId: 'a0c9d308416fd43fed5546a5c7d444c4',
  s3ApiEndpoint: 'https://a0c9d308416fd43fed5546a5c7d444c4.r2.cloudflarestorage.com',
  bucketName: 'doujin-archive',
  // 公开 CDN 访问域名（开启 R2 Public Bucket 获得的公开域名）
  cdnBaseUrl: 'https://pub-a0c9d308416fd43fed5546a5c7d444c4.r2.dev',
};

/**
 * 辅助方法：生成 Cloudflare R2 封面图 CDN 直链
 * 规则：若已传完整 URL 则直接使用；否则映射为 {cdnBaseUrl}/{bookFolder}/{coverFile || 'image01.webp'}
 */
export const getR2CoverUrl = (book: DoujinBookItem, customCdnUrl?: string): string => {
  const base = (customCdnUrl || CLOUDFLARE_R2_CONFIG.cdnBaseUrl).replace(/\/$/, '');
  const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
  const coverFileName = book.coverFile || 'image01.webp';

  if (coverFileName.startsWith('http://') || coverFileName.startsWith('https://')) {
    return coverFileName;
  }

  return `${base}/${folder}/${coverFileName.replace(/^\//, '')}`;
};

/**
 * 辅助方法：生成书籍某一页在 Cloudflare R2 CDN 中的直链（用于无缝长图阅读）
 * 自动按照您的 image01.webp, image02.webp ... 规则生成
 */
export const getR2PageUrl = (
  book: DoujinBookItem,
  pageIndex: number, // 从 1 开始
  customCdnUrl?: string
): string => {
  const base = (customCdnUrl || CLOUDFLARE_R2_CONFIG.cdnBaseUrl).replace(/\/$/, '');
  const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
  const prefix = book.pagePrefix ?? 'image';
  const padDigits = book.pagePadDigits ?? 2;
  const pageNumStr = pageIndex.toString().padStart(padDigits, '0');
  
  return `${base}/${folder}/${prefix}${pageNumStr}.webp`;
};

/**
 * 按照您 Excel 表格统计的数据录入
 * ID编号	本子名	作者	总页数	加入标签	来源	汉化	嵌字
 * lh-001	春	未知	30	自设世界观,现代,含R18	塔比欧卡	LG	LG
 */
export const DOUJIN_ARCHIVE_DATA: DoujinBookItem[] = [
  {
    id: 'lh-001',
    titleZh: '春',
    circle: '未知',
    pages: 30,
    tags: ['自设世界观', '现代', '含R18'],
    source: '塔比欧卡',
    translator: 'LG',
    typesetter: 'LG',
    category: '漫画本',
    coverFile: 'image01.webp',
    bookFolder: 'lh-001',
    pagePrefix: 'image',
    pagePadDigits: 2,
  },
];
