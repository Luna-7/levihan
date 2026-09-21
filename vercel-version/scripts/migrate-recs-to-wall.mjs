#!/usr/bin/env node
/**
 * 一次性迁移脚本：把「站外推荐」表（recs.json 的 39 条 AO3 外链）批量搬进兵长茶会「安利墙」。
 *
 * 为什么需要它：小说本里的站外推荐段已下线，数据不能丢。安利墙的帖子由云函数
 * forumPublish 落到 COS 的 forum.json，本地改不了，只能用管理员令牌走 HTTP 调用。
 *
 * 用法：
 *   node scripts/migrate-recs-to-wall.mjs /tmp/recs.json          # 真跑
 *   node scripts/migrate-recs-to-wall.mjs /tmp/recs.json --dry    # 只打印将要发布的条目
 *
 * 幂等：发布前先拉一次 forumList，链接已存在于安利墙的条目直接跳过，可反复执行。
 * 署名：默认「六元环」（可用 WALL_AUTHOR 覆盖）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ENDPOINT = process.env.WALL_ENDPOINT
  || 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload';
const AUTHOR = process.env.WALL_AUTHOR || '六元环';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const recsPath = args.find((a) => !a.startsWith('--')) || '/tmp/recs.json';

/** 从 cloudbase/.env 里抠出 ADMIN_PASSWORD（值可能带引号，也可能含 '='） */
function readAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const envFile = path.join(PROJECT_ROOT, 'cloudbase', '.env');
  const text = fs.readFileSync(envFile, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*ADMIN_PASSWORD\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) return v;
  }
  throw new Error('未找到 ADMIN_PASSWORD（可放在环境变量或 cloudbase/.env）');
}

/** 与云函数 signExp 完全一致：HMAC-SHA256(password + '|levihan-admin-v1') over exp，base64url */
function makeAdminToken(password) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac('sha256', `${password}|levihan-admin-v1`).update(String(exp)).digest('base64url');
  return `${exp}.${sig}`;
}

const token = makeAdminToken(readAdminPassword());

async function call(body) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-Admin-Token': token,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    throw new Error(`调用失败 HTTP ${resp.status}：${(json && json.error) || resp.statusText}`);
  }
  return json;
}

/** 链接归一：去掉协议、www、末尾斜杠与查询串，用于幂等比对 */
const normUrl = (u) => String(u || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')
  .toLowerCase();

/** 正文 = 安利时附带的文本：类型 · 评级（两者都空则不写正文） */
function attachedText(rec) {
  const parts = [];
  if (rec.type) parts.push(`类型：${rec.type}`);
  if (rec.rating) parts.push(`评级：${rec.rating}`);
  return parts.join(' · ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const recs = JSON.parse(fs.readFileSync(recsPath, 'utf8'));
  if (!Array.isArray(recs) || !recs.length) throw new Error(`${recsPath} 不是非空数组`);

  console.log(`读出 ${recs.length} 条推荐（来源 ${recsPath}），署名「${AUTHOR}」`);

  const existing = await call({ action: 'forumList' });
  const wallUrls = new Set(
    (existing.posts || [])
      .filter((p) => p && p.category === 'links' && p.link && p.link.url)
      .map((p) => normUrl(p.link.url))
  );
  console.log(`安利墙现有外链 ${wallUrls.size} 条，作为幂等基准`);

  const pending = recs.filter((rec) => rec && rec.url && !wallUrls.has(normUrl(rec.url)));
  const skipped = recs.length - pending.length;
  console.log(`待发布 ${pending.length} 条${skipped ? `，跳过已存在 ${skipped} 条` : ''}`);

  if (dryRun) {
    pending.forEach((rec, i) => console.log(`  ${String(i + 1).padStart(2)}. ${rec.title}  |  ${rec.url}  |  ${attachedText(rec)}`));
    console.log('--dry：未做任何写入。');
    return;
  }

  // 云函数用 unshift 插队，倒序发布才能让安利墙的先后顺序与原推荐表一致
  const queue = [...pending].reverse();
  let ok = 0;
  const failures = [];

  for (let i = 0; i < queue.length; i += 1) {
    const rec = queue[i];
    try {
      await call({
        action: 'forumPublish',
        category: 'links',
        author: AUTHOR,
        title: String(rec.title || '').trim(),
        body: attachedText(rec),
        linkUrl: rec.url,
        // AO3 抓不到 OG：只带标题兜底，平台/级别由云函数重新判定（ao3 → C 级跳转卡）
        linkPreview: { ogTitle: String(rec.title || '').trim() },
      });
      ok += 1;
      console.log(`[${i + 1}/${queue.length}] ✓ ${rec.title}`);
    } catch (err) {
      failures.push({ title: rec.title, url: rec.url, error: err.message });
      console.error(`[${i + 1}/${queue.length}] ✗ ${rec.title} —— ${err.message}`);
    }
    await sleep(250);
  }

  console.log(`\n完成：成功 ${ok} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log(`  - ${f.title} (${f.url})：${f.error}`));
    process.exitCode = 1;
  }

  const after = await call({ action: 'forumList' });
  const wallCount = (after.posts || []).filter((p) => p && p.category === 'links').length;
  console.log(`安利墙当前共 ${wallCount} 条外链（论坛帖子总数 ${(after.posts || []).length}）`);
}

main().catch((err) => {
  console.error('迁移失败：', err.message);
  process.exit(1);
});
