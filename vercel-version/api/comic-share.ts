import type { IncomingMessage, ServerResponse } from 'node:http';

type ArchiveBook = {
  id?: unknown;
  titleZh?: unknown;
  circle?: unknown;
  pages?: unknown;
  bookFolder?: unknown;
  coverFile?: unknown;
};

const ARCHIVE_URL = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com/archive.json';
const CDN_ROOT = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getQueryId = (request: IncomingMessage): string => {
  const url = new URL(request.url || '/', 'https://localhost');
  const id = url.searchParams.get('id') || '';
  return /^lh-\d{1,6}$/.test(id) ? id : '';
};

const getCoverUrl = (book: ArchiveBook): string => {
  const cover = String(book.coverFile || 'image01.webp');
  if (/^https?:\/\//i.test(cover)) return cover;
  const folder = String(book.bookFolder || book.id || '').replace(/^\/+|\/+$/g, '');
  return `${CDN_ROOT}/${encodeURIComponent(folder)}/${cover.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
};

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const id = getQueryId(request);
  if (!id) {
    response.statusCode = 400;
    response.end('Invalid book id');
    return;
  }

  let book: ArchiveBook | undefined;
  try {
    const archiveResponse = await fetch(ARCHIVE_URL, { cache: 'no-store' });
    if (archiveResponse.ok) {
      const archive = await archiveResponse.json() as ArchiveBook[];
      if (Array.isArray(archive)) book = archive.find((item) => item?.id === id);
    }
  } catch {
    // 分享页仍返回可点击链接；上游短暂失败时只退化为通用卡片。
  }

  const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '');
  const forwardedProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : 'https://levihan.asia';
  const target = `${origin}/?book=${encodeURIComponent(id)}`;
  const title = book ? `《${String(book.titleZh || id)}》` : '利韩典藏';
  const description = book
    ? `作者：${String(book.circle || '未知')} · ${Number(book.pages) || 0} 页 · 利韩典藏`
    : '利韩典藏漫画本';
  const image = book ? getCoverUrl(book) : `${origin}/image.png`;

  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:url" content="${escapeHtml(target)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <link rel="canonical" href="${escapeHtml(target)}">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
</head>
<body><p><a href="${escapeHtml(target)}">打开${escapeHtml(title)}</a></p></body>
</html>`);
}
