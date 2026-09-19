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

/* ==========================================================================
 * 封面裁切：复用图片编辑器的第二条出口
 *
 * 编辑器是共用的（内页 files[] 与敏感本封面 secureCover），靠 edTarget 分流。
 * 这里最怕两件事：① 封面被写进 files[]（idx 是 -1，会静默写错对象）；
 * ② 内页图片被写进 secureCover（普通流程的图会顶掉封面）。
 * 所以下面既钉「顺序」，也把完工回写函数真跑一遍。
 * ========================================================================== */

/** 从真实实现里摘出命名规则 + 挂载/回写函数，用桩替掉 DOM 依赖后在 vm 里跑 */
function loadCoverCommit() {
  const start = ADMIN.indexOf('var SECURE_COVER_STEM');
  const end = ADMIN.indexOf('function isSecureMode');
  assert.ok(start >= 0 && end > start, '管理台里找不到封面挂载/回写的实现片段');
  const src = ADMIN.slice(start, end);
  const sandbox = {
    URL: { createObjectURL: () => 'blob:new', revokeObjectURL: () => {} },
    File,
    console,
    // DOM 与工具函数按「全部缺失」桩掉：实现里都写了 if (el) 守卫，取不到就跳过
    $: () => null,
    document: { getElementById: () => null, querySelector: () => null },
    show: () => {},
    hide: () => {},
    syncButtons: () => {},
    loadImage: () => Promise.resolve(),
    cloneRect: (r) => (r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null),
    cloneStrokes: (s) => (s || []).map((k) => ({ r: k.r, pts: k.pts.slice() })),
    defaultCrop: () => ({ x: 0, y: 0, w: 2, h: 3 }),
    layoutEditor: () => {},
    renderEditor: () => {},
    envMax: 4 * 1024 * 1024,
    fmtSize: (n) => `${n}B`,
  };
  vm.runInNewContext(`${src}\n;this.__api = { get secureCover(){return secureCover;}, setSecureCover, commitSecureCoverEdit, secureCoverName };`, sandbox);
  return sandbox.__api;
}

test('管理台：封面裁切入口存在，且没封面时按钮不可点', () => {
  assert.ok(ADMIN.includes('id="secure-cover-crop"'), '缺少 #secure-cover-crop 按钮');
  assert.match(ADMIN, /\$\('secure-cover-crop'\)\.onclick = openSecureCoverEditor/);
  // 标题栏按钮文案带 ✂，拖拽区说明要提前告诉管理员「选后可以裁」
  assert.match(ADMIN, /id="secure-cover-crop"[^>]*>✂ 裁切</);
  assert.match(ADMIN, /选后可用 ✂ 裁切/);
  // 没选封面就没得裁 —— syncButtons 里必须联动
  assert.match(ADMIN, /\$\('secure-cover-crop'\)\.disabled = !secureCover/);
});

test('管理台：编辑器按 edTarget 分流，裁切封面不会碰 files[]', () => {
  const openAt = ADMIN.indexOf('function openEditor(i)');
  const openBody = ADMIN.slice(openAt, ADMIN.indexOf('function closeEditor'));
  assert.match(openBody, /edTarget = 'page'/, 'openEditor 必须把目标重置回内页图片');

  const coverAt = ADMIN.indexOf('function openSecureCoverEditor');
  const coverBody = ADMIN.slice(coverAt, ADMIN.indexOf('function commitSecureCoverEdit'));
  assert.match(coverBody, /edTarget = 'secure-cover'/);
  assert.match(coverBody, /idx: -1/, '封面不在 files[] 里，idx 必须是 -1');
  assert.match(coverBody, /isCover: true/, '封面要走编辑器的 2:3 裁剪框分支');

  // edDone 的封面分支必须在读取 files[i] 之前返回
  const doneAt = ADMIN.indexOf('function edDone');
  // 取到 edDone 的闭合大括号为止：不能只按下一个 "function " 切，
  // 那会把后面整段代码一起吞进来，匹配到无关的 files[i]
  const doneBody = ADMIN.slice(doneAt, ADMIN.indexOf('\n}\n', doneAt) + 3);
  assert.ok(doneBody.includes('function edDone'), 'edDone 切片失败');
  const branchAt = doneBody.indexOf("target === 'secure-cover'");
  // 只认真正的取值语句，别被注释里提到的 "files[i]" 骗到
  const filesAt = doneBody.indexOf('var f = files[i]');
  assert.ok(branchAt >= 0, 'edDone 里没有封面分支');
  assert.ok(filesAt >= 0, 'edDone 里找不到 var f = files[i]');
  assert.ok(branchAt < filesAt, '封面分支必须排在 files[i] 之前，否则会写错对象');
  assert.match(doneBody.slice(0, filesAt), /commitSecureCoverEdit/, '封面分支要调用回写函数');
});

test('封面裁切产物：仍是 cover.<ext>，且强制重传（内容变了不能复用旧地址）', () => {
  const api = loadCoverCommit();
  const before = new File([Buffer.from('original-jpeg-bytes')], 'my-shot.jpg', { type: 'image/jpeg' });
  api.setSecureCover(before);
  assert.equal(api.secureCover.name, 'my-shot.jpg');
  assert.equal(api.secureCoverName(api.secureCover.name), 'cover.jpg');

  // 模拟编辑器完工：喂回一个 WebP 产物 + 裁剪参数
  const out = new File([Buffer.from('cropped-webp-bytes')], 'my-shot.webp', { type: 'image/webp' });
  const op = { crop: { x: 0.1, y: 0.05, w: 0.5, h: 0.75 }, strokes: [] };
  api.commitSecureCoverEdit(out, op);

  // 回写会把 blob 重新包成 File（为了钉住 .webp 后缀），所以比内容而不是比对象
  assert.equal(api.secureCover.file.type, 'image/webp', '回写产物应是 WebP');
  assert.equal(api.secureCover.byteSize, out.size, '回写后应以裁切产物的字节数为准');
  assert.equal(api.secureCover.op.crop.x, 0.1, '裁剪参数要留下来，二次裁切才不丢');
  assert.equal(api.secureCover.uploadedName, '', '内容变了必须清掉 uploadedName，否则会复用旧地址');
  // 文件名主干换了也不能改落库名
  assert.equal(api.secureCover.name, 'my-shot.webp');
  assert.equal(api.secureCoverName(api.secureCover.name), 'cover.webp');
  assert.ok(FILE_RE.test(api.secureCoverName(api.secureCover.name)));
});
