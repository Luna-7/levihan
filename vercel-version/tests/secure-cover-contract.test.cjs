/**
 * 敏感本封面（单独上传、不加密）的跨文件接线契约测试。
 *
 * 这块逻辑横跨四个文件，任何一处被单独改动都会静默失效（没有类型系统兜底）：
 *   1. public/admin/index.html          —— 控件、命名规则、上传顺序
 *   2. cloudbase/functions/admin-upload —— 文件名白名单 FILE_RE
 *   3. src/components/DoujinshiArchive  —— 前台据 coverFile 决定显示封面还是隔离占位
 *   4. scripts/sync-archive.mjs         —— 同步表格时不能把 coverFile 冲掉
 *
 * 所以这里不测"实现细节"，只钉住这四条契约本身。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ADMIN = read('public/admin/index.html');
const CLOUD_FN = read('cloudbase/functions/admin-upload/index.js');
const ARCHIVE_TSX = read('src/components/DoujinshiArchive.tsx');
const SYNC_MJS = read('scripts/sync-archive.mjs');

/** 从真实实现里摘出封面命名规则，避免测试里重写一份「看起来一样」的副本 */
function loadCoverNamer() {
  const start = ADMIN.indexOf('var SECURE_COVER_STEM');
  const end = ADMIN.indexOf('function syncCoverFileField');
  assert.ok(start >= 0 && end > start, '管理台里找不到封面命名规则的实现片段');
  const src = ADMIN.slice(start, end);
  const sandbox = { URL: { createObjectURL: () => 'blob:x' } };
  return vm.runInNewContext(`${src}\n;secureCoverName`, sandbox);
}

const secureCoverName = loadCoverNamer();
const FILE_RE = new RegExp(/const FILE_RE = (\/.*?\/i);/.exec(CLOUD_FN)[1].slice(1, -2), 'i');

test('封面文件名必须落在云函数的 FILE_RE 白名单里', () => {
  const cases = [
    ['photo.png', 'cover.png'],
    ['photo.JPG', 'cover.jpg'],
    ['photo.jpeg', 'cover.jpg'],
    ['photo.webp', 'cover.webp'],
    ['photo.gif', 'cover.gif'],
    ['photo.avif', 'cover.avif'],
    ['没后缀的图', 'cover.webp'],          // 兜底成 webp
    ['', 'cover.webp'],
  ];
  for (const [input, expected] of cases) {
    const got = secureCoverName(input);
    assert.equal(got, expected, `${input || '(空)'} → ${got}，期望 ${expected}`);
    assert.ok(FILE_RE.test(got), `${got} 会被云函数判为非法文件名`);
  }
});

test('封面文件名是固定的 cover.<ext>，重传同一本必然覆盖旧图', () => {
  // 不掺 ID、不掺时间戳 —— 否则每次重传都在桶里堆一个新文件
  assert.equal(secureCoverName('a.png'), secureCoverName('b.png'));
  assert.ok(!secureCoverName('a.png').includes('/'));
});

test('管理台：封面控件存在，且只在敏感模式下出现', () => {
  for (const id of ['secure-cover-box', 'secure-cover-picker', 'secure-cover-drop', 'secure-cover-info', 'secure-cover-remove']) {
    assert.ok(ADMIN.includes(`id="${id}"`), `缺少 #${id}`);
  }
  // 显隐由 refreshSecureUI 统一管；初始态必须是 hide，否则普通流程也会看到封面区
  assert.match(ADMIN, /id="secure-cover-box" class="hide"/);
  assert.match(ADMIN, /coverBox\.classList\.toggle\('hide', !on\)/);
});

test('管理台：封面先传、密文后传（顺序反了会留下指向不存在文件的 coverFile）', () => {
  const start = ADMIN.indexOf('function handleSecureUpload');
  const body = ADMIN.slice(start, ADMIN.indexOf('function setBusy'));
  const coverAt = body.indexOf('uploadSecureCover(form.id)');
  const vaultAt = body.indexOf('LeVihanVault.handleComicUpload');
  assert.ok(coverAt >= 0, 'handleSecureUpload 里没有调用 uploadSecureCover');
  assert.ok(vaultAt >= 0, 'handleSecureUpload 里没有调用 handleComicUpload');
  assert.ok(coverAt < vaultAt, '封面必须在密文之前上传');
});

test('管理台：封面走普通 upload 通道，不掺进加密流水线', () => {
  const start = ADMIN.indexOf('function uploadSecureCover');
  const body = ADMIN.slice(start, ADMIN.indexOf('function handleSecureUpload'));
  assert.match(body, /action:'upload'/, '封面应走 api({action:\'upload\'})');
  assert.ok(!/LeVihanVault/.test(body), '封面不应调用加密模块');
});

test('归档载荷同时带上 secure 与 coverFile', () => {
  const start = ADMIN.indexOf('function handleSecureUpload');
  const body = ADMIN.slice(start, ADMIN.indexOf('function setBusy'));
  assert.match(body, /secure: true/);
  assert.match(body, /coverFile/, '归档载荷里应带上 coverFile');
});

test('前台：敏感本按 coverFile 是否存在决定显示封面还是隔离占位', () => {
  const start = ARCHIVE_TSX.indexOf('{book.secure ? (');
  const end = ARCHIVE_TSX.indexOf(') : !failedCovers.has(book.id) ? (', start);
  assert.ok(start >= 0 && end > start, '找不到敏感本那条三元分支');
  const branch = ARCHIVE_TSX.slice(start, end);

  // 判定必须用 coverFile，不能用 coverUrl —— 后者对未设封面的本子会默认成
  // image01.webp 永远非空，会白发一次请求再走 onError
  assert.ok(branch.includes('book.coverFile'), '敏感本分支没有按 coverFile 判定');
  assert.ok(branch.includes('src={coverUrl}'), '敏感本分支没有用 coverUrl 作图片地址');
  assert.ok(branch.includes('RESOURCE ISOLATED'), '没有封面时仍应退回隔离占位');
  assert.ok(
    branch.indexOf('book.coverFile') < branch.indexOf('RESOURCE ISOLATED'),
    'coverFile 判定应在占位图之前（有封面时不该显示占位）'
  );
});

test('同步脚本：coverFile 必须进保全清单，否则表格同步会把封面重置', () => {
  const m = /const KEEP = \[(.*?)\];/.exec(SYNC_MJS);
  assert.ok(m, '找不到 preserveFlags 里的 KEEP 清单');
  const KEEP = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.ok(KEEP.includes('secure'), 'KEEP 丢了 secure');
  assert.ok(KEEP.includes('coverFile'), 'KEEP 丢了 coverFile');
});
