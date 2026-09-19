/**
 * 土豆粮仓归档同步脚本：表格 CSV → archive.json → 腾讯云 COS
 *
 * 联动流程（表格是唯一信息源）：
 *   1. 在腾讯文档把「ID编号」表格导出为 CSV（文件 → 导出为 → 本地 CSV），
 *      覆盖保存到项目的 archive/ID编号.csv（或把 CSV 路径作为参数传入）
 *   2. 运行 npm run sync:archive
 *   3. 脚本把表格转换为 archive.json 并上传到 COS 桶根目录
 *      （桶里需有 COS_SECRET_ID / COS_SECRET_KEY 环境变量，见 .env）
 *   4. 网站每次打开都会自动读取 {桶域名}/archive.json，表格改动即刻生效
 *
 * 仅生成不上传：未配置 COS 密钥时，只在本地产出 archive/archive.json 供检查。
 *
 * 表格列约定（与腾讯文档「ID编号」表一致）：
 *   ID编号 | 本子名 | 作者 | 总页数 | 加入标签(英文逗号隔开) | 来源 | 汉化 | 嵌字
 */
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

const BUCKET = 'levihan-1325571558';
const REGION = 'ap-nanjing';
const ENDPOINT = 'https://cos.ap-nanjing.myqcloud.com';
/** 公开访问域名：用来读回线上 archive.json，把本脚本管不了的字段接住（见下方 preserveFlags） */
const CDN_BASE = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com';

const csvArg = process.argv[2];
const csvPath = path.resolve(csvArg || 'archive/ID编号.csv');
const outPath = path.resolve('archive/archive.json');

/* 推荐表（第二个数据源）：archive/推荐.csv → archive/recs.json → COS 桶根
 * 表列约定：文章名称 | 链接 | 类型 | 限制 | 推荐ID | 推荐理由（E/F 可选） */
const recsCsvPath = path.resolve('archive/推荐.csv');
const recsOutPath = path.resolve('archive/recs.json');

/* ---------- 极简 CSV 解析（支持引号包裹的逗号/换行） ---------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ''); // 去 BOM
  const rows = [];
  let row = [], cell = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row); }
  return rows;
}

/* ---------- CSV → DoujinBookItem[] ---------- */
function buildArchive(rows) {
  const items = [];
  const problems = [];
  for (let i = 1; i < rows.length; i++) { // 首行为表头
    const [id, titleZh, circle, pages, tags, source, translator, typesetter] =
      rows[i].map((c) => (c || '').trim());

    if (!id) continue; // 空行
    if (!/^lh-\d+$/.test(id)) { problems.push(`第 ${i + 1} 行：ID「${id}」不符合 lh-数字 格式，已跳过`); continue; }
    if (!titleZh) { problems.push(`第 ${i + 1} 行：${id} 缺少「本子名」，已跳过（补全后重跑即可）`); continue; }

    items.push({
      id,
      titleZh,
      circle: circle || '未知',
      category: '漫画本', // 表格暂无分类列，默认漫画本
      tags: (tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      source: source || undefined,
      translator: translator || undefined,
      typesetter: typesetter || undefined,
      pages: parseInt(pages, 10) || 30,
      bookFolder: id,
      coverFile: 'image01.webp',
    });
  }
  return { items, problems };
}

/* ---------- 推荐表 CSV → RecommendItem[] ---------- */
function stableRecId(url) {
  const m = /\/works\/(\d+)/.exec(url || '');
  if (m) return `ao3-${m[1]}`;
  // 无 AO3 works 号：用 URL 的简易 hash，保证同一链接 id 稳定
  let h = 0;
  const s = String(url || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `rec-${h.toString(36)}`;
}

function siteName(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('archiveofourown.org')) return 'AO3';
    if (host.endsWith('lofter.com')) return 'LOFTER';
    if (host.endsWith('weibo.com')) return '微博';
    return host.replace(/^www\./, '').toUpperCase();
  } catch {
    return '';
  }
}

function buildRecs(rows) {
  const items = [];
  const problems = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) { // 首行为表头
    const [title, url, type, rating, recommender, reason] = rows[i].map((c) => (c || '').trim());
    if (!title && !url) continue; // 全空行（表格中间可能有大段空行）
    if (!title) { problems.push(`推荐表第 ${i + 1} 行：缺「文章名称」，已跳过`); continue; }
    if (!url) { problems.push(`推荐表第 ${i + 1} 行：${title} 缺「链接」，保留但跳转置灰`); }
    if (url && !/^https?:\/\//.test(url)) {
      problems.push(`推荐表第 ${i + 1} 行：${title} 链接不是 http(s)，按缺链接处理`);
    }
    const cleanUrl = /^https?:\/\//.test(url || '') ? url : '';
    if (cleanUrl && seen.has(cleanUrl)) { problems.push(`推荐表第 ${i + 1} 行：${title} 链接重复，保留首条`); continue; }
    if (cleanUrl) seen.add(cleanUrl);

    const item = {
      id: stableRecId(cleanUrl),
      title,
      url: cleanUrl,
      type: type || '未分类',
      rating: rating || '未标注',
      site: siteName(cleanUrl),
    };
    if (recommender) item.recommender = recommender;
    if (reason) item.reason = reason;
    items.push(item);
  }
  return { items, problems };
}

/* ---------- 主流程（数据源一：ID编号 → archive.json） ---------- */
if (!fs.existsSync(csvPath)) {
  console.error(`✗ 找不到表格 CSV：${csvPath}`);
  console.error('  请先在腾讯文档把「ID编号」表导出为 CSV，保存为 archive/ID编号.csv');
  process.exit(1);
}

const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
const { items, problems } = buildArchive(rows);

/* ---------- 接住表格里没有、但由管理台上传时写入的标记 ----------
 * 表格是归档的主体信息源，但有几个字段只有后台知道：
 *   secure —— 勾了「含有敏感元素」的本子，站点要靠它走 403 伪装阅读器；
 *             丢了它，密文本子会被当成普通图片本，点开就是一片空白。
 * 这里从线上 archive.json 读回来按 id 合并。读不到就跳过并提示，绝不阻断同步。 */
async function preserveFlags(list) {
  // 表格里没有的字段，全靠线上 archive.json 接住，否则每跑一次同步就会被 buildArchive 的默认值冲掉：
  //   secure    —— 敏感标记，丢了这本就退回普通图集，阅读端行为直接错
  //   coverFile —— 后台「敏感本封面 / 首图即封面」选定的真实文件名，丢了会被重置成 image01.webp
  const KEEP = ['secure', 'coverFile'];
  let remote = null;
  try {
    const res = await fetch(`${CDN_BASE}/archive.json`, { cache: 'no-store' });
    if (res.ok) remote = await res.json();
  } catch {
    /* 网络不可达时静默降级，下面统一提示 */
  }
  if (!Array.isArray(remote)) {
    console.warn('⚠ 读不到线上 archive.json，本次未能保全 secure / coverFile 标记（表格里没有这两个字段）。');
    return list;
  }
  const byId = new Map(remote.filter((b) => b && b.id).map((b) => [b.id, b]));
  let carried = 0;
  list.forEach((item) => {
    const old = byId.get(item.id);
    if (!old) return;
    KEEP.forEach((k) => {
      if (old[k] !== undefined) { item[k] = old[k]; carried += 1; }
    });
  });
  if (carried) console.log(`✓ 已从线上 archive.json 保全 ${carried} 个后台标记（secure / coverFile）`);
  return list;
}

if (items.length) await preserveFlags(items);

if (problems.length) {
  console.warn('⚠ 数据问题：');
  problems.forEach((p) => console.warn('  - ' + p));
}
console.log(`✓ 从表格解析出 ${items.length} 部作品`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf8');
console.log(`✓ 已生成 ${outPath}`);

/* ---------- 主流程（数据源二：推荐表 → recs.json） ---------- */
let recs = null;
if (fs.existsSync(recsCsvPath)) {
  const recsRows = parseCSV(fs.readFileSync(recsCsvPath, 'utf8'));
  const recsBuilt = buildRecs(recsRows);
  if (recsBuilt.problems.length) {
    console.warn('⚠ 推荐表数据问题：');
    recsBuilt.problems.forEach((p) => console.warn('  - ' + p));
  }
  recs = recsBuilt.items;
  fs.writeFileSync(recsOutPath, JSON.stringify(recs, null, 2), 'utf8');
  console.log(`✓ 已生成 ${recsOutPath}（${recs.length} 条推荐）`);
} else {
  console.warn(`⚠ 找不到 ${recsCsvPath}，本次跳过推荐表（archive.json 不受影响）`);
}

/* ---------- 上传到 COS ---------- */
const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;
if (!secretId || !secretKey) {
  console.warn('⚠ 未配置 COS_SECRET_ID / COS_SECRET_KEY（.env），仅本地生成、未上传。');
  console.warn('  配置密钥后重新运行即可上传到 COS 桶。');
  process.exit(0);
}

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: secretId, secretAccessKey: secretKey },
});

try {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'archive.json',
    Body: JSON.stringify(items, null, 2),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  }));
  console.log(`✓ archive.json 已上传到 COS：${BUCKET}/${'archive.json'}`);

  if (recs) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'recs.json',
      Body: JSON.stringify(recs, null, 2),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-cache',
    }));
    console.log(`✓ recs.json 已上传到 COS：${BUCKET}/recs.json（${recs.length} 条）`);
  }
  console.log('  网站刷新即可读到最新数据。');
} catch (err) {
  console.error('✗ 上传失败：', err?.message || err);
  process.exit(1);
}
