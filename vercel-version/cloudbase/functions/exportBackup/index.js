/**
 * CloudBase 退出前的数据保全：把 PostgreSQL 全表导出成 JSON，写进 COS。
 *
 * 为什么需要它：云函数欠费停服期间，本地没有 @cloudbase/node-sdk，也没有
 * COS 的 SecretId/SecretKey（那两个是云端运行时注入的），所以本地既连不上
 * 数据库也传不了 COS。这个函数部署到云端后，两个能力都天然具备，用
 * `tcb fn invoke exportBackup` 触发一次即可完成全量导出。
 *
 * 产物路径：backups/cloudbase-exit/<ISO 时间戳>/<表名>.json
 *            backups/cloudbase-exit/<ISO 时间戳>/_summary.json（每张表的行数与报错）
 *
 * 触发方式（在 vercel-version/cloudbase 目录下）：
 *   tcb fn deploy exportBackup --force
 *   tcb fn invoke exportBackup
 *
 * 注意：只做导出，不做任何删除，可反复执行。
 */

const tcb = require('@cloudbase/node-sdk');
const COS = require('cos-nodejs-sdk-v5');

const ENV_ID = 'levihan-tudou-d0g7jivue1ccc4a35';
const BUCKET = 'levihan-1325571558';
const REGION = 'ap-nanjing';
const BACKUP_PREFIX = 'backups/cloudbase-exit/';
const PAGE = 1000;
/** 单表最多翻多少页，防止异常时无限循环（1000 × 50 = 5 万行上限） */
const MAX_PAGES = 50;

/** 与 migrations/ 里的建表一一对应 */
const TABLES = [
  'users',
  'user_sessions',
  'app_users',
  'invite_codes',
  'question_bank',
  'rate_limit_buckets',
  'recovery_codes',
  'registration_challenges',
  'registration_tickets',
  'submission_inbox',
  'game_scores',
  'game_best',
];

function initDb() {
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  if (!accessKey || accessKey.startsWith('{{env.')) throw new Error('CLOUDBASE_APIKEY 未配置');
  return tcb.init({ env: ENV_ID, accessKey }).rdb({ database: 'public' });
}

/** SDK 不同版本返回形态不一致（有 data 包裹 / 直接数组），统一抽出来 */
const rowsOf = (res) => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);

/**
 * 全量读一张表。优先用 range 分页；若该版本 SDK 不支持 range 就退化为单页 limit，
 * 并在返回值里标出 truncated，避免静默丢数据。
 */
async function dumpTable(db, table) {
  const rows = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE;
    let chunk;
    try {
      chunk = rowsOf(await db.from(table).select('*').range(start, start + PAGE - 1));
    } catch {
      chunk = rowsOf(await db.from(table).select('*').limit(PAGE));
      rows.push(...chunk);
      truncated = chunk.length >= PAGE;
      break;
    }
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { rows, truncated };
}

exports.main = async () => {
  const db = initDb();
  /**
   * 云端注入的是**临时密钥三件套（STS）**：SecretId / SecretKey / SessionToken。
   * 三个必须一起给——少了 SecurityToken 会报 InvalidAccessKeyId，
   * 看起来像「密钥不存在」，实际是临时密钥没带令牌。（与 admin-upload 保持一致）
   */
  const cos = new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
    Protocol: 'https:',
  });
  const putObject = (Key, Body, ContentType) =>
    new Promise((resolve, reject) => {
      cos.putObject({ Bucket: BUCKET, Region: REGION, Key, Body, ContentType }, (err, data) =>
        err ? reject(err) : resolve(data),
      );
    });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `${BACKUP_PREFIX}${stamp}/`;
  const tables = [];

  for (const table of TABLES) {
    try {
      const { rows, truncated } = await dumpTable(db, table);
      await putObject(`${prefix}${table}.json`, Buffer.from(JSON.stringify(rows), 'utf8'), 'application/json');
      tables.push({ table, rows: rows.length, truncated, ok: true });
    } catch (error) {
      tables.push({ table, ok: false, error: String((error && error.message) || error) });
    }
  }

  const summary = { exportedAt: new Date().toISOString(), prefix, totalTables: TABLES.length, tables };
  await putObject(`${prefix}_summary.json`, Buffer.from(JSON.stringify(summary, null, 2), 'utf8'), 'application/json');
  return summary;
};
