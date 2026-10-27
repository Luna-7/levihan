import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(subscription: any, payload: string, options: { TTL: number }): Promise<unknown>;
};

type JsonRecord = Record<string, any>;
interface AdminRequest extends IncomingMessage {
  body?: string | JsonRecord;
}

const ADMIN_ORIGIN = 'https://admin.levihan.asia';
const BUCKET = process.env.COS_BUCKET || 'levihan-1325571558';
const REGION = process.env.COS_REGION || 'ap-nanjing';
const APP_ID = process.env.COS_APP_ID || BUCKET.match(/-(\d+)$/)?.[1] || '';
const CDN = `https://${BUCKET}.cos-website.${REGION}.myqcloud.com`;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const PUSH_SUBSCRIPTIONS_KEY = 'push-subscriptions.json';
const PUBLIC_ACTIONS = new Set(['status', 'login', 'pushSubscribe', 'pushUnsubscribe']);
const PUSH_SEND_TIMEOUT_MS = 2500;
export const config = { api: { bodyParser: false } };
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

function sendJson(response: ServerResponse, status: number, body: object) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.end(JSON.stringify(body));
}

async function readPayload(request: AdminRequest): Promise<JsonRecord> {
  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > MAX_BODY_BYTES) throw fail('请求内容过大', 413);
    try { return JSON.parse(request.body.toString('utf8')); }
    catch { throw fail('请求内容不是有效 JSON'); }
  }
  if (typeof request.body === 'string') {
    if (Buffer.byteLength(request.body, 'utf8') > MAX_BODY_BYTES) throw fail('请求内容过大', 413);
    try { return JSON.parse(request.body); }
    catch { throw fail('请求内容不是有效 JSON'); }
  }
  if (request.body && typeof request.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(request.body), 'utf8') > MAX_BODY_BYTES) throw fail('请求内容过大', 413);
    return request.body;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY_BYTES) throw fail('请求内容过大', 413);
    chunks.push(part);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('请求内容不是有效 JSON'); }
}

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || '');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signExpiry(exp: number) {
  return createHmac('sha256', `${adminPassword()}|levihan-admin-v1`)
    .update(String(exp))
    .digest('base64url');
}

function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return { token: `${exp}.${signExpiry(exp)}`, exp };
}

function verifyToken(value: unknown) {
  if (typeof value !== 'string') return false;
  const split = value.indexOf('.');
  if (split < 1) return false;
  const exp = Number(value.slice(0, split));
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(value.slice(split + 1), signExpiry(exp));
}

let cosClient: S3Client | undefined;
function getCosClient() {
  const accessKeyId = String(process.env.COS_SECRET_ID || '').trim();
  const secretAccessKey = String(process.env.COS_SECRET_KEY || '').trim();
  if (!accessKeyId || !secretAccessKey) throw fail('Vercel 尚未配置 COS 服务端密钥', 503);
  if (!cosClient) {
    cosClient = new S3Client({
      region: REGION,
      endpoint: `https://cos.${REGION}.myqcloud.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return cosClient;
}

async function readJsonArray(key: string): Promise<any[]> {
  try {
    const result = await getCosClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const text = await result.Body?.transformToString();
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return [];
    throw error;
  }
}

async function writeJson(key: string, value: unknown) {
  await getCosClient().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  }));
}

function configureWebPush() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return false;
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:admin@levihan.asia').trim();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function validPushSubscription(subscription: any) {
  if (!subscription || typeof subscription !== 'object') return false;
  const endpoint = String(subscription.endpoint || '').trim();
  const p256dh = String(subscription.keys?.p256dh || '').trim();
  const auth = String(subscription.keys?.auth || '').trim();
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && endpoint.length <= 2048 &&
      p256dh.length >= 20 && p256dh.length <= 256 && auth.length >= 10 && auth.length <= 128;
  } catch {
    return false;
  }
}

function formatPushBody(raw: unknown, allowLong = false) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (allowLong) return text;
  const clipped = text.split('\n').filter(Boolean).slice(0, 3).join('\n');
  const compact = clipped.length > 120 ? `${clipped.slice(0, 119)}…` : clipped;
  return `${compact}${text.length > clipped.length && !compact.endsWith('…') ? '…' : ''}`.trim();
}

async function sendPushUpdate(options: { title: string; body: unknown; tag: string; url?: string; allowLong?: boolean; category?: 'comicUpdates' | 'announcements' }) {
  try {
    if (!configureWebPush()) return;
    const category = options.category || 'comicUpdates';
    const subscriptions = (await readJsonArray(PUSH_SUBSCRIPTIONS_KEY)).filter((item: any) =>
      Array.isArray(item?.categories) ? item.categories.includes(category) : category === 'comicUpdates',
    );
    if (!subscriptions.length) return;
    const payload = JSON.stringify({
      title: options.title,
      body: formatPushBody(options.body, options.allowLong),
      tag: options.tag,
      url: options.url || '/',
    });
    const expired = new Set<string>();
    await Promise.allSettled(subscriptions.map(async (subscription) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          webpush.sendNotification(subscription, payload, { TTL: 86400 }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('push send timeout'), { code: 'PUSH_TIMEOUT' })), PUSH_SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) expired.add(String(subscription?.endpoint || ''));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
    if (expired.size) {
      await writeJson(PUSH_SUBSCRIPTIONS_KEY, subscriptions.filter((item) => !expired.has(String(item?.endpoint || ''))));
    }
  } catch (error) {
    console.warn('[push] notification skipped', error instanceof Error ? error.message : String(error));
  }
}

function normalizeTags(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const out: string[] = [];
  values.forEach((raw) => {
    const value = String(raw ?? '').trim().slice(0, 24);
    if (value && !out.includes(value)) out.push(value);
  });
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).slice(0, 300);
}

function normalizeAuthors(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  return values.flatMap((raw: any) => {
    const name = String(raw?.name || '').trim().slice(0, 60);
    const url = String(raw?.url || '').trim().slice(0, 300);
    if (!name || seen.has(name) || (url && !/^https?:\/\//i.test(url))) return [];
    seen.add(name);
    return [{
      name,
      url,
      createdAt: String(raw?.createdAt || '').trim() || now,
      updatedAt: String(raw?.updatedAt || '').trim() || now,
    }];
  }).slice(0, 500);
}

function normalizeBook(raw: JsonRecord) {
  const id = String(raw.id || '').trim();
  if (!/^lh-\d{1,4}$/.test(id)) throw fail('ID 编号格式不对，应为 lh-数字。');
  const titleZh = String(raw.titleZh || '').trim();
  if (!titleZh) throw fail('请填写本子名。');
  const pages = Number.parseInt(raw.pages, 10);
  if (!Number.isFinite(pages) || pages < 1) throw fail('总页数必须是正整数。');
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
    : String(raw.tags || '').split(/[,，]/).map((tag: string) => tag.trim()).filter(Boolean);
  const folder = String(raw.bookFolder || '').trim() || id;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(folder)) throw fail('作品目录名无效。');
  const book: JsonRecord = {
    id,
    titleZh,
    circle: String(raw.circle || '').trim() || '未知',
    category: String(raw.category || '').trim() || '漫画本',
    tags,
    pages,
    bookFolder: folder,
    coverFile: String(raw.coverFile || '').trim() || 'image01.webp',
  };
  if (raw.uid) book.uid = String(raw.uid).trim();
  for (const field of ['titleJp', 'source', 'translator', 'typesetter']) {
    const value = String(raw[field] || '').trim();
    if (value) book[field] = value;
  }
  const text = String(raw.text || '').trim().slice(0, 2000);
  if (text) book.text = text;
  const authorUrl = String(raw.authorUrl || '').trim();
  if (authorUrl) {
    let parsed: URL;
    try { parsed = new URL(authorUrl); }
    catch { throw fail('作者主页链接不是有效网址'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('作者主页链接只支持 HTTP(S)。');
    book.authorUrl = authorUrl;
  }
  const warning = String(raw.warning || '').trim().slice(0, 100);
  if (warning) book.warning = warning;
  if (typeof raw.secure === 'boolean') book.secure = raw.secure;
  const prefix = String(raw.pagePrefix || '').trim();
  if (prefix && prefix !== 'image') book.pagePrefix = prefix;
  const pad = Number.parseInt(raw.pagePadDigits, 10);
  if (Number.isFinite(pad) && pad >= 1 && pad <= 5 && pad !== 2) book.pagePadDigits = pad;
  if (Array.isArray(raw.pageFiles)) {
    const pageFiles = raw.pageFiles.map((name: unknown) => String(name || '').trim());
    if (pageFiles.length !== pages || pageFiles.some((name: string) => !/^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png|gif|avif)$/i.test(name))) {
      throw fail('页面文件列表不合法。');
    }
    book.pageFiles = pageFiles;
  }
  return book;
}

function normalizeAnnouncement(raw: JsonRecord) {
  const tag = String(raw.tag || '').trim().slice(0, 20);
  const title = String(raw.title || '').trim().slice(0, 100);
  const author = String(raw.author || '').trim().slice(0, 40);
  const time = String(raw.time || '').trim().slice(0, 40);
  const link = String(raw.link || '').trim().slice(0, 500);
  const description = String(raw.description || '').trim().slice(0, 2000);
  if (!tag || !title || !author) throw fail('标签、标题和发布人为必填项。');
  if (link && !/^(https?:\/\/|\/|\?)/i.test(link)) throw fail('跳转链接须为 http(s) 地址或站内相对地址。');
  const id = String(raw.id || `notice-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!id) throw fail('公告 ID 无效。');
  const image = String(raw.image || '').trim().slice(0, 500);
  if (image && !announcementImageKey(image)) throw fail('公告图片地址无效。');
  return { id, tag, title, author, time, link, description, image };
}

function announcementImageKey(url: string) {
  const value = String(url || '').split('?')[0];
  if (!value.startsWith(`${CDN}/`)) return '';
  const key = value.slice(CDN.length + 1);
  return /^announcements\/(?:submissions\/)?[A-Za-z0-9_-]+\.(?:webp|jpe?g|png|gif|avif)$/i.test(key) ? key : '';
}

async function upsertAuthor(name: string, url: string) {
  const authorName = name.trim().slice(0, 60);
  const authorUrl = url.trim().slice(0, 300);
  if (!authorName || !authorUrl || !/^https?:\/\//i.test(authorUrl) || authorName === '未知') return;
  const authors = normalizeAuthors(await readJsonArray('authors.json'));
  const found = authors.find((author) => author.name === authorName);
  const now = new Date().toISOString();
  if (found) {
    if (found.url === authorUrl) return;
    found.url = authorUrl;
    found.updatedAt = now;
  } else {
    authors.unshift({ name: authorName, url: authorUrl, createdAt: now, updatedAt: now });
  }
  await writeJson('authors.json', authors);
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function getFederationToken(prefix: string) {
  const secretId = String(process.env.COS_SECRET_ID || '').trim();
  const secretKey = String(process.env.COS_SECRET_KEY || '').trim();
  if (!secretId || !secretKey || !APP_ID) throw fail('Vercel 尚未配置 COS 临时凭证服务', 503);
  const actions = [
    'name/cos:PutObject', 'name/cos:PostObject',
    'name/cos:InitiateMultipartUpload', 'name/cos:UploadPart',
    'name/cos:CompleteMultipartUpload', 'name/cos:AbortMultipartUpload',
    'name/cos:ListMultipartUploads', 'name/cos:ListParts',
  ];
  const policy = {
    version: '2.0',
    statement: [{
      effect: 'allow',
      action: actions,
      resource: [`qcs::cos:${REGION}:uid/${APP_ID}:prefix//${APP_ID}/${BUCKET}/${prefix}*`],
    }],
  };
  const body = JSON.stringify({ Name: 'LevihanAdmin', DurationSeconds: 1800, Policy: JSON.stringify(policy) });
  const host = 'sts.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const action = 'GetFederationToken';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const scope = `${date}/sts/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, 'sts');
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const result = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2018-08-13',
      'X-TC-Region': REGION,
    },
    body,
  });
  const payload: any = await result.json().catch(() => ({}));
  const response = payload?.Response;
  if (!result.ok || response?.Error || !response?.Credentials) {
    const message = response?.Error?.Message || '腾讯云未能签发 COS 临时凭证';
    throw fail(message, 502);
  }
  return {
    tmpSecretId: response.Credentials.TmpSecretId,
    tmpSecretKey: response.Credentials.TmpSecretKey,
    sessionToken: response.Credentials.Token,
    startTime: timestamp,
    expiredTime: Number(response.ExpiredTime) || timestamp + 1800,
  };
}

async function validateCosPrefix(prefix: string) {
  if (prefix === 'announcements/' || prefix === 'comic_vault/') return;
  if (!/^[A-Za-z0-9_-]{1,64}\/$/.test(prefix)) throw fail('上传目录无效。');
  const folder = prefix.slice(0, -1);
  if (/^lh-\d{1,4}$/.test(folder)) return;
  const books = await readJsonArray('archive.json');
  if (!books.some((book) => book && String(book.bookFolder || '') === folder)) throw fail('作品目录无效。', 403);
}

function mimeForImage(raw: unknown) {
  const mime = String(raw || '').toLowerCase().split(';')[0];
  const ext = IMAGE_EXTENSIONS[mime];
  if (!ext) throw fail('图片格式不受支持，请使用 WebP、JPG、PNG、GIF 或 AVIF。');
  return { mime, ext };
}

export default async function handler(request: AdminRequest, response: ServerResponse) {
  response.setHeader('Vary', 'Origin');
  const origin = request.headers.origin;
  const forwardedProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
  if (origin && origin !== ADMIN_ORIGIN && origin !== requestOrigin) {
    sendJson(response, 403, { ok: false, error: '请求来源无效' });
    return;
  }
  if (origin && (origin === ADMIN_ORIGIN || origin === requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
    response.setHeader('Access-Control-Max-Age', '600');
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { ok: false, error: '请求方法不支持' });
    return;
  }

  try {
    const payload = await readPayload(request);
    const action = String(payload.action || '').trim();
    if (!action) throw fail('缺少操作类型。');
    if (!PUBLIC_ACTIONS.has(action) && !verifyToken(payload.token || request.headers['x-admin-token'])) {
      throw fail('未授权或登录已过期，请重新登录。', 401);
    }

    if (action === 'status') {
      sendJson(response, 200, {
        ok: true,
        configured: Boolean(adminPassword() && String(process.env.COS_SECRET_ID || '').trim() && String(process.env.COS_SECRET_KEY || '').trim()),
        bucket: BUCKET,
        region: REGION,
        cdnBaseUrl: CDN,
        maxFileBytes: MAX_FILE_BYTES,
      });
      return;
    }
    if (action === 'login') {
      if (!adminPassword()) throw fail('Vercel 尚未配置管理员口令', 503);
      if (!safeEqual(String(payload.password || ''), adminPassword())) throw fail('口令不正确', 401);
      sendJson(response, 200, { ok: true, ...makeToken() });
      return;
    }

    if (action === 'pushSubscribe') {
      const subscription = payload.subscription;
      if (!validPushSubscription(subscription)) throw fail('推送订阅格式无效。');
      const subscriptions = await readJsonArray(PUSH_SUBSCRIPTIONS_KEY);
      const now = new Date().toISOString();
      const category = payload.category === 'announcements' ? 'announcements' : 'comicUpdates';
      const existing = subscriptions.find((item) => item && item.endpoint === subscription.endpoint);
      const categories = Array.from(new Set([...(Array.isArray(existing?.categories) ? existing.categories : []), category]));
      const next = subscriptions.filter((item) => item && item.endpoint !== subscription.endpoint);
      next.push({
        endpoint: String(subscription.endpoint).trim(),
        keys: { p256dh: String(subscription.keys.p256dh).trim(), auth: String(subscription.keys.auth).trim() },
        categories,
        createdAt: now,
        updatedAt: now,
      });
      await writeJson(PUSH_SUBSCRIPTIONS_KEY, next.slice(-1000));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (action === 'pushUnsubscribe') {
      const endpoint = String(payload.endpoint || '').trim();
      if (!endpoint.startsWith('https://') || endpoint.length > 2048) throw fail('推送地址无效。');
      const subscriptions = await readJsonArray(PUSH_SUBSCRIPTIONS_KEY);
      await writeJson(PUSH_SUBSCRIPTIONS_KEY, subscriptions.filter((item) => item?.endpoint !== endpoint));
      sendJson(response, 200, { ok: true });
      return;
    }

    switch (action) {
      case 'catalog': {
        const books = await readJsonArray('archive.json');
        let tags = normalizeTags(await readJsonArray('tags.json'));
        if (!tags.length) {
          tags = normalizeTags(books.flatMap((book) => Array.isArray(book?.tags) ? book.tags : []));
          if (tags.length) await writeJson('tags.json', tags);
        }
        sendJson(response, 200, { ok: true, count: books.length, books, tagLib: tags });
        return;
      }
      case 'tags': {
        const tags = payload.tags === undefined
          ? normalizeTags(await readJsonArray('tags.json'))
          : normalizeTags(payload.tags);
        if (payload.tags !== undefined) await writeJson('tags.json', tags);
        sendJson(response, 200, { ok: true, tags });
        return;
      }
      case 'authorLib': {
        const authors = payload.authors === undefined
          ? normalizeAuthors(await readJsonArray('authors.json'))
          : normalizeAuthors(payload.authors);
        if (payload.authors !== undefined) await writeJson('authors.json', authors);
        sendJson(response, 200, { ok: true, count: authors.length, authors });
        return;
      }
      case 'cosCredential': {
        const prefix = String(payload.prefix || '');
        await validateCosPrefix(prefix);
        sendJson(response, 200, { ok: true, credentials: await getFederationToken(prefix) });
        return;
      }
      case 'publish': {
        const book = normalizeBook(payload.book || {});
        const books = await readJsonArray('archive.json');
        const index = books.findIndex((entry) => entry && entry.id === book.id);
        const now = new Date().toISOString();
        if (index >= 0) {
          if (books[index].createdAt) book.createdAt = books[index].createdAt;
          if (books[index].uid && !book.uid) book.uid = books[index].uid;
          if (!Array.isArray(payload.book?.pageFiles) && Array.isArray(books[index].pageFiles)) {
            book.pageFiles = books[index].pageFiles;
          }
          books[index] = book;
        } else {
          book.createdAt = now;
          books.push(book);
        }
        book.updatedAt = now;
        await writeJson('archive.json', books);
        const tags = normalizeTags([...(await readJsonArray('tags.json')), ...book.tags]);
        await writeJson('tags.json', tags);
        await upsertAuthor(String(book.circle || ''), String(book.authorUrl || ''));
        await sendPushUpdate({
          title: index >= 0 ? '新图又出锅' : '新图出锅',
          body: String(book.titleZh || '漫画本有新的内容').slice(0, 120),
          tag: `artwork-${book.id}`,
          url: '/?tab=resources',
        });
        sendJson(response, 200, { ok: true, replaced: index >= 0, count: books.length, books });
        return;
      }
      case 'announcementList': {
        const items = await readJsonArray('announcements.json');
        sendJson(response, 200, { ok: true, count: items.length, items });
        return;
      }
      case 'announcementSave': {
        const item = normalizeAnnouncement(payload.item || {});
        const imageBase64 = String(payload.imageBase64 || '');
        const items = await readJsonArray('announcements.json');
        const index = items.findIndex((entry) => entry && entry.id === item.id);
        const previous = index >= 0 ? items[index] : null;
        if (imageBase64) {
          if (Math.floor(imageBase64.length * 3 / 4) > MAX_FILE_BYTES) throw fail('公告图片超过 4MB 上限。', 413);
          const { mime, ext } = mimeForImage(payload.imageContentType);
          const key = `announcements/${item.id}.${ext}`;
          const bytes = Buffer.from(imageBase64, 'base64');
          if (!bytes.length) throw fail('公告图片内容为空。');
          await getCosClient().send(new PutObjectCommand({
            Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime, CacheControl: 'public, max-age=31536000',
          }));
          item.image = `${CDN}/${key}?v=${Date.now()}`;
        }
        const now = new Date().toISOString();
        const nextItem = { ...(previous || {}), ...item, updatedAt: now };
        if (index >= 0) items[index] = nextItem;
        else items.unshift({ ...nextItem, createdAt: now });
        await writeJson('announcements.json', items.slice(0, 30));
        const oldImageKey = announcementImageKey(String(previous?.image || ''));
        const newImageKey = announcementImageKey(nextItem.image);
        if (oldImageKey && oldImageKey !== newImageKey) {
          await getCosClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldImageKey }));
        }
        sendJson(response, 200, { ok: true, item: nextItem, items: items.slice(0, 30) });
        return;
      }
      case 'announcementDelete': {
        const id = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
        if (!id) throw fail('公告 ID 无效。');
        const items = await readJsonArray('announcements.json');
        const target = items.find((entry) => entry && entry.id === id);
        if (!target) throw fail('公告不存在。', 404);
        const imageKey = announcementImageKey(String(target.image || ''));
        const next = items.filter((entry) => entry && entry.id !== id);
        await writeJson('announcements.json', next);
        if (imageKey) await getCosClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: imageKey }));
        sendJson(response, 200, { ok: true, id, items: next });
        return;
      }
      default:
        throw fail('此管理功能已关闭。', 404);
    }
  } catch (error: any) {
    const status = Number(error?.status || error?.$metadata?.httpStatusCode) || 500;
    sendJson(response, status, { ok: false, error: error?.message || '管理请求失败', status });
  }
}
