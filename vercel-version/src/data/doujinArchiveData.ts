import { DoujinBookItem } from '../types/doujinArchive';

/**
 * 腾讯云 COS 存储桶配置与 CDN 链接映射（原 Cloudflare R2 已迁移至腾讯云 COS）
 *
 * 腾讯云 COS S3 兼容 API：https://cos.<region>.myqcloud.com
 *
 * 存储规则（与旧桶保持一致）：
 * 1. 文件名与目录格式：lh-001/
 * 2. 封面默认为：image01.webp（即 lh-001/image01.webp）
 * 3. 内页无缝长图为：image01.webp, image02.webp, image03.webp ... image30.webp
 */
export const TENCENT_COS_CONFIG = {
  // COS 地域：南京
  region: 'ap-nanjing',
  // S3 兼容端点（跟随 region 变化）
  s3ApiEndpoint: 'https://cos.ap-nanjing.myqcloud.com',
  // 桶名（含 APPID 后缀）
  bucketName: 'levihan-1325571558',
  // 公开访问域名（COS 静态网站端点）
  cdnBaseUrl: 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com',
};

/**
 * 辅助方法：生成腾讯云 COS 封面图直链
 * 规则：若已传完整 URL 则直接使用；否则映射为 {cdnBaseUrl}/{bookFolder}/{coverFile || 'image01.webp'}
 */
export const getCosCoverUrl = (book: DoujinBookItem, customCdnUrl?: string): string => {
  const base = (customCdnUrl || TENCENT_COS_CONFIG.cdnBaseUrl).replace(/\/$/, '');
  const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
  const coverFileName = book.coverFile || 'image01.webp';

  if (coverFileName.startsWith('http://') || coverFileName.startsWith('https://')) {
    return coverFileName;
  }

  return `${base}/${folder}/${coverFileName.replace(/^\//, '')}`;
};

/**
 * 辅助方法：生成书籍某一页在 COS 中的直链（用于无缝长图阅读）
 * 自动按照您的 image01.webp, image02.webp ... 规则生成
 */
export const getCosPageUrl = (
  book: DoujinBookItem,
  pageIndex: number, // 从 1 开始
  customCdnUrl?: string
): string => {
  const base = (customCdnUrl || TENCENT_COS_CONFIG.cdnBaseUrl).replace(/\/$/, '');
  const folder = (book.bookFolder || book.id).replace(/^\/|\/$/g, '');
  const actualName = book.pageFiles?.[pageIndex - 1];
  if (actualName) return `${base}/${folder}/${actualName.replace(/^\//, '')}`;
  const prefix = book.pagePrefix ?? 'image';
  const padDigits = book.pagePadDigits ?? 2;
  const pageNumStr = pageIndex.toString().padStart(padDigits, '0');
  const ext = book.coverFile?.match(/\.(webp|jpe?g|png|gif|avif)$/i)?.[1] || 'webp';

  return `${base}/${folder}/${prefix}${pageNumStr}.${ext}`;
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
