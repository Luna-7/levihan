/**
 * 主站的敏感本阅读器不得再从第三方 CDN 拉 pdf.js worker。
 *
 * 背景：SecureComicReader 曾经把 worker 指向 cdn.staticfile.net，注释里还写着
 * "走 CDN 是刻意的选择" —— 实测那个取舍是错的：320KB 的 pdf.min.js 单请求就要
 * 2.7~3.0s，1MB 的 worker 更慢；worker 没到位这本就打不开，症状是「一直卡在解密中」。
 * 而阅读器恰恰是"用户正在等"的路径，比后台更不该依赖外部网络。
 *
 * 现在改由打包器随包发布（?url → 同源 assets）。这里钉住它别被改回去 ——
 * 那条"为了省事走 CDN"的注释很有说服力，没有测试很容易复辟。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const READER = path.join(ROOT, 'src', 'components', 'SecureComicReader.tsx');
const BANNED = /(staticfile\.net|jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.bootcdn\.net)/i;

test('敏感本阅读器的 worker 必须随包发布（?url），不能写死远端地址', () => {
  const src = fs.readFileSync(READER, 'utf8');
  assert.match(
    src,
    /import\s+pdfWorkerUrl\s+from\s+'pdfjs-dist\/build\/pdf\.worker\.min\.js\?url'/,
    '缺少 ?url 形式的 worker 导入 —— 改回 CDN 会让手机用户卡在"解密中"',
  );
  assert.match(
    src,
    /const\s+PDFJS_WORKER_SRC\s*=\s*pdfWorkerUrl/,
    'PDFJS_WORKER_SRC 必须就来自 ?url 导入的地址（别再写死字符串）',
  );
  assert.match(
    src,
    /GlobalWorkerOptions\.workerSrc\s*=\s*PDFJS_WORKER_SRC/,
    'workerSrc 必须指向随包发布的 URL',
  );
  assert.equal(
    /GlobalWorkerOptions\.workerSrc\s*=\s*['"]https?:/.test(src),
    false,
    'workerSrc 又被写成了远端地址',
  );
});

test('worker 的版本来源必须是依赖里那个 pdfjs-dist（不能手写版本号对不齐）', () => {
  const src = fs.readFileSync(READER, 'utf8');
  // 手写 "pdf.js/3.11.174/..." 这种版本串正是当初漂移的根源
  assert.equal(
    /pdf\.js\/\d+\.\d+\.\d+\//.test(src),
    false,
    '源码里不该再出现手写的 pdf.js 版本路径',
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && pkg.dependencies['pdfjs-dist'], 'pdfjs-dist 必须是显式依赖');
});

test('阅读器源码里不得出现第三方 CDN 域名', () => {
  const src = fs.readFileSync(READER, 'utf8');
  const hits = src
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => BANNED.test(line));
  assert.deepEqual(
    hits,
    [],
    `仍有第三方 CDN 引用：${hits.map(([n, l]) => `L${n} ${l.trim()}`).join(' | ')}`,
  );
});
