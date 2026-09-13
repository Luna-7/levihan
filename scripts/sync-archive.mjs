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

const csvArg = process.argv[2];
const csvPath = path.resolve(csvArg || 'archive/ID编号.csv');
const outPath = path.resolve('archive/archive.json');

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

/* ---------- 主流程 ---------- */
if (!fs.existsSync(csvPath)) {
  console.error(`✗ 找不到表格 CSV：${csvPath}`);
  console.error('  请先在腾讯文档把「ID编号」表导出为 CSV，保存为 archive/ID编号.csv');
  process.exit(1);
}

const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
const { items, problems } = buildArchive(rows);

if (problems.length) {
  console.warn('⚠ 数据问题：');
  problems.forEach((p) => console.warn('  - ' + p));
}
console.log(`✓ 从表格解析出 ${items.length} 部作品`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf8');
console.log(`✓ 已生成 ${outPath}`);

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
  console.log('  网站刷新即可读到最新归档数据。');
} catch (err) {
  console.error('✗ 上传失败：', err?.message || err);
  process.exit(1);
}
