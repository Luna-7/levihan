/**
 * 周边橱窗上架脚本：本地 goods-src/*.(png|webp|jpg|avif) → 腾讯云 COS 的 goods/ 目录 + goods/manifest.json
 *
 * 为什么图片走 COS 而不是放进仓库：
 *   仓库里的静态资源会被 Vite 打进构建产物、还会被 Workbox 预缓存（2 MiB 上限），
 *   几十张 PNG 足以把构建打挂，也让每个访客白下载。放 COS 之后：
 *   - 仓库只留代码，构建产物不变大，首屏零影响；
 *   - 前台列表只加载 COS 现场生成的缩略图（?imageMogr2/thumbnail/420x），
 *     原图只在点「⬇ 下载」时才取 —— 这就是「不占内存」的实现方式。
 *
 * 用法：
 *   1) 把图片丢进 vercel-version/goods-src/
 *   2) npm run sync:goods                        ← 全量上传 + 重建清单
 *      只上架某几个文件：npm run sync:goods -- 立牌.png 挂件.png
 *      只生成本地清单不上传：npm run sync:goods -- --dry
 *   3) 前台「巨人资源 → 周边橱窗」刷新即见（清单 no-store，图片 7 天缓存）
 *
 * 关于「名字」：
 *   周边图往往没有名字，看到的只有图 —— 所以 title 是**可选**的。
 *   - 文件名有意义（如 `韩吉立牌.png`）→ 自动当展示名；
 *   - 文件名是相机/微信/截图默认名（`IMG_4521`、`微信图片_2024...`、`Screenshot_...`、纯数字、纯 hash…）
 *     → **不写 title**，前台就是纯图墙，不留一行没用的字；
 *   - 想给某几张补名字：在 goods-src/titles.json 里写 { "IMG_4521.png": "韩吉立牌" }，只补想补的。
 *
 * 凭证复用 .env 的 COS_SECRET_ID / COS_SECRET_KEY（与 npm run sync:archive 同一套）。
 * ⚠️ 换图请**改文件名**：同名覆盖后，老访客最长 7 天里仍会看到旧图（图片带缓存头）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

const BUCKET = 'levihan-1325571558';
const REGION = 'ap-nanjing';
const ENDPOINT = 'https://cos.ap-nanjing.myqcloud.com';
const CDN_BASE = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com';

/** 图片缓存 7 天：够省流量，换图后又不至于让老访客卡在旧图上（清单本身 no-store，即时生效） */
const IMAGE_CACHE = 'public, max-age=604800';

const IMAGE_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg', '.avif']);
const CONTENT_TYPE = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const only = args.filter((a) => !a.startsWith('--'));

const srcDir = path.resolve('goods-src');
const manifestPath = path.join(srcDir, 'manifest.json');
const titlesPath = path.join(srcDir, 'titles.json');

/* ------------------------------------------------------------------ */
/* 尺寸读取：只为「占位比例正确 + 请求宽度不放大」，不引第三方库         */
/* ------------------------------------------------------------------ */
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    // SOF0..SOF15（跳过 DHT 0xC4 / JPG 0xC8 / DAC 0xCC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    off += 2 + buf.readUInt16BE(off + 2);
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    // 扩展格式：canvas 宽高各 3 字节（little-endian，值 = 实际 - 1）
    return { width: (buf.readUIntLE(24, 3) + 1), height: (buf.readUIntLE(27, 3) + 1) };
  }
  if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readSize(buf) {
  try {
    // 按文件头嗅探，不信扩展名 —— 用户把 jpg 存成 .png 是常事
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
      return pngSize(buf);
    }
    if (buf.length > 4 && buf.readUInt16BE(0) === 0xffd8) return jpegSize(buf);
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      return webpSize(buf);
    }
  } catch {
    /* 解析失败就当拿不到尺寸，不影响上架 */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 名字判定：没有名字是常态，不要把相机默认名当展示名                    */
/* ------------------------------------------------------------------ */
const MEANINGLESS = [
  /^img[_-]?\d+$/i,
  /^dsc[_-]?\d+$/i,
  /^dscn\d+$/i,
  /^photo[_-]?\d+$/i,
  /^pic[_-]?\d+$/i,
  /^image[_-]?\d*$/i,
  /^screenshot/i,             // Screenshot 2024-09-24 at 14.30 / Screenshot_20240924-143012
  /^screen ?shot/i,
  /^shottr/i,                 // 截图工具默认名
  /^clean ?shot/i,
  /^微信图片[_-]?[\d_]*$/i,
  /^微信截图[_-]?[\d_]*$/i,
  /^截屏[_-]?[\d\-_.]*$/i,
  /^截图[_-]?[\d\-_.]*$/i,
  /^屏幕截图[\d\-_.]*$/i,
  /^屏幕快照[\d\-_.]*$/i,
  /^untitled[_-]?\d*$/i,
  /^无标题[\d\-_.]*$/i,
  /^\d+$/,                    // 纯数字（1、001…）
  /^\d{8,}([_-]\d+)?$/,       // 时间戳：20240924 / 20240924_143012
  /^[0-9a-f]{8,}$/i,          // 纯 hash
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, // uuid 开头
];

function looksMeaningless(base) {
  const t = base.trim();
  return t.length === 0 || MEANINGLESS.some((re) => re.test(t));
}

function baseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

/* ------------------------------------------------------------------ */

// 目录不存在就建出来（首次上货时用户只需把图丢进去，不用先手动 mkdir）
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
  console.log(`✓ 已创建目录 ${path.relative(process.cwd(), srcDir)}/，把周边图片放进去再跑一次。`);
  process.exit(0);
}

/** 可选的名字补充表：{ "IMG_4521.png": "韩吉立牌" } —— 只补想补的，其余保持无名字 */
let titleMap = {};
if (fs.existsSync(titlesPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(titlesPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) titleMap = parsed;
    else console.warn('⚠️ titles.json 不是「文件名 → 名字」的对象，已忽略');
  } catch (e) {
    console.warn(`⚠️ titles.json 解析失败（${e.message}），已忽略`);
  }
}

const files = fs
  .readdirSync(srcDir)
  .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
  .filter((f) => !f.startsWith('.'))
  .filter((f) => only.length === 0 || only.includes(f))
  // 按名称自然排序（数字按数值比），保证橱窗里的顺序稳定可控
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));

if (files.length === 0) {
  console.error('✗ goods-src/ 里没有图片（支持 png / webp / jpg / avif）');
  process.exit(1);
}

const entries = [];
const named = [];
let noSize = 0;
for (const file of files) {
  const buf = fs.readFileSync(path.join(srcDir, file));
  const explicit = typeof titleMap[file] === 'string' ? titleMap[file].trim() : '';
  const base = baseName(file);
  const title = explicit || (looksMeaningless(base) ? '' : base);
  const size = readSize(buf);
  if (!size) noSize++;

  const entry = {
    file,
    bytes: buf.length,
    ...(title ? { title } : {}),
    ...(size ? { width: size.width, height: size.height } : {}),
  };
  entries.push(entry);
  if (title) named.push(`${file} → 「${title}」`);
}

console.log(`📦 待上架 ${files.length} 张：`);
for (const e of entries) {
  const dim = e.width && e.height ? `${e.width}×${e.height}` : '尺寸未知';
  const name = e.title ? `「${e.title}」` : '（无名字，纯图展示）';
  console.log(`   - ${e.file}  ${dim}  ${Math.round(e.bytes / 1024)} KB  ${name}`);
}
console.log(`   带名字 ${named.length} 张 / 无名字 ${entries.length - named.length} 张`);
if (noSize > 0) {
  console.log(`   ℹ️ ${noSize} 张读不出尺寸（avif 等），前台会按 3:4 占位，不影响上架`);
}

const manifest = JSON.stringify(entries, null, 2);
fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log(`✓ 已生成清单 ${path.relative(process.cwd(), manifestPath)}（${entries.length} 条）`);

if (dryRun) {
  console.log('ℹ️  --dry：只生成本地清单，未上传。');
  process.exit(0);
}

const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;
if (!secretId || !secretKey) {
  console.warn('⚠ 未配置 COS_SECRET_ID / COS_SECRET_KEY（.env），只生成了本地清单、未上传。');
  console.warn('  配置密钥后再跑一次即可上架。');
  process.exit(0);
}

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: secretId, secretAccessKey: secretKey },
});

try {
  for (const file of files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `goods/${file}`,
        Body: fs.readFileSync(path.join(srcDir, file)),
        ContentType: CONTENT_TYPE[path.extname(file).toLowerCase()] || 'application/octet-stream',
        CacheControl: IMAGE_CACHE,
      }),
    );
    console.log(`  ✓ goods/${file}`);
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'goods/manifest.json',
      Body: manifest,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-cache',
    }),
  );

  console.log(`\n✅ 上架完成：${files.length} 张图 + goods/manifest.json`);
  console.log(`   清单地址：${CDN_BASE}/goods/manifest.json`);
  console.log(`   抽查一张：${CDN_BASE}/goods/${encodeURIComponent(files[0])}`);
  console.log('   前台「巨人资源 → 周边橱窗」刷新即可看到。');
} catch (err) {
  console.error('✗ 上传失败：', err?.message || err);
  process.exit(1);
}
