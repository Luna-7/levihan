/**
 * 利韩土豆仓 · 同人本管理员上传通道（CloudBase Web 云函数 / HTTP 服务）
 *
 * 传输层：HTTP 服务（scf_bootstrap 启动，监听 9000 端口），前端直接 fetch 调用
 *
 * 设计要点：
 * - 不存放任何永久密钥：使用云函数运行时自动注入的临时凭证（TENCENTCLOUD_SECRETID/KEY/SESSIONTOKEN）；
 *   实测该凭证对本桶 levihan-1325571558 具备读写权限，因此无需 STS、无需配置 COS 密钥
 * - 浏览器 → 本函数（带管理员口令）→ COS 桶；前端拿不到任何 COS 密钥
 * - 归档元数据写入桶根目录 archive.json（与 scripts/sync-archive.mjs 同构：DoujinBookItem[]）
 *
 * 环境变量（均不含密钥）：
 *   ADMIN_PASSWORD   管理员口令（必填）
 *   COS_BUCKET       默认 levihan-1325571558
 *   COS_REGION       默认 ap-nanjing
 *   ALLOWED_ORIGINS  可选，逗号分隔；默认 *
 *
 * 接口：POST /  body = { action, ... }
 *   status    公开                        → 健康检查 / 口令是否已配置
 *   login     {password}                  → { token, exp }
 *   catalog   (token)                     → { books }
 *   upload    (token) {bookId,fileName,dataBase64,contentType} → { key, bytes }
 *   publish   (token) {book}              → { books }
 *   remove    (token) {id, deleteFiles}   → { id, deletedObjects, books }
 *   novelList     (token)                          → { novels }
 *   novelSave     (token) {id?,title,author,body,authorNote?,warning?,tags?} → { novel, novels }
 *   novelDelete   (token) {id}                     → { id, novels }
 *   recs          (token) {items: RecommendItem[]} → { count }   // 落桶 recs.json
 *   submitContact {kind,content,...} (公开)        → 联络来信写入云端收件箱（type=contact）
 *   authorLib     (token) {authors?}              → 作者链接登记表（不传=读取；传=整表覆盖）
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

const BUCKET = process.env.COS_BUCKET || 'levihan-1325571558';
const REGION = process.env.COS_REGION || 'ap-nanjing';
const ARCHIVE_KEY = 'archive.json';
const TAGS_KEY = 'tags.json';   // 全站标签库（string[]），供上传台下拉选择
const AUTHORS_KEY = 'authors.json'; // 作者链接登记表（[{name,url,createdAt,updatedAt}]），上传台自动补全 + 可导出 Excel
const ANNOUNCEMENTS_KEY = 'announcements.json'; // 首页公告栏（公开读取、管理员写入）
const ANNOUNCEMENT_DIR = 'announcements/';
const FORUM_KEY = 'restaurant-forum.json';
const FORUM_DIR = 'restaurant-forum/';
const MAX_AUTHORS = 500;
const INBOX_COLLECTION = 'submission_inbox';
const NOVELS_KEY = 'novels.json';   // 在线小说索引（GroupNovel[]）
const NOVEL_DIR = 'novels/';        // 在线小说正文：novels/{id}.txt（纯文本）
const MAX_NOVEL_CHARS = 500000;     // 单篇正文字数上限
const MAX_BYTES = 4 * 1024 * 1024; // 单文件上限 4MB
const MAX_BODY = 6 * 1024 * 1024; // 请求体上限 6MB（HTTP 访问服务 / API 网关的硬上限）
const TOKEN_TTL = 2 * 60 * 60; // 令牌有效期 2 小时
const PORT = process.env.PORT || 9000;

const cos = new COS({
  SecretId: process.env.TENCENTCLOUD_SECRETID,
  SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
  SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
  Protocol: 'https:',
});

/* ------------------------------ 基础设施 ------------------------------ */

const promisify =
  (fn) =>
  (params) =>
    new Promise((resolve, reject) => fn(params, (err, data) => (err ? reject(err) : resolve(data))));

const putObject = promisify(cos.putObject.bind(cos));
const getObject = promisify(cos.getObject.bind(cos));
const getBucket = promisify(cos.getBucket.bind(cos));
const deleteMultipleObject = promisify(cos.deleteMultipleObject.bind(cos));

const adminPassword = () => process.env.ADMIN_PASSWORD || '';

/** 时间安全比较，避免口令被逐字符试探 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function signExp(exp) {
  return crypto.createHmac('sha256', adminPassword() + '|levihan-admin-v1').update(String(exp)).digest('base64url');
}

function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  return { token: `${exp}.${signExp(exp)}`, exp };
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const i = token.indexOf('.');
  const exp = Number(token.slice(0, i));
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(token.slice(i + 1), signExp(exp));
}

const ID_RE = /^lh-\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png|gif|avif)$/i;

const httpError = (message, status) => Object.assign(new Error(message), { httpStatus: status });

/* ------------------------------ 归档读写 ------------------------------ */

/** 读取桶根归档；文件不存在则视为空数组 */
async function readArchive() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: ARCHIVE_KEY });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeArchive(books) {
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: ARCHIVE_KEY,
    Body: Buffer.from(JSON.stringify(books, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  });
}

async function readAnnouncements() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: ANNOUNCEMENTS_KEY });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeAnnouncements(items) {
  await putObject({
    Bucket: BUCKET, Region: REGION, Key: ANNOUNCEMENTS_KEY,
    Body: Buffer.from(JSON.stringify(items, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8', CacheControl: 'no-cache',
  });
}

async function readForum() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: FORUM_KEY });
    const parsed = JSON.parse(Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}
async function writeForum(items) {
  await putObject({ Bucket: BUCKET, Region: REGION, Key: FORUM_KEY,
    Body: Buffer.from(JSON.stringify(items, null, 2), 'utf8'), ContentType: 'application/json; charset=utf-8', CacheControl: 'no-cache' });
}

function normalizeAnnouncement(raw) {
  const tag = String(raw.tag || '').trim().slice(0, 20);
  const title = String(raw.title || '').trim().slice(0, 100);
  const author = String(raw.author || '').trim().slice(0, 40);
  const time = String(raw.time || '').trim().slice(0, 40);
  const link = String(raw.link || '').trim().slice(0, 500);
  const description = String(raw.description || '').trim().slice(0, 2000);
  if (!tag || !title || !author) throw httpError('标签、标题和发布人为必填项', 400);
  if (link && !/^(https?:\/\/|\/|\?)/i.test(link)) throw httpError('跳转链接须为 http(s) 地址或站内相对地址', 400);
  const id = String(raw.id || `notice-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!id) throw httpError('公告 ID 无效', 400);
  return { id, tag, title, author, time, link, description, image: String(raw.image || '').trim().slice(0, 500) };
}

/** 读取全站标签库；文件不存在则视为空数组 */
async function readTagLib() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: TAGS_KEY });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return normalizeTagLib(parsed);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeTagLib(tags) {
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: TAGS_KEY,
    Body: Buffer.from(JSON.stringify(normalizeTagLib(tags), null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  });
}

/** 清洗：去空、trim、去重、限长限量、稳定排序 */
function normalizeTagLib(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  list.forEach((t) => {
    const v = String(t == null ? '' : t).trim().slice(0, 24);
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return out.slice(0, 300);
}

/** 从归档里兜底推导标签库（tags.json 缺失时用一次） */
function deriveTagsFromBooks(books) {
  const out = [];
  (Array.isArray(books) ? books : []).forEach((b) => {
    (b && Array.isArray(b.tags) ? b.tags : []).forEach((t) => {
      const v = String(t == null ? '' : t).trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    });
  });
  return normalizeTagLib(out);
}

/* ------------------------------ 作者链接登记表 ------------------------------ */

/** 读取作者链接登记表；文件不存在则视为空数组 */
async function readAuthorLib() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: AUTHORS_KEY });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeAuthorLib(authors) {
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: AUTHORS_KEY,
    Body: Buffer.from(JSON.stringify(authors, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  });
}

/** 整表覆盖前的清洗：作者名唯一、链接须为 http(s)、限长限量 */
function normalizeAuthorLib(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  list.forEach((raw) => {
    const name = String((raw && raw.name) || '').trim().slice(0, 60);
    const url = String((raw && raw.url) || '').trim().slice(0, 300);
    if (!name || seen.has(name)) return;
    if (url && !/^https?:\/\//i.test(url)) return;
    seen.add(name);
    out.push({
      name,
      url,
      createdAt: String((raw && raw.createdAt) || '').trim() || new Date().toISOString(),
      updatedAt: String((raw && raw.updatedAt) || '').trim() || new Date().toISOString(),
    });
  });
  return out.slice(0, MAX_AUTHORS);
}

/** 自动登记：同名作者更新链接，新作者插入表头；无变化返回 false */
async function upsertAuthor(name, url) {
  const n = String(name || '').trim().slice(0, 60);
  const u = String(url || '').trim().slice(0, 300);
  if (!n || !u || !/^https?:\/\//i.test(u) || n === '未知') return false;
  const authors = await readAuthorLib();
  const found = authors.find((a) => a && a.name === n);
  const now = new Date().toISOString();
  if (found) {
    if (found.url === u) return false;
    found.url = u;
    found.updatedAt = now;
  } else {
    authors.unshift({ name: n, url: u, createdAt: now, updatedAt: now });
  }
  await writeAuthorLib(authors.slice(0, MAX_AUTHORS));
  return true;
}

/** 字段顺序与 sync-archive.mjs / 前端 DoujinBookItem 保持一致 */
function normalizeBook(raw) {
  const id = String(raw.id || '').trim();
  if (!ID_RE.test(id)) throw httpError(`ID「${id}」不符合 lh-数字 格式`, 400);

  const titleZh = String(raw.titleZh || '').trim();
  if (!titleZh) throw httpError('缺少「本子名」', 400);

  const pages = parseInt(raw.pages, 10);
  if (!Number.isFinite(pages) || pages < 1) throw httpError('「总页数」必须是正整数', 400);

  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : String(raw.tags || '')
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);

  const book = {
    id,
    titleZh,
    circle: String(raw.circle || '').trim() || '未知',
    category: String(raw.category || '').trim() || '漫画本',
    tags: tags.map((t) => String(t).trim()).filter(Boolean),
    pages,
    bookFolder: String(raw.bookFolder || '').trim() || id,
    coverFile: String(raw.coverFile || '').trim() || 'image01.webp',
  };

  for (const field of ['titleJp', 'source', 'translator', 'typesetter']) {
    const v = String(raw[field] || '').trim();
    if (v) book[field] = v;
  }

  const authorUrl = String(raw.authorUrl || '').trim();
  if (authorUrl) {
    let parsed;
    try { parsed = new URL(authorUrl); } catch { throw httpError('作者主页链接不是有效网址', 400); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw httpError('作者主页链接只支持 HTTP(S)', 400);
    book.authorUrl = authorUrl;
  }

  const pagePrefix = String(raw.pagePrefix || '').trim();
  if (pagePrefix && pagePrefix !== 'image') book.pagePrefix = pagePrefix;

  // 内容预警：未勾选时前端传空串，这里不写入字段，站点即不展示
  const warning = String(raw.warning || '').trim().slice(0, 100);
  if (warning) book.warning = warning;

  // 只在给出合法值时写入；空值/0 必须忽略，否则前端 getCosPageUrl 的 `?? 2` 会拿到 0 而丢掉补零
  const padDigits = parseInt(raw.pagePadDigits, 10);
  if (Number.isFinite(padDigits) && padDigits >= 1 && padDigits <= 5 && padDigits !== 2) {
    book.pagePadDigits = padDigits;
  }

  if (Array.isArray(raw.pageFiles)) {
    const pageFiles = raw.pageFiles.map((name) => String(name || '').trim());
    if (pageFiles.length !== pages || pageFiles.some((name) => !FILE_RE.test(name))) {
      throw httpError('页面文件列表不合法', 400);
    }
    book.pageFiles = pageFiles;
  }

  return book;
}

/* ------------------------------ 在线小说 ------------------------------ */

const NOVEL_ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** 读取在线小说索引；文件不存在则视为空数组 */
async function readNovels() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: NOVELS_KEY });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeNovels(novels) {
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: NOVELS_KEY,
    Body: Buffer.from(JSON.stringify(novels, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  });
}

/** 校验并规范化小说元数据；正文字数由调用方传入 */
function normalizeNovelMeta(raw, chars) {
  const title = String(raw.title || '').trim();
  if (!title) throw httpError('缺少「标题」', 400);
  if (title.length > 120) throw httpError('标题过长（上限 120 字）', 400);

  let id = String(raw.id || '').trim();
  if (!id) id = 'nv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);

  const meta = {
    id,
    title,
    author: String(raw.author || '').trim() || '佚名',
    chars,
    createdAt: String(raw.createdAt || '').trim() || new Date().toISOString(),
  };
  if (String(raw.updatedAt || '').trim()) meta.updatedAt = String(raw.updatedAt).trim();

  const authorUrl = String(raw.authorUrl || '').trim();
  if (authorUrl) {
    let parsed;
    try { parsed = new URL(authorUrl); } catch { throw httpError('作者主页链接不是有效网址', 400); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw httpError('作者主页链接只支持 HTTP(S)', 400);
    meta.authorUrl = authorUrl;
  }

  // 可选字段只在有真实值时写入（与归档约定一致）
  const authorNote = String(raw.authorNote || '').trim().slice(0, 2000);
  if (authorNote) meta.authorNote = authorNote;

  const warning = String(raw.warning || '').trim().slice(0, 100);
  if (warning) meta.warning = warning;

  const rawTags = Array.isArray(raw.tags)
    ? raw.tags
    : String(raw.tags || '').split(/[,，]/);
  const tags = rawTags.map((t) => String(t == null ? '' : t).trim()).filter(Boolean).slice(0, 20);
  if (tags.length) meta.tags = tags;

  return meta;
}

/** 站外推荐表（recs.json）：白名单字段 + 轻校验后整表覆盖 */
function normalizeRecs(items) {
  const out = [];
  const seen = new Set();
  items.forEach((raw) => {
    const title = String((raw && raw.title) || '').trim();
    if (!title) return;
    const url = /^https?:\/\//.test(String((raw && raw.url) || '').trim()) ? String(raw.url).trim() : '';
    if (url && seen.has(url)) return;
    if (url) seen.add(url);
    const item = {
      id: String((raw && raw.id) || '').trim() || `rec-${out.length}`,
      title,
      url,
      type: String((raw && raw.type) || '').trim() || '未分类',
      rating: String((raw && raw.rating) || '').trim() || '未标注',
    };
    const site = String((raw && raw.site) || '').trim();
    if (site) item.site = site;
    const recommender = String((raw && raw.recommender) || '').trim();
    if (recommender) item.recommender = recommender;
    const reason = String((raw && raw.reason) || '').trim();
    if (reason) item.reason = reason;
    const createdAt = String((raw && raw.createdAt) || '').trim();
    if (createdAt) item.createdAt = createdAt;
    out.push(item);
  });
  return out;
}

async function readRecs() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: 'recs.json' });
    const text = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    const parsed = JSON.parse(text);
    return normalizeRecs(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeRecs(items) {
  const recs = normalizeRecs(items);
  await putObject({ Bucket: BUCKET, Region: REGION, Key: 'recs.json',
    Body: Buffer.from(JSON.stringify(recs, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8', CacheControl: 'no-cache' });
  return recs;
}

/** 列出某目录下全部对象 Key（自动翻页） */
async function listAllKeys(prefix) {
  const keys = [];
  let marker;
  for (let page = 0; page < 50; page++) {
    const res = await getBucket({ Bucket: BUCKET, Region: REGION, Prefix: prefix, MaxKeys: 1000, Marker: marker });
    (res.Contents || []).forEach((o) => o && o.Key && keys.push(o.Key));
    if (!res.IsTruncated || !res.NextMarker) break;
    marker = res.NextMarker;
  }
  return keys;
}

/* ------------------------------ 业务路由 ------------------------------ */

function inboxDb() {
  const tcb = require('@cloudbase/node-sdk');
  const accessKey = process.env.CLOUDBASE_APIKEY;
  if (!accessKey) throw httpError('云端收件箱尚未配置服务端数据库凭证', 503);
  return tcb.init({ env: 'levihan-tudou-d0g7jivue1ccc4a35', accessKey }).rdb({ database: 'public' });
}

function assertDbResult(result) {
  if (result.error) throw httpError('云端收件箱数据库请求失败：' + result.error.message, 503);
  return result.data;
}

/** 联络（DispatchHub 呈递函）允许的表单种类 */
const CONTACT_KINDS = {
  feedback: '战术研讨',
  'translate-release': '汉化发布',
  novel: '同人小说',
  'art-comic': '插画/短漫',
  recommend: '安利推荐',
  'translate-request': '汉化请求',
  'custom-order': '商业定制',
};

/** 校验并规范化联络来信内容 */
function normalizeContactItem(payload) {
  const kind = String(payload.kind || '').trim();
  if (!CONTACT_KINDS[kind]) throw httpError('未知的联络类型', 400);
  const content = String(payload.content || '').replace(/\r\n?/g, '\n').trim().slice(0, 5000);
  const title = String(payload.title || '').trim().slice(0, 120);
  const reason = String(payload.reason || '').trim().slice(0, 2000);
  if (!content && !title && !reason) throw httpError('联络内容不能为空', 400);
  const email = String(payload.email || '').trim();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) throw httpError('请填写有效邮箱', 400);
  const item = { kind, kindLabel: CONTACT_KINDS[kind], title, content, reason, email };
  ['name', 'author', 'homepage', 'source', 'translator', 'typesetter', 'notes', 'link', 'category'].forEach((k) => {
    const v = String(payload[k] == null ? '' : payload[k]).trim().slice(0, 300);
    if (v) item[k] = v;
  });
  return item;
}

async function submitToInbox(type, payload) {
  if (payload.website) return { ok: true }; // 蜜罐字段，拦截普通机器人
  const now = new Date().toISOString();
  let item;
  if (type === 'novel') {
    const title = String(payload.title || '').trim();
    const author = String(payload.author || '').trim();
    const email = String(payload.email || '').trim();
    const body = String(payload.body || '').replace(/\r\n?/g, '\n').trim();
    if (!title || title.length > 120 || !author || author.length > 80) throw httpError('请填写有效的标题和作者', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw httpError('请填写有效邮箱', 400);
    if (!body || body.length > MAX_NOVEL_CHARS) throw httpError('正文不能为空或超过字数上限', 400);
    const authorUrl = String(payload.authorUrl || '').trim();
    if (authorUrl) {
      let parsed;
      try { parsed = new URL(authorUrl); } catch { throw httpError('作者主页链接不是有效网址', 400); }
      if (!['https:', 'http:'].includes(parsed.protocol)) throw httpError('作者主页链接只支持 HTTP(S)', 400);
    }
    item = { title, author, email, body,
      authorUrl: authorUrl.slice(0, 300),
      notes: String(payload.notes || '').trim().slice(0, 2000) };
  } else if (type === 'announcement') {
    const title = String(payload.title || '').trim().slice(0, 100);
    const author = String(payload.author || '').trim().slice(0, 40);
    if (!title || !author) throw httpError('请填写企划标题和发布人', 400);
    const description = String(payload.description || '').trim().slice(0, 2000);
    if (!description) throw httpError('请填写企划宣传文本', 400);
    item = { title, author, time: String(payload.time || '').trim().slice(0, 40), description,
      link: String(payload.link || '').trim().slice(0, 500), image: String(payload.image || '').trim().slice(0, 500), tag: '企划' };
  } else if (type === 'recommend') {
    const title = String(payload.title || '').trim().slice(0, 120);
    const link = String(payload.link || '').trim().slice(0, 500);
    if (!title || !/^https?:\/\//i.test(link)) throw httpError('请填写推荐标题和有效链接', 400);
    item = { title, link, author: String(payload.author || '').trim().slice(0, 80) || '匿名推荐人',
      reason: String(payload.reason || '').trim().slice(0, 2000), category: String(payload.category || '').trim().slice(0, 40),
      rating: String(payload.rating || '').trim().slice(0, 20) };
  } else if (type === 'contact') {
    item = normalizeContactItem(payload);
  } else throw httpError('不支持的投稿类型', 400);
  const id = crypto.randomUUID();
  assertDbResult(await inboxDb().from(INBOX_COLLECTION).insert({ id, type, status: 'pending', payload: item, created_at: now, updated_at: now }));
  return { ok: true, id, status: 'pending' };
}

async function reviewInbox(payload) {
  const id = String(payload.id || '').trim();
  const decision = String(payload.decision || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id) || !['approve', 'reject'].includes(decision)) throw httpError('审核参数无效', 400);
  const db = inboxDb();
  const rows = assertDbResult(await db.from(INBOX_COLLECTION).select('id,type,status,payload').eq('id', id).limit(1));
  const row = Array.isArray(rows) ? rows[0] : rows;
  const item = row && { type: row.type, status: row.status, ...(row.payload || {}) };
  if (!item || item.status !== 'pending') throw httpError('投稿不存在或已处理', 409);
  const now = new Date().toISOString();
  if (decision === 'approve') {
    if (item.type === 'novel') {
      const novelId = 'nv-' + id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
      await handle('novelSave', { id: novelId, title: item.title, author: item.author,
        authorUrl: item.authorUrl, body: item.body, authorNote: item.notes });
    } else if (item.type === 'announcement') {
      await handle('announcementSave', { item: { tag: '利韩企划', title: item.title, time: item.time,
        author: item.author, link: item.link, image: item.image, description: item.description } });
    } else if (item.type === 'recommend') {
      const recs = await readRecs();
      recs.unshift(normalizeRecs([{ title: item.title, url: item.link, type: item.category || '推荐',
        rating: item.rating || '未分级', recommender: item.author, reason: item.reason,
        createdAt: new Date().toISOString() }])[0]);
      await writeRecs(recs);
    } else if (item.type !== 'contact') {
      // contact（联络来信）没有发布动作，approve 仅表示「已读处理」
      throw httpError('不支持的投稿类型', 400);
    }
  }
  assertDbResult(await db.from(INBOX_COLLECTION).update({ status: decision === 'approve' ? 'published' : 'rejected', updated_at: now }).eq('id', id).eq('status', 'pending'));
  return { ok: true, id, status: decision === 'approve' ? 'published' : 'rejected' };
}

async function handle(action, payload) {
  switch (action) {
    case 'submitNovel': return submitToInbox('novel', payload);
    case 'submitContact': return submitToInbox('contact', payload);
    case 'submitAnnouncement': return submitToInbox('announcement', payload);
    case 'submitRecommend': return submitToInbox('recommend', payload);
    case 'inboxList': {
      const rows = assertDbResult(await inboxDb().from(INBOX_COLLECTION).select('id,type,payload,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100));
      return { ok: true, items: (rows || []).map((row) => ({ _id: row.id, type: row.type, createdAt: row.created_at, ...(row.payload || {}) })) };
    }
    case 'inboxReview': return reviewInbox(payload);
    case 'status':
      return {
        ok: true,
        configured: adminPassword().length > 0,
        bucket: BUCKET,
        region: REGION,
        cdnBaseUrl: 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com',
        maxFileBytes: MAX_BYTES,
        time: new Date().toISOString(),
      };

    case 'login': {
      if (!adminPassword()) throw httpError('服务端尚未配置管理员口令', 503);
      if (!safeEqual(String(payload.password || ''), adminPassword())) throw httpError('口令不正确', 401);
      return { ok: true, ...makeToken() };
    }

    case 'announcementList': {
      const items = await readAnnouncements();
      return { ok: true, count: items.length, items };
    }

    case 'announcementImageUpload': {
      const imageBase64 = String(payload.imageBase64 || '');
      if (!imageBase64 || Math.floor((imageBase64.length * 3) / 4) > MAX_BYTES) throw httpError('图片为空或超过 4MB', 413);
      const key = `${ANNOUNCEMENT_DIR}submissions/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
      await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: Buffer.from(imageBase64, 'base64'), ContentType: 'image/webp', CacheControl: 'public, max-age=31536000' });
      return { ok: true, url: `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}` };
    }

    case 'announcementSave': {
      const item = normalizeAnnouncement(payload.item || {});
      const imageBase64 = String(payload.imageBase64 || '');
      if (imageBase64) {
        if (Math.floor((imageBase64.length * 3) / 4) > MAX_BYTES) throw httpError('公告图片超过 4MB 上限', 413);
        const body = Buffer.from(imageBase64, 'base64');
        if (!body.length) throw httpError('公告图片内容为空', 400);
        const key = `${ANNOUNCEMENT_DIR}${item.id}.webp`;
        await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: body,
          ContentType: 'image/webp', CacheControl: 'public, max-age=31536000' });
        item.image = `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}?v=${Date.now()}`;
      }
      const items = await readAnnouncements();
      const index = items.findIndex((entry) => entry && entry.id === item.id);
      const now = new Date().toISOString();
      const next = { ...(index >= 0 ? items[index] : {}), ...item, updatedAt: now };
      if (index >= 0) items[index] = next;
      else items.unshift({ ...next, createdAt: now });
      await writeAnnouncements(items.slice(0, 30));
      return { ok: true, item: next, items };
    }

    case 'announcementDelete': {
      const id = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
      if (!id) throw httpError('公告 ID 无效', 400);
      const items = await readAnnouncements();
      const target = items.find((entry) => entry && entry.id === id);
      if (!target) throw httpError('公告不存在', 404);
      if (target.image && target.image.includes(`/${ANNOUNCEMENT_DIR}${id}.webp`)) {
        await deleteMultipleObject({ Bucket: BUCKET, Region: REGION, Objects: [{ Key: `${ANNOUNCEMENT_DIR}${id}.webp` }] });
      }
      const next = items.filter((entry) => entry && entry.id !== id);
      await writeAnnouncements(next);
      return { ok: true, id, items: next };
    }

    case 'forumList': return { ok: true, posts: await readForum() };

    case 'forumPublish': {
      const title = String(payload.title || '').trim().slice(0, 100);
      const body = String(payload.body || '').trim().slice(0, 3000);
      const author = String(payload.author || '').trim().slice(0, 40);
      if (!title || (!body && !payload.imageBase64) || !author) throw httpError('标题、昵称及正文或图片不能为空', 400);
      const id = `post-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      let image = '';
      const b64 = String(payload.imageBase64 || '');
      if (b64) {
        if (Math.floor((b64.length * 3) / 4) > MAX_BYTES) throw httpError('帖子图片超过 4MB', 413);
        const key = `${FORUM_DIR}${id}.webp`;
        await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: Buffer.from(b64, 'base64'), ContentType: 'image/webp', CacheControl: 'public, max-age=31536000' });
        image = `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}`;
      }
      const posts = await readForum();
      const post = { id, author, title, body, image, potatoes: 0, createdAt: new Date().toISOString(), comments: [] };
      posts.unshift(post); await writeForum(posts.slice(0, 300));
      return { ok: true, post, posts };
    }

    case 'forumComment': {
      const postId = String(payload.postId || '').trim();
      const body = String(payload.body || '').trim().slice(0, 1000);
      const author = String(payload.author || '').trim().slice(0, 40);
      if (!postId || !body || !author) throw httpError('评论内容和昵称不能为空', 400);
      const posts = await readForum(); const post = posts.find((p) => p && p.id === postId);
      if (!post) throw httpError('帖子不存在', 404);
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      post.comments.push({ id: `comment-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, author, body, createdAt: new Date().toISOString(), potatoes: 0 });
      await writeForum(posts); return { ok: true, posts };
    }

    case 'forumDelete': {
      const id = String(payload.id || '').trim(); const posts = await readForum();
      const next = posts.filter((p) => p && p.id !== id); await writeForum(next);
      return { ok: true, posts: next };
    }

    case 'forumCommentDelete': {
      const posts = await readForum(); const post = posts.find((p) => p && p.id === String(payload.postId || ''));
      if (!post) throw httpError('帖子不存在', 404);
      post.comments = (post.comments || []).filter((c) => c && c.id !== String(payload.commentId || ''));
      await writeForum(posts); return { ok: true, posts };
    }

    case 'catalog': {
      const books = await readArchive();
      let tagLib = await readTagLib();
      if (!tagLib.length) {
        // 标签库为空时，用归档里已有标签兜底建一次，老数据不会「没有可选项」
        tagLib = deriveTagsFromBooks(books);
        if (tagLib.length) await writeTagLib(tagLib);
      }
      return { ok: true, count: books.length, books, tagLib };
    }

    /** 标签库：不传 tags = 读取；传 tags = 覆盖保存 */
    case 'tags': {
      if (!payload.tags) {
        const cur = await readTagLib();
        return { ok: true, tags: cur };
      }
      if (!Array.isArray(payload.tags)) throw httpError('tags 必须是数组', 400);
      const next = normalizeTagLib(payload.tags);
      await writeTagLib(next);
      return { ok: true, tags: next };
    }

    /** 作者链接登记表：不传 authors = 读取；传 authors = 整表覆盖（供后台手工增删 + 导出 Excel） */
    case 'authorLib': {
      if (payload.authors !== undefined) {
        if (!Array.isArray(payload.authors)) throw httpError('authors 必须是数组', 400);
        const next = normalizeAuthorLib(payload.authors);
        await writeAuthorLib(next);
        return { ok: true, count: next.length, authors: next };
      }
      const authors = await readAuthorLib();
      return { ok: true, count: authors.length, authors };
    }

    case 'upload': {
      const bookId = String(payload.bookId || '').trim();
      const fileName = String(payload.fileName || '').trim();
      if (!ID_RE.test(bookId)) throw httpError('非法目录名（应为 lh-数字）', 400);
      if (!FILE_RE.test(fileName)) throw httpError('非法文件名', 400);

      const b64 = String(payload.dataBase64 || '');
      if (Math.floor((b64.length * 3) / 4) > MAX_BYTES)
        throw httpError(`文件超过 ${(MAX_BYTES / 1024 / 1024).toFixed(1)}MB 上限`, 413);

      const body = Buffer.from(b64, 'base64');
      if (!body.length) throw httpError('文件内容为空', 400);

      const key = `${bookId}/${fileName}`;
      await putObject({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: body,
        ContentType: String(payload.contentType || 'image/webp'),
        CacheControl: 'public, max-age=31536000',
      });
      return { ok: true, key, bytes: body.length };
    }

    case 'publish': {
      const book = normalizeBook(payload.book || {});
      const books = await readArchive();
      const idx = books.findIndex((b) => b && b.id === book.id);
      const replaced = idx >= 0;
      const now = new Date().toISOString();
      if (replaced) {
        if (books[idx].createdAt) book.createdAt = books[idx].createdAt;
        books[idx] = book;
      } else {
        book.createdAt = now;
        books.push(book);
      }
      book.updatedAt = now;
      await writeArchive(books);

      // 顺带把本子用到的标签并入标签库，保证「下拉里一定有新加的标签」
      const lib = await readTagLib();
      let added = 0;
      book.tags.forEach((t) => { if (lib.indexOf(t) < 0) { lib.push(t); added += 1; } });
      if (added) await writeTagLib(normalizeTagLib(lib));

      // 自动登记「作者名 + 主页链接」到登记表，下次输入同名作者会自动带出链接
      try { await upsertAuthor(book.circle, book.authorUrl); } catch (e) { console.error('[authorLib] 登记失败', e && e.message); }

      return { ok: true, replaced, count: books.length, books };
    }

    case 'remove': {
      const id = String(payload.id || '').trim();
      if (!ID_RE.test(id)) throw httpError('非法 ID', 400);

      const books = await readArchive();
      const target = books.find((b) => b && b.id === id);
      if (!target) throw httpError('归档中找不到该作品', 404);

      const folder = String(target.bookFolder || id).replace(/^\/|\/$/g, '');
      let deletedObjects = 0;

      if (payload.deleteFiles !== false) {
        const keys = await listAllKeys(`${folder}/`);
        for (let i = 0; i < keys.length; i += 1000) {
          const chunk = keys.slice(i, i + 1000);
          await deleteMultipleObject({ Bucket: BUCKET, Region: REGION, Objects: chunk.map((Key) => ({ Key })) });
          deletedObjects += chunk.length;
        }
      }

      const next = books.filter((b) => b && b.id !== id);
      await writeArchive(next);
      return { ok: true, id, deletedObjects, count: next.length, books: next };
    }

    /* -------- 在线小说（小说本模块第一段） -------- */

    case 'novelList': {
      const novels = await readNovels();
      return { ok: true, count: novels.length, novels };
    }

    case 'novelSave': {
      const text = String(payload.body || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
      if (!text.trim()) throw httpError('正文不能为空', 400);
      if (text.length > MAX_NOVEL_CHARS) throw httpError(`正文超过 ${MAX_NOVEL_CHARS} 字上限`, 413);

      const meta = normalizeNovelMeta(payload, text.length);
      await putObject({
        Bucket: BUCKET,
        Region: REGION,
        Key: `${NOVEL_DIR}${meta.id}.txt`,
        Body: Buffer.from(text, 'utf8'),
        ContentType: 'text/plain; charset=utf-8',
        CacheControl: 'no-cache',
      });

      const novels = await readNovels();
      const idx = novels.findIndex((n) => n && n.id === meta.id);
      const replaced = idx >= 0;
      if (replaced) {
        meta.createdAt = novels[idx].createdAt || meta.createdAt;
        meta.updatedAt = new Date().toISOString();
        novels[idx] = meta;
      } else {
        novels.unshift(meta);
      }
      novels.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      await writeNovels(novels);

      // 在线小说同样自动登记作者链接
      try { await upsertAuthor(meta.author, meta.authorUrl); } catch (e) { console.error('[authorLib] 登记失败', e && e.message); }

      return { ok: true, replaced, novel: meta, count: novels.length, novels };
    }

    case 'novelDelete': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);

      const novels = await readNovels();
      const next = novels.filter((n) => n && n.id !== id);
      await deleteMultipleObject({
        Bucket: BUCKET,
        Region: REGION,
        Objects: [{ Key: `${NOVEL_DIR}${id}.txt` }],
      });
      await writeNovels(next);
      return { ok: true, id, count: next.length, novels: next };
    }

    /* -------- 站外推荐表（recs.json，整表覆盖；SSOT 是腾讯表格，此处只做落桶） -------- */

    case 'recs': {
      if (payload.items === undefined) return { ok: true, items: await readRecs() };
      if (!Array.isArray(payload.items)) throw httpError('items 必须是数组', 400);
      const recs = await writeRecs(payload.items);
      return { ok: true, count: recs.length, items: recs };
    }

    default:
      throw httpError(`未知操作：${action || '(空)'}`, 400);
  }
}

/* ------------------------------ HTTP 层 ------------------------------ */

function corsHeaders(origin) {
  const allow = (process.env.ALLOWED_ORIGINS || '*').trim();
  const value =
    allow === '*'
      ? '*'
      : allow
          .split(',')
          .map((s) => s.trim())
          .includes(origin)
        ? origin
        : allow.split(',')[0].trim();
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function send(res, status, data, origin) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(origin),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError('请求体过大', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === 'GET') {
    send(res, 200, { ok: true, service: 'admin-upload', action: 'use POST' }, origin);
    return;
  }

  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    send(res, (err && err.httpStatus) || 400, { ok: false, error: (err && err.message) || '请求体解析失败' }, origin);
    return;
  }

  const action = String(payload.action || '').trim();
  const token = payload.token || req.headers['x-admin-token'] || '';

  try {
    if (!['status', 'login', 'submitNovel', 'submitContact', 'submitAnnouncement', 'submitRecommend', 'announcementList', 'announcementImageUpload', 'forumList', 'forumPublish', 'forumComment'].includes(action) && !verifyToken(token)) {
      throw httpError('未授权或登录已过期，请重新登录', 401);
    }
    send(res, 200, await handle(action, payload), origin);
  } catch (err) {
    send(res, (err && err.httpStatus) || 500, { ok: false, error: (err && err.message) || String(err), status: (err && err.httpStatus) || 500 }, origin);
  }
});

// 仅当作为 Web 函数主入口（scf_bootstrap 执行 node index.js）时启动 HTTP 服务；
// 被事件函数加载时 require.main !== module，不会占用端口。
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[admin-upload] listening on ${PORT}`);
  });
}

/* ------------------------------ Event 函数入口 ------------------------------ */
/**
 * 兼容「事件函数 + HTTP 访问服务」调用方式：
 * 云接入会把 API 网关事件透传进来，此处复用同一套 handle() 逻辑。
 */
exports.main = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';

  if (String(event.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  let payload = event || {};
  if (typeof event.body === 'string' && event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  } else if (event.body && typeof event.body === 'object') {
    payload = event.body;
  }

  const action = String(payload.action || '').trim();
  const headers = event.headers || {};
  const token = payload.token || headers['x-admin-token'] || headers['X-Admin-Token'] || '';

  const respond = (status, data) => ({
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    body: JSON.stringify(data),
  });

  // 无 action 的 GET 视为健康检查，避免直接落到 401 分支
  if (!action && String(event.httpMethod || '').toUpperCase() === 'GET') {
    return respond(200, { ok: true, service: 'admin-upload', hint: '请以 POST + JSON body {action} 调用' });
  }

  try {
    if (!['status', 'login', 'submitNovel', 'submitContact', 'submitAnnouncement', 'submitRecommend', 'announcementList', 'announcementImageUpload', 'forumList', 'forumPublish', 'forumComment'].includes(action) && !verifyToken(token)) {
      throw httpError('未授权或登录已过期，请重新登录', 401);
    }
    return respond(200, await handle(action, payload));
  } catch (err) {
    const status = (err && err.httpStatus) || 500;
    return respond(status, { ok: false, error: (err && err.message) || String(err), status });
  }
};
