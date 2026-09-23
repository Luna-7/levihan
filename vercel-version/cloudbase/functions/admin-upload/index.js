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
 *
 * 深度加密密文（vault）专用，全部需要 token；key 固定为 comic_vault/<标识>_secure.txt：
 *   vaultUpload   (token) {key,dataText}                        → 单次上传（密文 ≤ 4MB）
 *   vaultInit     (token) {key}                                 → {uploadId} 开分片
 *   vaultPart     (token) {key,uploadId,partNumber,dataText}    → {etag}
 *   vaultComplete (token) {key,uploadId,parts:[{partNumber,etag}]} → 合并为一个对象
 *   vaultAbort    (token) {key,uploadId}                        → 中止并清理残片
 *
 * 为什么密文要单独开一套 action：现有 action:'upload' 的 FILE_RE 只收图片后缀，
 * 而密文按 .txt 存；且客户端从不明文构造 COS 路径，前缀必须由服务端固定，
 * 免得表单一改就能往桶里任意位置写。
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
const LINK_COVER_DIR = 'link-covers/';
const MARKET_KEY = 'potato-market.json';   // 土豆市集商品索引（MarketItem[]）
const MARKET_DIR = 'potato-market/';       // 市集商品图片：potato-market/{itemId}-{n}.webp
const MAX_MARKET_ITEMS = 500;
const MARKET_MAX_IMAGES = 3;               // 单个商品最多 3 张图
const MAX_AUTHORS = 500;
const INBOX_COLLECTION = 'submission_inbox';
const NOVELS_KEY = 'novels.json';   // 在线小说索引（GroupNovel[]）
const NOVEL_DIR = 'novels/';        // 在线小说正文：novels/{id}.txt（纯文本）
const MAX_NOVEL_CHARS = 500000;     // 单篇正文字数上限

/* 用户投稿免审直发的加密正文：novels_vault/{id}_secure.txt（明文永不落桶）。
   密码链与敏感漫画本完全同款（public/admin/secure-upload.js）：
   key = SHA-256(密码) 32 字节 raw，IV = 16 字节 ASCII，AES-256-CBC → Base64。
   前台解密用 crypto-js 同参数（SecureComicReader 同源思路），改任一端都会解不开历史密文。 */
const NOVEL_VAULT_DIR = 'novels_vault/';
const NOVEL_VAULT_PASSWORD = 'levihan';
const NOVEL_VAULT_IV_UTF8 = 'levihan-vault-iv';
/* 小说评论区：novel_comments/{id}.json（一篇一个文件，阅读器只拉自己那篇） */
const NOVEL_COMMENTS_DIR = 'novel_comments/';
const MAX_NOVEL_COMMENTS = 500; // 单篇评论上限（超出丢最旧的）

function encryptNovelBody(text) {
  const key = crypto.createHash('sha256').update(NOVEL_VAULT_PASSWORD).digest();
  const iv = Buffer.from(NOVEL_VAULT_IV_UTF8, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

/** 与前端 src/utils/novelVault.ts 同参数（key=SHA-256(密码)、IV=ASCII、AES-256-CBC、Base64） */
function decryptNovelBody(cipherBase64) {
  const key = crypto.createHash('sha256').update(NOVEL_VAULT_PASSWORD).digest();
  const iv = Buffer.from(NOVEL_VAULT_IV_UTF8, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([
    decipher.update(Buffer.from(String(cipherBase64 || '').trim(), 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
const MAX_BYTES = 4 * 1024 * 1024; // 单文件上限 4MB
const MAX_BODY = 6 * 1024 * 1024; // 请求体上限 6MB（HTTP 访问服务 / API 网关的硬上限）

/**
 * 深度加密密文（vault）专用约束。
 *
 * 与前台上传台的约定见 vercel-version/docs/SECURE_UPLOAD.md：
 *   密文 key 形如 comic_vault/<bookId|时间戳>_secure.txt，前缀与后缀都固定，
 *   因此这里可以用一条极严的正则收敛住，杜绝客户端自选前缀造成的越权写入。
 *
 * 分片上传用于突破单请求 6MB 的传输上限：每个分片携带的密文文本不超过
 * VAULT_PART_BYTES，最后一个分片可以更小。分片号从 1 开始，上限 10000，
 * 与 COS CompleteMultipartUpload 的约束一致。
 */
const VAULT_PREFIX = 'comic_vault/';
const VAULT_KEY_RE = /^comic_vault\/[A-Za-z0-9_-]{1,40}_secure\.txt$/;
const VAULT_CIPHER_TYPE = 'text/plain; charset=utf-8';
const MAX_PART_NUMBER = 10000;
/**
 * 密文缓存策略，必须与前端 CONFIG.CacheControl 完全一致（secure-upload.js:108）。
 * 两条上传通道（浏览器直传 / 云函数中转）只要有一条写得不同，
 * 同一个 key 就会因通道不同而拿到不同的缓存行为，排查起来极难。
 */
const VAULT_CACHE_CONTROL = 'public, max-age=31536000';
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
// 分片上传四件套：初始化 → 传分片 → 合并 → （失败时）中止清理
//
// 方法名务必与 **Node 端** cos-nodejs-sdk-v5 对齐。浏览器端 cos-js-sdk-v5 叫
// createMultipartUpload / uploadPart / completeMultipartUpload / abortMultipartUpload，
// 两边命名**不同** —— 曾按浏览器那套写，结果 cos.createMultipartUpload 是 undefined，
// 顶层 .bind() 直接抛 TypeError，模块加载失败、进程以 145 退出，
// 表现为整个函数 FUNCTIONS_INVOCATION_FAILED（所有 action 全挂，不只是分片）。
// node --check 只查语法、契约测试只做字符串匹配，都抓不到这种错 —— 见
// tests/fn-deps-smoke.test.cjs 的"方法名必须存在于真 SDK"断言。
const multipartInit = promisify(cos.multipartInit.bind(cos));
const multipartUpload = promisify(cos.multipartUpload.bind(cos));
const multipartComplete = promisify(cos.multipartComplete.bind(cos));
const multipartAbort = promisify(cos.multipartAbort.bind(cos));

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

/* ------------------------------ 密文（vault）校验 ------------------------------ */

/**
 * 密文 key 校验。前缀固定 comic_vault/，段内只允许 [A-Za-z0-9_-]，
 * 后缀固定 _secure.txt —— 不放行任何嵌套斜杠与点号，
 * 因此 ".."、"comic_vault/../" 这类穿越串一律过不了。
 */
function assertVaultKey(raw) {
  const key = String(raw == null ? '' : raw).trim();
  if (!VAULT_KEY_RE.test(key)) {
    throw httpError('非法密文路径（只允许 comic_vault/<标识>_secure.txt，标识限字母数字下划线连字符）', 400);
  }
  return key;
}

/**
 * 单次请求携带的密文文本校验。
 * 密文本身已是 Base64 文本（ASCII），故 utf8 字节数即字符数。
 * 上限沿用 MAX_BYTES：超出的批次必须走 vaultInit/vaultPart 分片。
 */
function assertCipherText(raw) {
  const text = String(raw == null ? '' : raw);
  if (!text) throw httpError('密文内容为空', 400);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) {
    throw httpError(`单次密文超过 ${(MAX_BYTES / 1024 / 1024).toFixed(1)}MB 上限，请改用分片上传`, 413);
  }
  return text;
}

function assertUploadId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!id || id.length > 512) throw httpError('缺少或非法 UploadId', 400);
  return id;
}

function assertPartNumber(raw, partCount) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PART_NUMBER) {
    throw httpError(`分片号必须是 1~${MAX_PART_NUMBER} 的整数`, 400);
  }
  if (partCount !== undefined && n > partCount) {
    throw httpError(`分片号 ${n} 超出声明的分片数 ${partCount}`, 400);
  }
  return n;
}

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

// 点赞账号只保存在服务端，列表里的选中状态按当前登录账号生成。
function forumView(posts, uid) {
  return posts.map((post) => {
    const viewItem = (item) => {
      const { potatoVoters, potatoGiven, ...publicItem } = item;
      return { ...publicItem, potatoGiven: !!uid && Array.isArray(potatoVoters) && potatoVoters.includes(uid) };
    };
    return { ...viewItem(post), comments: Array.isArray(post.comments) ? post.comments.map(viewItem) : [] };
  });
}
function forumResultView(result, uid) {
  if (!result || !Array.isArray(result.posts)) return result;
  const posts = forumView(result.posts, uid);
  return { ...result, posts, ...(result.post ? { post: posts.find((post) => post.id === result.post.id) || result.post } : {}) };
}

/* ==================== 安利墙（外链分享） ==================== */

/** 按域名识别平台与预览级别：A=B站可站内播放，B=OG 卡片可预览，C=仅跳转 */
function detectLinkPlatform(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'b23.tv' || host.endsWith('.bilibili.com') || host === 'bilibili.com') return { platform: 'bilibili', tier: 'A' };
  if (host.endsWith('.lofter.com') || host === 'lofter.com') return { platform: 'lofter', tier: 'B' };
  if (host.endsWith('.xiaohongshu.com') || host === 'xiaohongshu.com' || host === 'xhslink.com') return { platform: 'xiaohongshu', tier: 'C' };
  if (host === 'weibo.com' || host.endsWith('.weibo.com') || host === 'weibo.cn' || host.endsWith('.weibo.cn') || host === 't.cn') return { platform: 'weibo', tier: 'B' };
  if (host === 'pixiv.net' || host.endsWith('.pixiv.net')) return { platform: 'pixiv', tier: 'B' };
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com') || host === 't.co') return { platform: 'x', tier: 'B' };
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return { platform: 'instagram', tier: 'B' };
  // AO3 及其镜像：站点在国内不可达（云函数抓不到 OG），且原站带 X-Frame-Options 禁止内嵌，
  // 一律落 C 级跳转卡；前端另给「复制名称 + 镜像站面板」兜底。
  if (host === 'archiveofourown.org' || host.endsWith('.archiveofourown.org') || host === 'ao3.org' || host.endsWith('.ao3.org')) return { platform: 'ao3', tier: 'C' };
  if (host === 'ao3mirror.com' || host.endsWith('.ao3mirror.com') || host === 'ao3mirror.net' || host.endsWith('.ao3mirror.net')) return { platform: 'ao3', tier: 'C' };
  if (host === 'ao3-agent.co' || host.endsWith('.ao3-agent.co') || host === 'ao3-agent.org' || host.endsWith('.ao3-agent.org')) return { platform: 'ao3', tier: 'C' };
  if (/^go3-cn\.(online|xyz|blog)$/.test(host)) return { platform: 'ao3', tier: 'C' };
  return { platform: 'web', tier: 'B' };
}

/** 从 URL 提取 B 站 BV 号（支持 /video/BVxx 与 b23.tv 短链解析后的最终地址） */
function extractBvid(url) {
  const m = String(url).match(/(BV[0-9A-Za-z]{10})/);
  return m ? m[1] : '';
}

/** SSRF 防护：只许 http(s) 且拒绝内网 / 链路本地地址 */
function isSafeExternalUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === '::1' || host === '[::1]' || host === '[fc00::]' ) return false;
  return true;
}

/** 这类协议能执行代码/读本地文件，绝不入库；App 分享的自定义 scheme（bilibili:// 等）放行 */
const BLOCKED_LINK_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'chrome']);

/**
 * 安利墙链接归一化：不做「必须是 http(s)」的死校验。
 * - 已带任意 scheme（bilibili:// / snssdk1128:// 等各 App 分享链接）→ 原样放行（拦危险协议）
 * - 裸域名（xhslink.com/xxx、www.x.com/a）→ 自动补 https://
 * - 其余形态（纯文本等）→ 返回空串，由调用方报错
 * 返回值供入库与展示；是否能「抓预览」由调用方再判 http(s)。
 */
function normalizeExternalLink(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (schemeMatch) {
    return BLOCKED_LINK_SCHEMES.has(schemeMatch[1].toLowerCase()) ? '' : s;
  }
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#].*)?$/i.test(s)) return `https://${s}`;
  // 分享文案常是「【标题】 https://…」混合文本：从中抽出链接部分（App scheme 与 http(s) 都认）
  const m = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>【】（）《》「」『』，。；！？]+/i.exec(s);
  if (m) {
    const m2 = /^([a-z][a-z0-9+.-]*):\/\//i.exec(m[0]);
    if (m2 && !BLOCKED_LINK_SCHEMES.has(m2[1].toLowerCase())) return m[0];
  }
  return '';
}

/** 是否为可抓取预览的网页链接 */
const isFetchableLink = (url) => /^https?:\/\/(\[[0-9a-f:]+\]|[^/])/i.test(String(url || ''));


function extractMetaTags(html) {
  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const decode = (s) => s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  return {
    title: decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i) || pick(/<title[^>]*>([^<]*)<\/title>/i)).slice(0, 200),
    description: decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)).slice(0, 500),
    image: decode(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i)),
  };
}

/** 带超时地抓取页面（UA 伪装成普通浏览器），失败返回 null（C 级降级路径） */
async function fetchPageMeta(pageUrl, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 500000);
    return { finalUrl: res.url || pageUrl, meta: extractMetaTags(html) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 封面防盗链：把远端图抓下来转存进 COS，返回站内直链；失败返回空串（前端回退占位） */
async function transferCoverToCos(coverUrl, pageUrl) {
  if (!coverUrl || !isSafeExternalUrl(coverUrl)) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(coverUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', Referer: pageUrl || coverUrl },
    });
    if (!res.ok) return '';
    const type = String(res.headers.get('content-type') || 'image/jpeg');
    if (!/^image\//.test(type)) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 3 * 1024 * 1024) return '';
    const ext = /png/i.test(type) ? 'png' : /webp/i.test(type) ? 'webp' : /gif/i.test(type) ? 'gif' : 'jpg';
    const key = `${LINK_COVER_DIR}cv-${crypto.createHash('sha1').update(coverUrl).digest('hex').slice(0, 16)}.${ext}`;
    await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: buf, ContentType: type, CacheControl: 'public, max-age=31536000' });
    return `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** b23.tv 短链解析：读 302 的 Location 拿到 www.bilibili.com/video/BVxx 最终地址 */
async function resolveShortLink(shortUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(shortUrl, {
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
    });
    const loc = res.headers.get('location') || res.headers.get('Location') || '';
    return loc || '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * B 站官方接口取标题/封面/UP主：HTML 页面有反爬（服务端拿到空 OG），
 * view 接口不需要登录，取到的数据比扒 HTML 稳得多。
 */
async function fetchBilibiliMeta(bvid) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Referer: `https://www.bilibili.com/video/${bvid}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.code !== 0 || !data.data) return null;
    const d = data.data;
    return {
      title: String(d.title || '').slice(0, 200),
      description: String(d.desc || '').slice(0, 500),
      image: String(d.pic || ''),
      owner: String((d.owner && d.owner.name) || '').slice(0, 100),
      duration: Number(d.duration) || 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * linkPreview：登录用户粘贴外链后服务端代抓 OG 元数据。
 * 返回 { platform, tier, bvid?, title, description, coverUrl }；任何失败都优雅降级（tier 可能落到 C）。
 */
async function buildLinkPreview(rawUrl) {
  // 先归一化（裸域名补 https、放行 App 分享 scheme、拦危险协议）
  const normalized = normalizeExternalLink(rawUrl);
  if (!normalized) throw httpError('请粘贴网页链接或 App 分享链接', 400);
  // App 自定义 scheme（bilibili:// 等）抓不了预览，直接按 C 级跳转卡返回原链接
  if (!isFetchableLink(normalized)) {
    return { platform: 'web', tier: 'C', url: normalized, title: '', description: '', appLink: true };
  }
  if (!isSafeExternalUrl(normalized)) throw httpError('仅支持公开的 http(s) 链接', 400);
  rawUrl = normalized;
  let detected = detectLinkPlatform(rawUrl) || { platform: 'web', tier: 'B' };
  let finalUrl = rawUrl;
  let meta = { title: '', description: '', image: '' };
  let bvidHint = '';

  // 小红书等强反爬平台：不再浪费时间抓页面，直接按 C 级跳转卡返回原始链接
  if (detected.platform === 'xiaohongshu') {
    return { platform: 'xiaohongshu', tier: 'C', url: rawUrl, title: '', description: '' };
  }

  // AO3 / AO3 镜像：原站在国内不可达、且带 X-Frame-Options 禁内嵌，抓页面必然超时。
  // 直接按 C 级跳转卡返回原名（标题由发布者手填），封面留空走占位。
  if (detected.platform === 'ao3') {
    return { platform: 'ao3', tier: 'C', url: rawUrl, title: '', description: '' };
  }

  // 短链（b23.tv）：先解析出带 BV 号的真实地址
  if (/b23\.tv$/.test(new URL(rawUrl).hostname.toLowerCase())) {
    const loc = await resolveShortLink(rawUrl);
    if (loc) {
      bvidHint = extractBvid(loc);
      if (detected.platform === 'bilibili' && bvidHint) finalUrl = loc;
    }
  }

  // 微博分享短链 t.cn：先取跳转地址，再抓真实微博页的 OG 元数据。
  if (new URL(rawUrl).hostname.toLowerCase() === 't.cn') {
    const loc = await resolveShortLink(rawUrl);
    if (isSafeExternalUrl(loc) && detectLinkPlatform(loc)?.platform === 'weibo') finalUrl = loc;
  }

  if (detected.platform === 'bilibili') {
    const bvid = extractBvid(finalUrl) || bvidHint;
    if (bvid) {
      const vid = await fetchBilibiliMeta(bvid);
      if (vid) {
        meta = { title: vid.title, description: vid.description, image: vid.image };
        if (vid.owner) meta.description = meta.description || `UP主 @${vid.owner}`;
      }
    }
  }

  // B 站接口没给到数据（或非 B 站）时，退回页面 OG 抓取
  if (!meta.title && !meta.image) {
    const page = await fetchPageMeta(finalUrl);
    if (page) {
      meta = page.meta;
      const redetected = detectLinkPlatform(page.finalUrl);
      // 只在最终地址仍属同一平台、或解析出了 BV 号时才采用跳转地址，避免把「登录拦截页」当成原文链接
      if (redetected && (redetected.platform === detected.platform || extractBvid(page.finalUrl))) {
        detected = redetected;
        finalUrl = page.finalUrl;
      }
    }
  }

  const bvid = detected.platform === 'bilibili' ? (extractBvid(finalUrl) || bvidHint) : '';
  let coverUrl = '';
  if (meta.image) {
    coverUrl = await transferCoverToCos(meta.image, detected.platform === 'bilibili' ? 'https://www.bilibili.com/' : finalUrl);
    // B 站封面转存偶尔失败，保留官方图片地址供前端直接尝试加载。
    if (!coverUrl && detected.platform === 'bilibili' && isSafeExternalUrl(meta.image)) coverUrl = meta.image;
  }
  const tier = detected.tier === 'A' && !bvid ? 'C' : detected.tier === 'B' && !meta.title && !meta.description && !coverUrl ? 'C' : detected.tier;
  return {
    platform: detected.platform,
    tier,
    bvid: bvid || undefined,
    // B站：短链解析后带一堆追踪参数，统一清洗成规范地址
    url: detected.platform === 'bilibili' && bvid ? `https://www.bilibili.com/video/${bvid}` : finalUrl,
    title: meta.title,
    description: meta.description,
    coverUrl: coverUrl || undefined,
  };
}

/**
 * 将单个故事接龙帖子编译成在线小说合订本元数据（GroupNovel）。
 * 与前端 `relayNovels.ts` 的 compileRelayPostToNovel 保持一致；
 * 这里由服务端在「建立接力 / 接棒」时自动调用，确保合订本持久化到 novels.json，
 * 而不是依赖前端手动点「合订本」按钮的临时编译。
 *
 * 合订本 id 稳定取 `relay-<postId>`，符合 NOVEL_ID_RE（[a-z0-9-]{3,}）。
 */
function compileRelayToNovel(post) {
  const comments = Array.isArray(post.comments)
    ? post.comments.filter((c) => c && (typeof c.relayStep === 'number' || (c.body && c.body.length > 0)))
    : [];
  const allAuthorsInOrder = [post.author].concat(comments.map((c) => c.author));
  const distinctAuthors = Array.from(new Set(allAuthorsInOrder.filter(Boolean)));

  let totalChars = (post.body || '').length;
  comments.forEach((c) => { totalChars += (c.body || '').length; });

  const sections = [];
  if (post.prompt) sections.push(`【起笔设定】\n${post.prompt}`);
  sections.push(`【第 1 棒 · 执笔：${post.author}】\n${post.body || ''}`);
  comments.forEach((c, idx) => {
    const diceInfo = c.diceRoll && c.diceRoll.value ? ` · 🎲 1D100=${c.diceRoll.value}${c.diceRoll.verdict ? ` (${c.diceRoll.verdict})` : ''}` : '';
    sections.push(`【第 ${idx + 2} 棒 · 执笔：${c.author}${diceInfo}】\n${c.body || ''}`);
  });
  sections.push(`──────────────────────────────────\n【兵团同好手稿联合署名】\n${distinctAuthors.join('  ✖️  ')}`);
  const compiledBody = sections.join('\n\n');

  const id = `relay-${String(post.id || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return {
    id,
    title: String(post.title || '').trim(),
    author: `${post.author} 等 ${distinctAuthors.length} 位同好`,
    chars: totalChars,
    createdAt: post.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isRelayCompiled: true,
    relayAuthors: distinctAuthors,
    relayStepsCount: comments.length + 1,
    prompt: post.prompt,
    bodyContent: compiledBody,
    originalPostId: post.id,
    tags: ['故事接龙', '合订本', `${comments.length + 1}棒连缀`],
  };
}

/** 把编译好的合订本写回 novels.json（按 id upsert，并写正文 txt） */
async function saveRelayNovel(novel) {
  if (!novel.id || !novel.title) return;
  const bodyContent = String(novel.bodyContent || '');
  // novels.json 只保存索引元数据；正文单独放在 novels/<id>.txt，避免接棒越多索引越臃肿。
  const meta = { ...novel };
  delete meta.bodyContent;
  // 正文落桶
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: `${NOVEL_DIR}${novel.id}.txt`,
    Body: Buffer.from(bodyContent, 'utf8'),
    ContentType: 'text/plain; charset=utf-8',
    CacheControl: 'no-cache',
  });
  // 元数据 upsert 进 novels.json（保持 updatedAt 排序）
  const novels = await readNovels();
  const idx = novels.findIndex((n) => n && n.id === meta.id);
  if (idx >= 0) {
    meta.createdAt = novels[idx].createdAt || meta.createdAt;
    novels[idx] = meta;
  } else {
    novels.unshift(meta);
  }
  novels.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  await writeNovels(novels);
  return meta;
}

/** 删除某接力帖子对应的合订本（若存在） */
async function deleteRelayNovel(postId) {
  const id = `relay-${String(postId || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const novels = await readNovels();
  const next = novels.filter((n) => n && n.id !== id);
  if (next.length === novels.length) return; // 本就没有合订本
  await deleteMultipleObject({
    Bucket: BUCKET,
    Region: REGION,
    Objects: [{ Key: `${NOVEL_DIR}${id}.txt` }],
  });
  await writeNovels(next);
}

async function readMarket() {
  try {
    const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: MARKET_KEY });
    const parsed = JSON.parse(Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}
async function writeMarket(items) {
  await putObject({ Bucket: BUCKET, Region: REGION, Key: MARKET_KEY,
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

  // 敏感内容标记：只有前端显式传布尔值时才写入 —— 传 false 用于取消标记，缺省则保留原值。
  // 站点依据它把本子导向 SecureComicReader（403 伪装页 + 双重解密），所以必须能显式清除。
  if (typeof raw.secure === 'boolean') book.secure = raw.secure;

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

/**
 * 按加密与否把正文写到正确位置，并清掉另一侧的旧文件。
 * 编辑/保存可能切换「普通 ↔ 敏感」，若只写新位置不清旧位置，
 * 会留下一份孤儿密文/明文：敏感篇的明文一旦残留，等于加密形同虚设。
 */
async function writeNovelBody(id, text, sensitive) {
  const plainKey = `${NOVEL_DIR}${id}.txt`;
  const vaultKey = `${NOVEL_VAULT_DIR}${id}_secure.txt`;
  const target = sensitive ? vaultKey : plainKey;
  const stale = sensitive ? plainKey : vaultKey;
  await putObject({
    Bucket: BUCKET,
    Region: REGION,
    Key: target,
    Body: Buffer.from(sensitive ? encryptNovelBody(text) : text, 'utf8'),
    ContentType: 'text/plain; charset=utf-8',
    CacheControl: 'no-cache',
  });
  try {
    await deleteMultipleObject({ Bucket: BUCKET, Region: REGION, Objects: [{ Key: stale }] });
  } catch (e) {
    console.error('[novel] 清理旧正文失败', e && e.message);
  }
  return target;
}

/** 读取某篇小说的明文正文（加密篇解密后返回），供后台编辑回填 */
async function readNovelBodyText(novel) {
  if (novel.encrypted) {
    const res = await getObject({
      Bucket: BUCKET, Region: REGION, Key: `${NOVEL_VAULT_DIR}${novel.id}_secure.txt`,
    });
    const cipher = Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
    return decryptNovelBody(cipher);
  }
  const res = await getObject({ Bucket: BUCKET, Region: REGION, Key: `${NOVEL_DIR}${novel.id}.txt` });
  return Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body);
}

async function readNovelComments(id) {
  try {
    const res = await getObject({
      Bucket: BUCKET, Region: REGION, Key: `${NOVEL_COMMENTS_DIR}${id}.json`,
    });
    const parsed = JSON.parse(Buffer.isBuffer(res.Body) ? res.Body.toString('utf8') : String(res.Body));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'NoSuchKey')) return [];
    throw err;
  }
}

async function writeNovelComments(id, comments) {
  await putObject({
    Bucket: BUCKET, Region: REGION, Key: `${NOVEL_COMMENTS_DIR}${id}.json`,
    Body: Buffer.from(JSON.stringify(comments, null, 2), 'utf8'),
    ContentType: 'application/json; charset=utf-8', CacheControl: 'no-cache',
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

/**
 * 编辑合并时会先摊开旧 meta 再覆盖新值：新值若被清空（作者说/预警/链接/标签），
 * {...旧, ...新} 会把旧值留下来，导致「清空」操作永远不生效 —— 这里统一删掉空字段。
 */
function pruneEmptyNovelFields(meta) {
  ['authorUrl', 'authorNote', 'warning', 'tags'].forEach((k) => {
    const v = meta[k];
    if (!v || (Array.isArray(v) && !v.length)) delete meta[k];
  });
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

/**
 * 校验前端自建会话 token（不透明 token，服务端只存 SHA-256 哈希），返回当前用户 uuid。
 * 用于「发布/删除需登录 + 只能操作自己内容」的身份绑定。
 * token 由前端 localStorage 里的 session token 提供（Authorization: Bearer 头），
 * 经 user_sessions.token_hash（SHA-256）匹配，再查 app_users 拿 uuid（active 才有效）。
 */
async function authUid(bearer) {
  const token = String(bearer || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: 'levihan-tudou-d0g7jivue1ccc4a35', accessKey: process.env.CLOUDBASE_APIKEY });
    const db = app.rdb({ database: 'public' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await db.from('user_sessions').select('user_id,expires_at,revoked_at').eq('token_hash', tokenHash).limit(1);
    if (session.error) return null;
    const row = Array.isArray(session.data) ? session.data[0] : session.data;
    if (!row || row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    const users = await db.from('app_users').select('id,status').eq('id', row.user_id).limit(1);
    if (users.error) return null;
    const user = Array.isArray(users.data) ? users.data[0] : users.data;
    if (!user || user.status !== 'active') return null;
    return String(user.id);
  } catch (err) {
    return null; // token 无效/过期 → 视为未登录
  }
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
    // 与后台「小说管理」发布格式对齐：标签（逗号分隔，≤20 个）+ 内容预警（≤100 字）
    const rawTags = Array.isArray(payload.tags)
      ? payload.tags
      : String(payload.tags || '').split(/[,，]/);
    const tags = rawTags.map((t) => String(t == null ? '' : t).trim()).filter(Boolean).slice(0, 20);
    const warning = String(payload.warning || '').trim().slice(0, 100);
    item = { title, author, email, body,
      authorUrl: authorUrl.slice(0, 300),
      notes: String(payload.notes || '').trim().slice(0, 2000) };
    if (tags.length) item.tags = tags;
    if (warning) item.warning = warning;
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
        authorUrl: item.authorUrl, body: item.body, authorNote: item.notes,
        tags: item.tags, warning: item.warning });
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

/* ------------------------------ 鉴权动作集合 ------------------------------ */
// 完全公开：无需登录、无需管理员 token（健康检查 / 读操作 / 匿名投递）
const PUBLIC_ACTIONS = new Set([
  'status', 'login',
  'submitNovel', 'submitContact', 'submitAnnouncement', 'submitRecommend',
  'submitCustomOrderEmail',
  'announcementList', 'announcementImageUpload',
  'forumList', 'forumTodayRelay', 'marketList',
  'novelCommentList',
  'leaderboard',
]);
// 需用户登录（CloudBase access_token 换 uid）：发布/互动/删除自己的内容
const USER_ACTIONS = new Set([
  'forumComment', 'forumPotato', 'forumClaim', 'forumReleaseClaim',
  'forumCommentDelete', 'forumEdit',
  'marketPublish', 'marketDelete',
  'novelDirectPublish', 'novelUpdate', 'novelCommentAdd',
  'novelBody',
  'submitScore',
]);
/* 用户会话**或**管理员令牌任一即可：
   - 删评论 / 删帖子 = 本人（uid 比对）或管理员（管理员可清理任意垃圾贴）
   - linkPreview = 前台发布安利与后台发布安利都要用
   - forumPublish = 站长代发公告型帖子（如安利墙的整理合集，署编者名）也要能发
   管理员没有用户会话，走普通 USER_ACTIONS 会被 401 挡死。 */
const USER_OR_ADMIN_ACTIONS = new Set(['novelCommentDelete', 'linkPreview', 'forumDelete', 'forumPublish', 'forumEnrichLink', 'forumImageUpload', 'forumCommentEdit']);

/* ------------------------------ 头号玩家排行榜 ------------------------------ */

/**
 * 三款游戏均参与榜单；lihan 分榜按实际通关时间升序排列。
 */
const GAME_KEYS = ['daxigua', 'hange', 'lihan'];
const LEADERBOARD_TOP = 50;
/** 每人每游戏每日最多提交次数，防脚本刷榜 */
const SCORE_DAILY_LIMIT = 30;
/** 与 save-hange 的 FALLBACK_TRACK_SECONDS 保持一致（终曲全长 3:56） */
const FALLBACK_TRACK_SECONDS = 236;

/**
 * 归一化公式必须与前端保持一致：src/utils/gameScores.ts → meritOf() / MERIT_TUNING
 * 改任一端都要同步改另一端，否则本地预估与入库值会对不上。〔待校准〕
 */
const GAME_TUNING = {
  daxiguaScoreCap: 3000,
  hangeParMoves: 30,
  hangeWinBase: 400,
  hangeTimeBonusMax: 300,
  hangeMoveBonusMax: 300,
  lihanBenchmarkSeconds: 900,
  meritCap: 1000,
};

const clamp01Game = (v) => Math.min(1, Math.max(0, v));
const numGame = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function gameMerit(gameKey, raw) {
  if (gameKey === 'daxigua') {
    const score = Math.max(0, Math.round(numGame(raw.score)));
    return Math.round((Math.min(score, GAME_TUNING.daxiguaScoreCap) / GAME_TUNING.daxiguaScoreCap) * GAME_TUNING.meritCap);
  }
  if (gameKey === 'lihan') {
    const used = numGame(raw.timeUsedSeconds);
    if (used <= 0) return 0;
    return Math.max(1, Math.round((1 - clamp01Game(used / GAME_TUNING.lihanBenchmarkSeconds)) * (GAME_TUNING.meritCap - 1)) + 1);
  }
  const duration = numGame(raw.duration) > 0 ? numGame(raw.duration) : FALLBACK_TRACK_SECONDS;
  const used = Math.max(0, Math.min(numGame(raw.timeUsedSeconds), duration));
  const timeFactor = clamp01Game((duration - used) / duration);
  const moveFactor = clamp01Game(1 - (numGame(raw.moves) - GAME_TUNING.hangeParMoves) / GAME_TUNING.hangeParMoves);
  return Math.round(
    GAME_TUNING.hangeWinBase +
      GAME_TUNING.hangeTimeBonusMax * timeFactor +
      GAME_TUNING.hangeMoveBonusMax * moveFactor
  );
}

/** 取用户在榜单上的展示名（app_users.username），查不到就退回无名士兵 */
async function gameNicknameOf(db, uid) {
  if (!uid) return null;
  const users = await db.from('app_users').select('id,username').eq('id', uid).limit(1);
  const user = Array.isArray(users.data) ? users.data[0] : users.data;
  return (user && user.username) || null;
}

const gameRows = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** 读榜：uid 为空时只返回公开榜单（游客可看） */
async function readLeaderboard(uid) {
  const db = inboxDb();
  const best = gameRows(
    assertDbResult(
      await db
        .from('game_best')
        .select('uid,game_key,merit,raw_score,achieved_at')
        .order('merit', { ascending: false })
        .limit(500)
    )
  );

  // 昵称统一从 app_users 取（game_best 只存 uid，避免改名后榜单对不上）
  const nicknameMap = {};
  const uids = [...new Set(best.map((row) => row.uid))];
  if (uids.length) {
    const users = gameRows(assertDbResult(await db.from('app_users').select('id,username').in('id', uids)));
    users.forEach((user) => {
      if (user) nicknameMap[String(user.id)] = user.username || '无名士兵';
    });
  }
  const nameOf = (id) => nicknameMap[String(id)] || '无名士兵';

  // 分榜（best 已按 merit 降序，过滤后顺序保持）
  const ranked = {};
  GAME_KEYS.forEach((key) => {
    ranked[key] = best.filter((row) => row.game_key === key);
  });
  ranked.lihan.sort((a, b) => numGame(a.raw_score && a.raw_score.timeUsedSeconds) - numGame(b.raw_score && b.raw_score.timeUsedSeconds));

  // 总榜：按 uid 聚合各游戏积分
  const totalsMap = new Map();
  best.forEach((row) => {
    const entry = totalsMap.get(row.uid) || { uid: row.uid, merit: 0, breakdown: {} };
    entry.merit += row.merit;
    entry.breakdown[row.game_key] = row.merit;
    totalsMap.set(row.uid, entry);
  });
  const rankedTotal = [...totalsMap.values()].sort((a, b) => b.merit - a.merit);

  const shape = (entry) => ({
    uid: entry.uid,
    nickname: nameOf(entry.uid),
    merit: entry.merit,
    achievedAt: entry.achieved_at,
    ...(entry.game_key === 'lihan' ? { timeUsedSeconds: numGame(entry.raw_score && entry.raw_score.timeUsedSeconds) } : {}),
  });

  const total = rankedTotal.slice(0, LEADERBOARD_TOP).map((entry) => ({ ...shape(entry), breakdown: entry.breakdown }));
  const daxigua = ranked.daxigua.slice(0, LEADERBOARD_TOP).map(shape);
  const hange = ranked.hange.slice(0, LEADERBOARD_TOP).map(shape);
  const lihan = ranked.lihan.slice(0, LEADERBOARD_TOP).map(shape);

  let me = null;
  if (uid && totalsMap.has(uid)) {
    const mine = totalsMap.get(uid);
    const indexOf = (list) => {
      const index = list.findIndex((entry) => entry.uid === uid);
      return index >= 0 ? index + 1 : null;
    };
    me = {
      uid,
      nickname: nameOf(uid),
      merit: mine.merit,
      breakdown: mine.breakdown,
      ranks: {
        total: indexOf(rankedTotal),
        daxigua: indexOf(ranked.daxigua),
        hange: indexOf(ranked.hange),
        lihan: indexOf(ranked.lihan),
      },
    };
  }

  return { ok: true, total, daxigua, hange, lihan, me };
}

/** 提交成绩：需登录（uid 由调用方用 authUid 解析后注入 payload.__uid） */
async function submitGameScore(uid, payload) {
  const gameKey = String(payload.gameKey || '');
  if (!GAME_KEYS.includes(gameKey)) throw httpError('未知的游戏类型', 400);

  const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const merit = gameMerit(gameKey, raw);
  if (merit <= 0) throw httpError('本次成绩无效', 400);

  const db = inboxDb();
  const nickname = (await gameNicknameOf(db, uid)) || '无名士兵';

  // 每日提交上限，防脚本刷榜
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = gameRows(
    assertDbResult(
      await db
        .from('game_scores')
        .select('id')
        .eq('uid', uid)
        .eq('game_key', gameKey)
        .gte('created_at', startOfDay.toISOString())
    )
  );
  if (today.length >= SCORE_DAILY_LIMIT) throw httpError('今日提交次数已达上限，明天再来', 429);

  const now = new Date().toISOString();
  assertDbResult(
    await db.from('game_scores').insert({
      uid,
      nickname,
      game_key: gameKey,
      merit,
      raw_score: raw,
      created_at: now,
    })
  );

  const existing = gameRows(
    assertDbResult(await db.from('game_best').select('merit,raw_score').eq('uid', uid).eq('game_key', gameKey).limit(1))
  );
  const prev = existing[0];
  const previousTime = numGame(prev && prev.raw_score && prev.raw_score.timeUsedSeconds);
  const currentTime = numGame(raw.timeUsedSeconds);
  const improved = gameKey === 'lihan'
    ? (!prev || currentTime > 0 && (!previousTime || currentTime < previousTime))
    : (!prev || merit > prev.merit);

  if (improved) {
    const record = { uid, game_key: gameKey, merit, raw_score: raw, achieved_at: now };
    if (prev) {
      assertDbResult(await db.from('game_best').update(record).eq('uid', uid).eq('game_key', gameKey));
    } else {
      assertDbResult(await db.from('game_best').insert(record));
    }
  }

  return { ok: true, merit, improved, best: improved ? merit : prev.merit };
}

async function handle(action, payload) {
  switch (action) {
    // 头号玩家排行榜：读榜公开，提分需登录（uid 走 authUid → app_users.id）
    case 'leaderboard': return readLeaderboard(payload.__uid);
    case 'submitScore': return submitGameScore(payload.__uid, payload);

    case 'submitNovel': return submitToInbox('novel', payload);
    case 'submitContact': return submitToInbox('contact', payload);

    // 商业定制需求函：不经收件箱/管理后台，直接邮件中继到站长邮箱
    case 'submitCustomOrderEmail': {
      const name = String(payload.name || '').trim().slice(0, 60) || '某同好委托人';
      const email = String(payload.email || '').trim().slice(0, 120);
      const content = String(payload.content || '').trim().slice(0, 5000);
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) throw httpError('委托人邮箱格式无效', 400);
      if (!content) throw httpError('需求描述不能为空', 400);
      const OWNER_EMAIL = 'luna721yue@gmail.com';
      const dateStr = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
      const controller = new AbortController();
      const killTimer = setTimeout(() => controller.abort(), 12000);
      let resp;
      try {
        resp = await fetch(`https://formsubmit.co/ajax/${OWNER_EMAIL}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            // FormSubmit 要求请求来自网页（带 Origin/Referer），否则拒绝中继
            'Origin': 'https://www.levihan.asia',
            'Referer': 'https://www.levihan.asia/',
          },
          signal: controller.signal,
          body: JSON.stringify({
            _subject: `【利韩土豆仓 · 商业定制需求】${name}`,
            _replyto: email,
            _template: 'table',
            _captcha: 'false',
            '委托人称呼': name,
            '委托人邮箱': email,
            '提交时间': dateStr,
            '需求与周期构想': content,
          }),
        });
      } finally {
        clearTimeout(killTimer);
      }
      if (!resp.ok) throw httpError('邮件中继通道暂不可用', 502);
      const data = await resp.json().catch(() => ({}));
      if (String(data.success) !== 'true') {
        const msg = String(data.message || '');
        // FormSubmit 首次使用需站长点击激活邮件；激活前返回友好提示
        if (/Activation/i.test(msg)) throw httpError('邮箱通道初始化中，请稍后再试', 503);
        throw httpError('邮件中继被拒：' + msg.slice(0, 120), 502);
      }
      return { ok: true, delivered: 'email' };
    }

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

    case 'linkPreview': {
      // 归一化 + 危险协议拦截都在 buildLinkPreview 内做，这里不再前置 isSafeExternalUrl
      // （否则 bilibili:// 等 App 分享链接会在补 https 之前被挡死）
      const preview = await buildLinkPreview(String(payload.url || '').trim());
      return { ok: true, preview };
    }

    case 'forumList': return { ok: true, posts: await readForum() };

    case 'forumTodayRelay': {
      const since = Number(payload.since);
      const start = Number.isFinite(since) && since > 0 ? since : Date.now() - 86400000;
      const posts = (await readForum())
        .filter((post) => post && post.category === 'relay')
        .map((post) => ({
          id: post.id,
          category: 'relay',
          title: post.title,
          author: post.author,
          createdAt: post.createdAt,
          comments: (Array.isArray(post.comments) ? post.comments : [])
            .filter((comment) => Date.parse(comment.createdAt) >= start)
            .map((comment) => ({
              id: comment.id,
              author: comment.author,
              createdAt: comment.createdAt,
              relayStep: comment.relayStep,
            })),
        }))
        .filter((post) => Date.parse(post.createdAt) >= start || post.comments.length > 0);
      return { ok: true, posts };
    }

    case 'forumImageUpload': {
      const b64 = String(payload.imageBase64 || '');
      if (!b64 || Math.floor((b64.length * 3) / 4) > MAX_BYTES) throw httpError('WebP 图片转换后超过单次传输容量', 413);
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw httpError('仅支持 WebP 图片', 400);
      const key = `${FORUM_DIR}uploads/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`;
      await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: bytes, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000' });
      return { ok: true, url: `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}` };
    }

    case 'forumPublish': {
      const category = String(payload.category || 'chat').trim();
      if (!['chat', 'relay', 'roleplay', 'market', 'links'].includes(category)) throw httpError('帖子分类无效', 400);
      const title = String(payload.title || '').trim().slice(0, 100);
      const body = String(payload.body || '').trim().slice(0, 5000);
      const author = String(payload.author || '').trim().slice(0, 40);
      const prompt = String(payload.prompt || '').trim().slice(0, 2000);
      const characterName = String(payload.characterName || '').trim().slice(0, 40);
      const uploadedImages = Array.isArray(payload.images) ? payload.images : [];
      if (uploadedImages.length > 9) throw httpError('一条帖子最多上传 9 张图片', 400);
      const uploadPrefix = `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${FORUM_DIR}uploads/`;
      if (uploadedImages.some((url) => typeof url !== 'string' || !url.startsWith(uploadPrefix) || !/\.webp$/.test(url))) throw httpError('图片地址无效', 400);
      // 安利墙先落库，外站预览由 forumEnrichLink 在发布后补抓。
      let link;
      if (category === 'links') {
        const linkUrl = normalizeExternalLink(payload.linkUrl);
        if (!linkUrl) throw httpError('请粘贴网页链接或 App 分享链接', 400);
        if (isFetchableLink(linkUrl) && !isSafeExternalUrl(linkUrl)) throw httpError('仅支持公开的 http(s) 链接', 400);
        const detected = isFetchableLink(linkUrl) ? (detectLinkPlatform(linkUrl) || { platform: 'web', tier: 'B' }) : { platform: 'web', tier: 'C' };
        const supplied = payload.linkPreview && typeof payload.linkPreview === 'object' ? payload.linkPreview : null;
        const bvid = detected.platform === 'bilibili' ? extractBvid(linkUrl) : '';
        const coverUrl = supplied && isSafeExternalUrl(String(supplied.coverUrl || '')) ? String(supplied.coverUrl) : '';
        const ogTitle = supplied ? String(supplied.ogTitle || '').trim().slice(0, 200) : '';
        const ogDesc = supplied ? String(supplied.ogDesc || '').trim().slice(0, 500) : '';
        link = {
          url: linkUrl,
          platform: detected.platform,
          tier: supplied ? (detected.tier === 'A' && !bvid ? 'C' : detected.tier === 'B' && !ogTitle && !ogDesc && !coverUrl ? 'C' : detected.tier) : 'C',
          bvid: bvid || undefined,
          coverUrl: coverUrl || undefined,
          ogTitle: ogTitle || undefined,
          ogDesc: ogDesc || undefined,
          previewStatus: supplied ? (coverUrl || ogTitle || ogDesc ? 'ready' : 'unavailable') : 'pending',
        };
      }
      if (!author) throw httpError('昵称不能为空', 400);
      if (category !== 'links' && !body && !payload.imageBase64 && uploadedImages.length === 0) throw httpError('正文或图片不能为空', 400);
      const id = `post-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      let image = '';
      const b64 = String(payload.imageBase64 || '');
      if (b64) {
        if (Math.floor((b64.length * 3) / 4) > MAX_BYTES) throw httpError('帖子图片超过 4MB', 413);
        const mime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(payload.imageMime) ? payload.imageMime : 'image/webp';
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
        const key = `${FORUM_DIR}${id}.${ext}`;
        await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: Buffer.from(b64, 'base64'), ContentType: mime, CacheControl: 'public, max-age=31536000' });
        image = `https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}`;
      }
      if (category === 'links') {
        if (uploadedImages.length) link.uploadedImageUrls = uploadedImages;
        else if (image) link.uploadedImageUrl = image;
      }
      const posts = await readForum();
      const post = {
        id, category, author, title: category === 'links' ? (link.ogTitle || '') : title, body,
        uid: payload.__uid,
        prompt: prompt || undefined,
        characterName: characterName || undefined,
        characterImage: String(payload.characterImage || '').trim().slice(0, 500) || undefined,
        link,
        image: uploadedImages[0] || image, images: uploadedImages.length ? uploadedImages : undefined,
        potatoes: 0, potatoGiven: false,
        createdAt: new Date().toISOString(), comments: [],
      };
      posts.unshift(post); await writeForum(posts.slice(0, 300));
      // 故事接龙：建立接力即自动建立合订本，收入在线小说 novels.json
      if (category === 'relay') {
        try { await saveRelayNovel(compileRelayToNovel(post)); }
        catch (e) { console.error('[relay] 建立合订本失败', e && e.message); }
      }
      return { ok: true, post, posts };
    }

    case 'forumEnrichLink': {
      const id = String(payload.id || '').trim();
      const posts = await readForum();
      const post = posts.find((item) => item && item.id === id && item.category === 'links');
      if (!post) throw httpError('安利不存在', 404);
      if (post.uid !== payload.__uid && payload.__uid !== '__admin__') throw httpError('无权更新这条安利', 403);
      const originalUrl = post.link?.url;
      if (!originalUrl) throw httpError('安利链接缺失', 400);
      let preview;
      try { preview = await buildLinkPreview(originalUrl); }
      catch { preview = null; }
      if (preview) {
        // 抓取期间帖子可能已被编辑或删除；只合并链接字段，不覆盖上传图片。
        const latestPosts = await readForum();
        const latestPost = latestPosts.find((item) => item && item.id === id && item.category === 'links' && (item.uid === payload.__uid || payload.__uid === '__admin__'));
        if (!latestPost || latestPost.link?.url !== originalUrl) throw httpError('安利已变化', 409);
        latestPost.link = {
          ...latestPost.link,
          url: preview.url || originalUrl,
          platform: preview.platform || latestPost.link.platform,
          tier: preview.tier || 'C',
          bvid: preview.bvid || undefined,
          coverUrl: preview.coverUrl || undefined,
          ogTitle: String(preview.title || '').trim().slice(0, 200) || undefined,
          ogDesc: String(preview.description || '').trim().slice(0, 500) || undefined,
          previewStatus: preview.tier === 'C' ? 'unavailable' : 'ready',
        };
        latestPost.title = latestPost.link.ogTitle || '';
        await writeForum(latestPosts);
        return { ok: true, id, link: latestPost.link, title: latestPost.title };
      }
      post.link.previewStatus = 'unavailable';
      await writeForum(posts);
      return { ok: true, id, link: post.link, title: post.title || '' };
    }

    case 'forumComment': {
      const postId = String(payload.postId || '').trim();
      const rawBody = String(payload.body || '').trim();
      const author = String(payload.author || '').trim().slice(0, 40);
      if (!postId || !rawBody || !author) throw httpError('评论内容和昵称不能为空', 400);
      const posts = await readForum(); const post = posts.find((p) => p && p.id === postId);
      if (!post) throw httpError('帖子不存在', 404);
      // 接龙的「棒」是长篇正文（递交下限 500 字），上限给 5000；普通评论仍限 2000。
      // 09-21 事故：这里原来一律 slice(0,2000)，把用户 3146 字的第 2 棒静默截成半句话。
      const body = rawBody.slice(0, post.category === 'relay' ? 5000 : 2000);
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      const comment = {
        id: `comment-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        author, body, uid: payload.__uid, createdAt: new Date().toISOString(), potatoes: 0, potatoGiven: false,
      };
      if (payload.characterName) comment.characterName = String(payload.characterName).trim().slice(0, 40);
      if (payload.characterAvatar) comment.characterAvatar = String(payload.characterAvatar).trim().slice(0, 500);
      if (payload.isHost) comment.isHost = true;
      if (payload.relayStep) comment.relayStep = Number(payload.relayStep) || undefined;
      if (payload.wordCount) comment.wordCount = Number(payload.wordCount) || undefined;
      if (payload.diceRoll && typeof payload.diceRoll === 'object') {
        const dr = payload.diceRoll;
        comment.diceRoll = { sides: Number(dr.sides) || 6, value: Number(dr.value) || 0, verdict: String(dr.verdict || '').trim().slice(0, 200) || undefined };
      }
      post.comments.push(comment);
      // 故事接龙：递交接棒后立即释放羽毛笔，否则下次 forumList 会把锁还原回来（一直显示锁定/旧棒数）
      if (post.category === 'relay') post.quillClaim = undefined;
      await writeForum(posts);
      // 故事接龙：接棒后自动重编译，把最新一棒并入合订本
      if (post.category === 'relay') {
        try { await saveRelayNovel(compileRelayToNovel(post)); }
        catch (e) { console.error('[relay] 更新合订本失败', e && e.message); }
      }
      return { ok: true, posts };
    }

    case 'forumPotato': {
      const target = String(payload.target || '').trim();   // 'post' | 'comment'
      const id = String(payload.id || '').trim();
      const give = payload.give !== false;
      if (!id || !['post', 'comment'].includes(target)) throw httpError('参数无效', 400);
      const posts = await readForum();
      let hit = null;
      for (const p of posts) {
        if (target === 'post' && p && p.id === id) {
          hit = p; break;
        }
        if (target === 'comment' && p && Array.isArray(p.comments)) {
          const c = p.comments.find((x) => x && x.id === id);
          if (c) { hit = c; break; }
        }
      }
      if (!hit) throw httpError('目标不存在', 404);
      const voters = Array.isArray(hit.potatoVoters) ? hit.potatoVoters : [];
      const alreadyGiven = voters.includes(payload.__uid);
      if (give !== alreadyGiven) {
        hit.potatoVoters = give ? [...voters, payload.__uid] : voters.filter((uid) => uid !== payload.__uid);
        hit.potatoes = Math.max(0, (Number(hit.potatoes) || 0) + (give ? 1 : -1));
        await writeForum(posts);
      }
      return { ok: true, id, potatoes: Number(hit.potatoes) || 0, potatoGiven: give };
    }

    case 'forumClaim': {
      const postId = String(payload.postId || '').trim();
      const claimedBy = String(payload.claimedBy || '').trim().slice(0, 40);
      if (!postId || !claimedBy) throw httpError('参数无效', 400);
      const posts = await readForum(); const post = posts.find((p) => p && p.id === postId);
      if (!post) throw httpError('帖子不存在', 404);
      const nextStep = (Array.isArray(post.comments) ? post.comments.length : 0) + 2;
      post.quillClaim = {
        claimedBy, claimedAt: Date.now(),
        expiresAt: Date.now() + Number(payload.claimDurationMs || 86400000),
        relayStep: nextStep,
      };
      await writeForum(posts); return { ok: true, posts };
    }

    case 'forumReleaseClaim': {
      const postId = String(payload.postId || '').trim();
      const posts = await readForum(); const post = posts.find((p) => p && p.id === postId);
      if (!post) throw httpError('帖子不存在', 404);
      post.quillClaim = undefined;
      await writeForum(posts); return { ok: true, posts };
    }

    case 'forumDelete': {
      const id = String(payload.id || '').trim(); const posts = await readForum();
      const target = posts.find((p) => p && p.id === id);
      if (!target) throw httpError('帖子不存在', 404);
      if (target.uid && target.uid !== payload.__uid && payload.__uid !== '__admin__') throw httpError('只能删除自己发布的帖子', 403);
      const next = posts.filter((p) => p && p.id !== id); await writeForum(next);
      // 删除故事接龙帖子时，同步删除对应合订本
      if (target.category === 'relay') {
        try { await deleteRelayNovel(target.id); }
        catch (e) { console.error('[relay] 删除合订本失败', e && e.message); }
      }
      return { ok: true, posts: next };
    }

    case 'forumCommentDelete': {
      const posts = await readForum(); const post = posts.find((p) => p && p.id === String(payload.postId || ''));
      if (!post) throw httpError('帖子不存在', 404);
      const comment = (post.comments || []).find((c) => c && c.id === String(payload.commentId || ''));
      if (!comment) throw httpError('评论不存在', 404);
      if (comment.uid && comment.uid !== payload.__uid) throw httpError('只能删除自己发布的评论', 403);
      post.comments = (post.comments || []).filter((c) => c && c.id !== String(payload.commentId || ''));
      await writeForum(posts);
      if (post.category === 'relay') {
        try { await saveRelayNovel(compileRelayToNovel(post)); }
        catch (e) { console.error('[relay] 删除棒后更新合订本失败', e && e.message); }
      }
      return { ok: true, posts };
    }

    // 编辑帖子：目前仅开放故事接龙，且只能改自己发布的内容
    case 'forumEdit': {
      const id = String(payload.id || '').trim();
      const posts = await readForum();
      const post = posts.find((p) => p && p.id === id);
      if (!post) throw httpError('帖子不存在', 404);
      if (post.category !== 'relay') throw httpError('目前仅支持编辑故事接龙', 400);
      if (post.uid && post.uid !== payload.__uid) throw httpError('只能修改自己发布的接龙', 403);
      const nextTitle = payload.title !== undefined ? String(payload.title).trim().slice(0, 100) : undefined;
      const nextBody = payload.body !== undefined ? String(payload.body).trim().slice(0, 5000) : undefined;
      const nextPrompt = payload.prompt !== undefined ? String(payload.prompt).trim().slice(0, 2000) : undefined;
      if (nextBody !== undefined && !nextBody && !post.image) throw httpError('正文不能为空', 400);
      if (nextTitle !== undefined) post.title = nextTitle;
      if (nextBody !== undefined) post.body = nextBody;
      if (nextPrompt !== undefined) post.prompt = nextPrompt || undefined;
      post.editedAt = new Date().toISOString();
      await writeForum(posts);
      // 编辑接龙后同步重编译合订本
      try { await saveRelayNovel(compileRelayToNovel(post)); }
      catch (e) { console.error('[relay] 编辑后更新合订本失败', e && e.message); }
      return { ok: true, post, posts };
    }

    // 编辑接龙的某一棒（第 2 棒起存在 comments 里）：只能改自己写的，改完整本重编译
    case 'forumCommentEdit': {
      const postId = String(payload.postId || '').trim();
      const commentId = String(payload.commentId || '').trim();
      const nextBody = String(payload.body || '').trim().slice(0, 5000);
      if (!postId || !commentId) throw httpError('缺少帖子或棒的标识', 400);
      if (!nextBody) throw httpError('正文不能为空', 400);
      const posts = await readForum();
      const post = posts.find((p) => p && p.id === postId);
      if (!post) throw httpError('帖子不存在', 404);
      if (post.category !== 'relay') throw httpError('目前仅支持编辑故事接龙', 400);
      const comments = Array.isArray(post.comments) ? post.comments : [];
      const comment = comments.find((c) => c && c.id === commentId);
      if (!comment) throw httpError('这一棒不存在', 404);
      if (comment.uid && comment.uid !== payload.__uid && payload.__uid !== '__admin__') {
        throw httpError('只能修改自己写的接龙', 403);
      }
      comment.body = nextBody;
      comment.wordCount = nextBody.length;
      comment.editedAt = new Date().toISOString();
      post.comments = comments;
      await writeForum(posts);
      // 改的是接龙里的某一棒 ⇒ 合订本同步重编译（后续他人的棒保留，不受影响）
      try { await saveRelayNovel(compileRelayToNovel(post)); }
      catch (e) { console.error('[relay] 编辑棒后更新合订本失败', e && e.message); }
      return { ok: true, comment, posts };
    }

    // 维护动作（需管理员 token）：清理接龙残留锁——认领的棒已递交或认领已过期却没释放
    case 'forumFixStaleClaims': {
      const posts = await readForum();
      const ts = Date.now();
      const fixed = [];
      for (const p of posts) {
        if (!p || p.category !== 'relay' || !p.quillClaim) continue;
        const commentCount = Array.isArray(p.comments) ? p.comments.length : 0;
        const stale = (Number(p.quillClaim.relayStep) || 0) <= commentCount + 1 || p.quillClaim.expiresAt <= ts;
        if (stale) {
          fixed.push({ id: p.id, step: p.quillClaim.relayStep, claimedBy: p.quillClaim.claimedBy });
          p.quillClaim = undefined;
        }
      }
      if (fixed.length) await writeForum(posts);
      return { ok: true, fixed };
    }

    case 'marketList': return { ok: true, items: await readMarket() };

    case 'marketPublish': {
      const title = String(payload.title || '').trim().slice(0, 100);
      const price = Number(payload.price);
      const link = String(payload.link || '').trim().slice(0, 500);
      const description = String(payload.description || '').trim().slice(0, 2000);
      const nickname = String(payload.nickname || '').trim().slice(0, 40) || '匿名同好';
      if (!title) throw httpError('商品名称不能为空', 400);
      if (Number.isNaN(price) || price < 0) throw httpError('价格不合法', 400);
      if (!/^https?:\/\//i.test(link)) throw httpError('购买链接必须以 http(s) 开头', 400);
      const images = Array.isArray(payload.images) ? payload.images.map((x) => String(x)).filter(Boolean).slice(0, MARKET_MAX_IMAGES) : [];
      if (!images.length) throw httpError('至少需要一张商品图片', 400);
      const id = `item-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const urls = [];
      for (let i = 0; i < images.length; i++) {
        const src = images[i];
        if (src.startsWith('data:')) {
          const b64 = src.includes(',') ? src.slice(src.indexOf(',') + 1) : '';
          if (!b64) continue;
          if (Math.floor((b64.length * 3) / 4) > MAX_BYTES) throw httpError('商品图片超过 4MB', 413);
          const key = `${MARKET_DIR}${id}-${i}.webp`;
          await putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: Buffer.from(b64, 'base64'), ContentType: 'image/webp', CacheControl: 'public, max-age=31536000' });
          urls.push(`https://${BUCKET}.cos-website.${REGION}.myqcloud.com/${key}`);
        } else {
          urls.push(src);
        }
      }
      const item = {
        id, type: String(payload.type || '').trim().slice(0, 20) || undefined,
        title, price, image: urls[0] || '', images: urls, link, description,
        nickname, uid: payload.__uid, date: new Date().toISOString().split('T')[0],
      };
      const items = await readMarket();
      items.unshift(item); await writeMarket(items.slice(0, MAX_MARKET_ITEMS));
      return { ok: true, item, items };
    }

    case 'marketDelete': {
      const id = String(payload.id || '').trim();
      if (!id) throw httpError('商品 ID 无效', 400);
      const items = await readMarket();
      const target = items.find((x) => x && x.id === id);
      if (!target) throw httpError('商品不存在', 404);
      if (target.uid && target.uid !== payload.__uid) throw httpError('只能删除自己发布的商品', 403);
      const next = items.filter((x) => x && x.id !== id);
      await writeMarket(next);
      return { ok: true, items: next };
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

    case 'novelDirectPublish': {
      /* 用户投稿免审直发（2026-09-21 取消文稿审核）：登录用户提交后立即上架。
         敏感篇（sensitive=true）正文落 novels_vault/{id}_secure.txt 密文，novels.json 标记 encrypted:true；
         普通篇（默认）正文落 novels/{id}.txt 明文，标记 encrypted:false。 */
      const sensitive = payload.sensitive === true;
      const text = String(payload.body || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
      if (!text.trim()) throw httpError('正文不能为空', 400);
      if (text.length > MAX_NOVEL_CHARS) throw httpError(`正文超过 ${MAX_NOVEL_CHARS} 字上限`, 413);
      const title = String(payload.title || '').trim();
      const author = String(payload.author || '').trim();
      if (!title || title.length > 120 || !author || author.length > 80) throw httpError('请填写有效的标题和作者', 400);
      const authorUrl = String(payload.authorUrl || '').trim().slice(0, 300);
      if (authorUrl) {
        let parsed;
        try { parsed = new URL(authorUrl); } catch { throw httpError('作者主页链接不是有效网址', 400); }
        if (!['https:', 'http:'].includes(parsed.protocol)) throw httpError('作者主页链接只支持 HTTP(S)', 400);
      }
      const authorNote = String(payload.authorNote || '').trim().slice(0, 2000);
      const warning = String(payload.warning || '').trim().slice(0, 100);
      const rawTags = Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(/[,，]/);
      const tags = rawTags.map((t) => String(t == null ? '' : t).trim()).filter(Boolean).slice(0, 20);

      const novelId = 'nv-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
      await writeNovelBody(novelId, text, sensitive);

      const meta = normalizeNovelMeta({ id: novelId, title, author, authorUrl, authorNote, warning, tags }, text.length);
      meta.encrypted = sensitive;
      /* 记下作者 uid：前台「编辑自己的小说」靠它做服务端归属校验（历史旧篇没有 uid，只能管理员改） */
      meta.uid = payload.__uid;
      const novels = await readNovels();
      novels.unshift(meta);
      novels.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      await writeNovels(novels);
      try { await upsertAuthor(meta.author, meta.authorUrl); } catch (e) { console.error('[authorLib] 登记失败', e && e.message); }
      return { ok: true, novel: meta, count: novels.length, novels };
    }

    case 'novelSave': {
      const text = String(payload.body || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
      if (!text.trim()) throw httpError('正文不能为空', 400);
      if (text.length > MAX_NOVEL_CHARS) throw httpError(`正文超过 ${MAX_NOVEL_CHARS} 字上限`, 413);

      const novels = await readNovels();
      const idx = novels.findIndex((n) => n && n.id === String(payload.id || '').trim());
      const existing = idx >= 0 ? novels[idx] : null;
      /* 敏感标记：显式传 sensitive 以它为准；没传则沿用原篇加密状态 ——
         后台编辑一篇加密小说时若不传，绝不能悄悄转成明文落桶 */
      const sensitive =
        payload.sensitive === true ||
        (payload.sensitive === undefined && Boolean(existing && existing.encrypted));

      const meta = pruneEmptyNovelFields(normalizeNovelMeta(payload, text.length));
      // 旧篇的 uid / 接龙编译字段等一并保留，否则一次编辑就会把它们抹掉
      const next = existing ? { ...existing, ...meta } : meta;
      next.chars = text.length;
      next.encrypted = sensitive;
      next.updatedAt = new Date().toISOString();
      if (existing) {
        next.createdAt = existing.createdAt || next.createdAt;
        if (existing.uid) next.uid = existing.uid;   // 作者归属不变，前台作者仍可继续编辑
      }
      pruneEmptyNovelFields(next);

      await writeNovelBody(next.id, text, sensitive);
      if (idx >= 0) novels[idx] = next;
      else novels.unshift(next);
      novels.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      await writeNovels(novels);

      // 在线小说同样自动登记作者链接
      try { await upsertAuthor(next.author, next.authorUrl); } catch (e) { console.error('[authorLib] 登记失败', e && e.message); }

      return { ok: true, replaced: Boolean(existing), novel: next, count: novels.length, novels };
    }

    /** 用户自助编辑自己上传的小说（需登录 + uid 归属校验） */
    case 'novelUpdate': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      const text = String(payload.body || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
      if (!text.trim()) throw httpError('正文不能为空', 400);
      if (text.length > MAX_NOVEL_CHARS) throw httpError(`正文超过 ${MAX_NOVEL_CHARS} 字上限`, 413);
      const title = String(payload.title || '').trim();
      const author = String(payload.author || '').trim();
      if (!title || title.length > 120 || !author || author.length > 80) throw httpError('请填写有效的标题和作者', 400);
      const authorUrl = String(payload.authorUrl || '').trim().slice(0, 300);
      if (authorUrl) {
        let parsed;
        try { parsed = new URL(authorUrl); } catch { throw httpError('作者主页链接不是有效网址', 400); }
        if (!['https:', 'http:'].includes(parsed.protocol)) throw httpError('作者主页链接只支持 HTTP(S)', 400);
      }

      const novels = await readNovels();
      const idx = novels.findIndex((n) => n && n.id === id);
      if (idx < 0) throw httpError('小说不存在或已被删除', 404);
      const cur = novels[idx];
      if (cur.isRelayCompiled) throw httpError('接龙合订本由茶会接龙自动编译，请编辑对应的接龙帖子', 400);
      if (!cur.uid) throw httpError('这篇发布于编辑功能上线前，请由管理员在后台修改', 403);
      if (cur.uid !== payload.__uid) throw httpError('只能编辑自己上传的小说', 403);

      const sensitive = payload.sensitive === true;
      const meta = pruneEmptyNovelFields(normalizeNovelMeta({ ...payload, id }, text.length));
      const next = { ...cur, ...meta };
      next.chars = text.length;
      next.encrypted = sensitive;
      next.uid = cur.uid;
      next.createdAt = cur.createdAt || meta.createdAt;
      next.updatedAt = new Date().toISOString();
      pruneEmptyNovelFields(next);

      await writeNovelBody(id, text, sensitive);
      novels[idx] = next;
      novels.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      await writeNovels(novels);
      try { await upsertAuthor(next.author, next.authorUrl); } catch (e) { console.error('[authorLib] 登记失败', e && e.message); }
      return { ok: true, novel: next, count: novels.length, novels };
    }

    /** 后台编辑回填：返回元数据 + 明文正文（加密篇服务端解密，后台无需感知密钥） */
    case 'novelGet': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      const novels = await readNovels();
      const novel = novels.find((n) => n && n.id === id);
      if (!novel) throw httpError('小说不存在', 404);
      const body = await readNovelBodyText(novel);
      return { ok: true, novel, body };
    }

    /**
     * 前台阅读器取正文（需登录）：加密篇在服务端解密后返回明文，
     * 密钥不再下发到前端 bundle，密文直链也不再被阅读器直接 fetch。
     * 普通篇（未加密）也统一走这里，行为一致。
     */
    case 'novelBody': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      const novels = await readNovels();
      const novel = novels.find((n) => n && n.id === id);
      if (!novel) throw httpError('小说不存在或已被删除', 404);
      const body = await readNovelBodyText(novel);
      return { ok: true, id, encrypted: novel.encrypted === true, body };
    }

    /* -------- 小说评论区（novel_comments/{id}.json，读公开、写需登录） -------- */

    case 'novelCommentList': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      return { ok: true, comments: await readNovelComments(id) };
    }

    case 'novelCommentAdd': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      const body = String(payload.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
      if (!body) throw httpError('评论内容不能为空', 400);
      const author = String(payload.author || '').trim().slice(0, 40);
      if (!author) throw httpError('昵称不能为空', 400);
      const novels = await readNovels();
      if (!novels.some((n) => n && n.id === id)) throw httpError('小说不存在或已被删除', 404);

      const list = await readNovelComments(id);
      const comment = {
        id: `nc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        author,
        body,
        uid: payload.__uid,
        createdAt: new Date().toISOString(),
      };
      const next = list.concat([comment]).slice(-MAX_NOVEL_COMMENTS);
      await writeNovelComments(id, next);
      return { ok: true, comment, comments: next };
    }

    case 'novelCommentDelete': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);
      const commentId = String(payload.commentId || '').trim();
      const list = await readNovelComments(id);
      const hit = list.find((c) => c && c.id === commentId);
      if (!hit) throw httpError('评论不存在', 404);
      // __admin__ 由路由层在「管理员令牌通过校验」时注入；普通用户只能删自己的
      const isAdmin = payload.__uid === '__admin__';
      if (!isAdmin && hit.uid && hit.uid !== payload.__uid) throw httpError('只能删除自己的评论', 403);
      const next = list.filter((c) => c && c.id !== commentId);
      await writeNovelComments(id, next);
      return { ok: true, comments: next };
    }

    case 'novelDelete': {
      const id = String(payload.id || '').trim();
      if (!NOVEL_ID_RE.test(id)) throw httpError('非法小说 ID', 400);

      const novels = await readNovels();
      const next = novels.filter((n) => n && n.id !== id);
      /* 明文与密文两个落点、评论区一起清 —— 只删明文会给加密篇留孤儿密文 */
      await deleteMultipleObject({
        Bucket: BUCKET,
        Region: REGION,
        Objects: [
          { Key: `${NOVEL_DIR}${id}.txt` },
          { Key: `${NOVEL_VAULT_DIR}${id}_secure.txt` },
          { Key: `${NOVEL_COMMENTS_DIR}${id}.json` },
        ],
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

    /* -------- 深度加密密文（comic_vault/）：前缀后缀固定，只收纯文本密文 -------- */

    /**
     * 单次上传密文。适合 ≤ MAX_BYTES 的密文，无需分片。
     * 与 action:'upload' 的差别：只放行 comic_vault/ + *_secure.txt，
     * 不接受客户端指定 ContentType（密文一律按纯文本存，附带属性不参与解密）。
     */
    case 'vaultUpload': {
      const key = assertVaultKey(payload.key);
      const body = Buffer.from(assertCipherText(payload.dataText), 'utf8');
      await putObject({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: body,
        ContentType: VAULT_CIPHER_TYPE,
        CacheControl: VAULT_CACHE_CONTROL,
      });
      return { ok: true, key, bytes: body.length, mode: 'single' };
    }

    /** 初始化分片上传，返回 UploadId 供后续 vaultPart / vaultComplete 使用 */
    case 'vaultInit': {
      const key = assertVaultKey(payload.key);
      const data = await multipartInit({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        ContentType: VAULT_CIPHER_TYPE,
        CacheControl: VAULT_CACHE_CONTROL,
      });
      const uploadId = data && (data.UploadId || data.uploadId);
      if (!uploadId) throw httpError('COS 未返回 UploadId，分片初始化失败', 502);
      return { ok: true, key, uploadId, mode: 'multipart' };
    }

    /**
     * 上传单个分片。分片按密文**文本字节**切分（不是先解密再切），
     * 因此各分片原样拼接即为完整密文，客户端无需任何重组逻辑。
     * COS 要求除最后一个分片外每片 ≥1MB，由前端 VAULT_PART_BYTES 保证。
     */
    case 'vaultPart': {
      const key = assertVaultKey(payload.key);
      const uploadId = assertUploadId(payload.uploadId);
      const partNumber = assertPartNumber(payload.partNumber);
      const body = Buffer.from(assertCipherText(payload.dataText), 'utf8');
      const data = await multipartUpload({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
      });
      const etag = data && (data.ETag || data.etag);
      if (!etag) throw httpError(`分片 ${partNumber} 上传后未返回 ETag`, 502);
      return { ok: true, key, uploadId, partNumber, etag, bytes: body.length };
    }

    /** 合并全部分片为一个对象 */
    case 'vaultComplete': {
      const key = assertVaultKey(payload.key);
      const uploadId = assertUploadId(payload.uploadId);
      const raw = Array.isArray(payload.parts) ? payload.parts : null;
      if (!raw || !raw.length) throw httpError('parts 必须是非空数组', 400);

      const parts = raw
        .map((p) => ({ PartNumber: assertPartNumber(p && p.partNumber), ETag: String((p && p.etag) || '').trim() }))
        .sort((a, b) => a.PartNumber - b.PartNumber);

      if (parts.some((p) => !p.ETag)) throw httpError('每个分片都必须带 etag', 400);
      // 分片号必须从 1 起且连续，否则 COS 会拒绝或产出空洞对象
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].PartNumber !== i + 1) throw httpError('分片号必须从 1 开始且连续', 400);
      }

      const data = await multipartComplete({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        UploadId: uploadId,
        Parts: parts,
      });
      return {
        ok: true,
        key,
        mode: 'multipart',
        parts: parts.length,
        etag: (data && (data.ETag || data.etag)) || '',
      };
    }

    /**
     * 中止分片上传并清理已上传的分片。
     * 分片失败若不清理，残片会一直占存储且不可见，所以前端必须兜住这一步。
     */
    case 'vaultAbort': {
      const key = assertVaultKey(payload.key);
      const uploadId = assertUploadId(payload.uploadId);
      await multipartAbort({ Bucket: BUCKET, Region: REGION, Key: key, UploadId: uploadId });
      return { ok: true, key, aborted: true };
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization',
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
  const bearer = req.headers['authorization'] || req.headers['Authorization'] || '';

  try {
    // 论坛/市集：发布/评论/点赞/认领/删除需登录（用户身份），读操作公开
    if (USER_ACTIONS.has(action)) {
      payload.__uid = await authUid(bearer);
      if (!payload.__uid) throw httpError('请先登录账号', 401);
    } else if (USER_OR_ADMIN_ACTIONS.has(action)) {
      // 用户会话或管理员令牌任一通过即可；管理员以 __admin__ 身份放行（可删任意评论）
      payload.__uid = await authUid(bearer);
      if (!payload.__uid && verifyToken(token)) payload.__uid = '__admin__';
      if (!payload.__uid) throw httpError('请先登录账号', 401);
    } else if (action === 'leaderboard' || action === 'forumList') {
      // 读榜公开：带 Bearer 时顺带算出「我的战绩」，拿不到身份就当游客（不报错）
      payload.__uid = await authUid(bearer);
    } else if (!PUBLIC_ACTIONS.has(action) && !verifyToken(token)) {
      throw httpError('未授权或登录已过期，请重新登录', 401);
    }
    send(res, 200, forumResultView(await handle(action, payload), payload.__uid), origin);
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
  const bearer = headers['authorization'] || headers['Authorization'] || '';

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
    if (USER_ACTIONS.has(action)) {
      payload.__uid = await authUid(bearer);
      if (!payload.__uid) throw httpError('请先登录账号', 401);
    } else if (USER_OR_ADMIN_ACTIONS.has(action)) {
      payload.__uid = await authUid(bearer);
      if (!payload.__uid && verifyToken(token)) payload.__uid = '__admin__';
      if (!payload.__uid) throw httpError('请先登录账号', 401);
    } else if (action === 'leaderboard' || action === 'forumList') {
      // 读榜公开：带 Bearer 时顺带算出「我的战绩」，拿不到身份就当游客（不报错）
      payload.__uid = await authUid(bearer);
    } else if (!PUBLIC_ACTIONS.has(action) && !verifyToken(token)) {
      throw httpError('未授权或登录已过期，请重新登录', 401);
    }
    return respond(200, forumResultView(await handle(action, payload), payload.__uid));
  } catch (err) {
    const status = (err && err.httpStatus) || 500;
    return respond(status, { ok: false, error: (err && err.message) || String(err), status });
  }
};
