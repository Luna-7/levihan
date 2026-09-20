/**
 * 「管理台依赖库必须同源自托管」的接线契约测试。
 *
 * 背景：管理台曾经从第三方 CDN 现拉 jsPDF / pdf.js / JSZip / cos-js-sdk-v5。
 * 实测 cdn.staticfile.net 上 320KB 的 pdf.min.js 单请求就要 2.7～3s，worker 约 1MB 更慢；
 * 手机网络下会超过「PDF 首页提取成封面」的等待窗口 —— 症状是**封面区一直停在
 * 「生成中…」而页面不报任何错**，归因极难。现已全部改为 public/admin/vendor/ 同源托管。
 *
 * 这里钉住两件容易在后续改动里悄悄回退的事：
 *   ① 不要再引入第三方 CDN 的 <script src>（回归成慢加载）；
 *   ② 代码里写死的 ./vendor/xxx 路径在磁盘上真的有对应文件
 *      —— 少一个文件等于线上某个功能直接不工作，而本地静态检查看不出来。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_DIR = path.join(ROOT, 'public', 'admin');
const VENDOR_DIR = path.join(ADMIN_DIR, 'vendor');

const ADMIN = fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8');
const TOOLS = fs.readFileSync(path.join(ADMIN_DIR, 'tools.js'), 'utf8');
const SECURE = fs.readFileSync(path.join(ADMIN_DIR, 'secure-upload.js'), 'utf8');

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/** 管理台里全部 <script src="..."> */
function scriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\ssrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* ---------------- ① 不许再从第三方 CDN 拉库 ---------------- */

test('管理台不得再引用第三方 CDN 的脚本（回归会重新引入慢加载）', () => {
  const banned = /(staticfile\.net|jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.bootcdn\.net)/i;
  const srcs = scriptSrcs(ADMIN);
  assert.ok(srcs.length >= 5, `期望至少 5 个 script，实际 ${srcs.length}`);
  const offenders = srcs.filter((s) => banned.test(s));
  assert.deepEqual(offenders, [], `仍有第三方 CDN 脚本：${offenders.join(', ')}`);
  // <link> / 内联字符串里也不该再出现这几个宿主
  assert.equal(banned.test(ADMIN), false, 'index.html 其他位置仍残留第三方 CDN 域名');
  assert.equal(banned.test(TOOLS), false, 'tools.js 仍残留第三方 CDN 域名');
  assert.equal(banned.test(SECURE), false, 'secure-upload.js 仍残留第三方 CDN 域名');
});

/* ---------------- ② 写死的本地路径必须真的有文件 ---------------- */

test('index.html 里每个本地 <script src> 都指向磁盘上真实存在的文件', () => {
  const local = scriptSrcs(ADMIN).filter((s) => !/^[a-z]+:/i.test(s) && !s.startsWith('//'));
  assert.ok(local.length >= 5, `期望至少 5 个本地 script，实际 ${local.length}`);
  for (const src of local) {
    const abs = path.resolve(ADMIN_DIR, src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(abs), `引用了不存在的脚本：${src} → ${abs}`);
    assert.ok(fs.statSync(abs).size > 0, `脚本是空文件：${src}`);
  }
});

test('vendor 目录五个依赖库齐全且非空（少一个就是线上一个功能不可用）', () => {
  const expected = [
    'jspdf.umd.min.js',      // 加密：jsPDF 合并页面
    'pdf.min.js',            // pdf.js 主库：拆页 + 提取封面
    'pdf.worker.min.js',     // pdf.js worker：渲染必需，缺了报 fake worker
    'jszip.min.js',          // 工具箱打包
    'cos-js-sdk-v5.min.js',  // 浏览器直传 COS（失败会降级为中转上传）
  ];
  for (const name of expected) {
    const abs = path.join(VENDOR_DIR, name);
    assert.ok(fs.existsSync(abs), `vendor 缺少 ${name}`);
    assert.ok(fs.statSync(abs).size > 10000, `${name} 体积异常（可能下成了错误页）`);
  }
});

test('workerSrc 在 index.html 与 tools.js 两处都指向存在的本地 worker', () => {
  // 两处各有一份兜底，都必须改；只改一处会在某条加载顺序下报 "Setting up fake worker failed"
  const literal = "'./vendor/pdf.worker.min.js'";
  for (const [label, body] of [['index.html', ADMIN], ['tools.js', TOOLS]]) {
    assert.ok(body.includes(literal), `${label} 的 workerSrc 未指向本地 ${literal}`);
  }
  assert.ok(
    fs.existsSync(path.join(ADMIN_DIR, 'vendor', 'pdf.worker.min.js')),
    'workerSrc 指向的文件不存在',
  );
});

/* ---------------- ③ 防止 vendor 副本与项目 pin 的版本漂移 ---------------- */

test('vendor 里的 pdf.js 必须与 package.json 钉住的 pdfjs-dist 同字节', (t) => {
  const dist = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build');
  if (!fs.existsSync(path.join(dist, 'pdf.min.js'))) {
    t.skip('node_modules 里没有 pdfjs-dist，跳过漂移校验（CI 精简环境下正常）');
    return;
  }
  for (const name of ['pdf.min.js', 'pdf.worker.min.js']) {
    assert.equal(
      md5(path.join(VENDOR_DIR, name)),
      md5(path.join(dist, name)),
      `${name} 与 pdfjs-dist 不一致 —— CDN 上的那份已经换了，vendor 副本没跟着更新`,
    );
  }
});
