/**
 * 周边橱窗上架脚本：本地 goods-src/*.png → 腾讯云 COS 的 goods/ 目录 + goods/manifest.json
 *
 * 为什么图片走 COS 而不是放进仓库：
 *   仓库里的静态资源会被 Vite 打进构建产物、还会被 Workbox 预缓存（2 MiB 上限），
 *   几十张 PNG 足以把构建打挂，也让每个访客白下载。放 COS 之后：
 *   - 仓库只留代码，构建产物不变大，首屏零影响；
 *   - 前台列表只加载 COS 现场生成的缩略图（?imageMogr2/thumbnail/420x），
 *     原图只在点「⬇ 下载」时才取 —— 这就是「不占内存」的实现方式。
 *
 * 用法：
 *   1) 把 PNG 丢进 vercel-version/goods-src/     ← 文件名（去扩展名）就是橱窗里的展示名
 *   2) npm run sync:goods                        ← 全量上传 + 重建清单
 *      只上架某几个文件：npm run sync:goods -- 立牌.png 挂件.png
 *      只生成本地清单不上传：npm run sync:goods -- --dry
 *   3) 前台「巨人资源 → 周边橱窗」刷新即见（清单 no-store，图片 7 天缓存）
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

/** PNG 尺寸直接从 IHDR 读，不引第三方库：签名(8) + 长度(4) + 类型(4) + 宽(4) + 高(4) */
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function titleOf(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

// 目录不存在就建出来（首次上货时用户只需把图丢进去，不用先手动 mkdir）
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
  console.log(`✓ 已创建目录 ${path.relative(process.cwd(), srcDir)}/，把周边 PNG 放进去再跑一次。`);
  process.exit(0);
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

console.log(`📦 待上架 ${files.length} 张：${files.join('、')}`);

const entries = [];
for (const file of files) {
  const full = path.join(srcDir, file);
  const buf = fs.readFileSync(full);
  const size = path.extname(file).toLowerCase() === '.png' ? pngSize(buf) : null;
  entries.push({
    file,
    title: titleOf(file),
    bytes: buf.length,
    ...(size ? { width: size.width, height: size.height } : {}),
  });
}

const manifest = JSON.stringify(entries, null, 2);
fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log(`✓ 已生成清单 ${path.relative(process.cwd(), manifestPath)}（${entries.length} 条）`);

if (dryRun) {
  console.log('ℹ️  --dry：只生成本地清单，未上传。');
  entries.forEach((e) =>
    console.log(`   - ${e.file}  ${e.width && e.height ? `${e.width}×${e.height} ` : ''}${Math.round(e.bytes / 1024)} KB`),
  );
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
