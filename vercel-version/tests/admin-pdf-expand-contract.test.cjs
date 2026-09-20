/**
 * 「普通上传路径把 PDF 拆成逐页 WebP」的接线契约测试。
 *
 * 这块逻辑全在 public/admin/index.html 内联脚本里，没有类型系统兜底，
 * 而且依赖"files[] 里永远是真实图片 File"这个不成文约定 —— 一旦有人把 PDF 原样塞进 files[]，
 * 或把页面渲染步骤挪到别处，症状只会在上传那一刻才爆（createImageBitmap 读不了 PDF）。
 * 所以这里钉住几条关键接线，而不是测渲染细节（那部分由 secure-pdf-compress 与浏览器走查覆盖）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_PATH = path.join(ROOT, 'public', 'admin', 'index.html');
const ADMIN = fs.readFileSync(ADMIN_PATH, 'utf8');

/** 从真实源码里切出一段顶层函数体，避免测试里重写一份"看起来一样"的副本 */
function sliceFn(signature) {
  const start = ADMIN.indexOf(signature);
  assert.ok(start >= 0, `管理台里找不到 ${signature}`);
  const end = ADMIN.indexOf('\nfunction ', start + signature.length);
  assert.ok(end > start, `找不到 ${signature} 的结束位置`);
  return ADMIN.slice(start, end);
}

/** 从真实实现里摘出 pageName()，和封面契约测试一样的做法 */
function loadPageNamer() {
  const src = sliceFn('function pageName(');
  return vm.runInNewContext(`${src}\n;pageName`, {});
}

const pageName = loadPageNamer();

/* ---------------- 文件名契约 ---------------- */

test('PDF 拆出的页名经 pageName() 后必须仍是 .webp（否则站点按 .webp 取图会 404）', () => {
  // 命名规则：pageName(下标, 位数, 前缀, 源文件名) → 前缀 + 序号 + 源文件后缀
  const cases = [
    ['book-p001.webp', 0, 2, 'image01.webp'],
    ['book-p012.webp', 11, 2, 'image12.webp'],
    ['book-p100.webp', 99, 3, 'image100.webp'],
    ['没后缀', 0, 2, 'image01.webp'],          // 兜底成 webp
  ];
  for (const [sourceName, i, pad, expected] of cases) {
    const got = pageName(i, pad, 'image', sourceName);
    assert.equal(got, expected, `${sourceName} → ${got}，期望 ${expected}`);
    assert.match(got, /\.webp$/, '站点内页按 {前缀}{页码}.webp 读取，后缀不能变');
  }
});

test('PDF 页渲染产出的文件名必须带可识别的页序，避免排序乱掉', () => {
  const fn = sliceFn('async function renderPdfPageToFile(');
  assert.match(fn, /-p' \+ String\(pageNo\)\.padStart\(3, '0'\)/,
    '页序必须零填充成 3 位，否则 p10 会排在 p2 前面');
});

/* ---------------- 分流契约 ---------------- */

test('addFiles 必须分流：敏感模式整份保留 PDF，普通模式拆页', () => {
  const fn = sliceFn('function addFiles(');
  assert.ok(fn.includes('isSecureMode()'), '必须判断是否为敏感模式');
  assert.ok(fn.includes('expandPdfIntoPages(f)'), '普通模式下必须走拆页，不能丢弃 PDF');
  assert.ok(fn.includes('PDF_THUMB'), '敏感模式下要用 PDF 占位缩略图');

  // 顺序：先判 isPdfFile，再决定去留
  assert.ok(fn.indexOf('isPdfFile(f)') < fn.indexOf('expandPdfIntoPages(f)'),
    '必须先判定是 PDF 再分流');
});

test('普通模式不再直接丢弃 PDF（回归保护）', () => {
  const fn = sliceFn('function addFiles(');
  // 旧实现是 `if (isPdf) { if (!isSecureMode()) return; }` —— 普通模式下静默丢弃
  assert.ok(!/if \(!isSecureMode\(\)\)\s*return/.test(fn),
    '不能再出现"普通模式直接 return 丢掉 PDF"的写法');
});

test('敏感模式加入 PDF 必须顺手识别页数，并把结果显示到卡片角标上', () => {
  // 管理员挑「用第几页当封面」得先知道这本有多少页；页数此前只在展开「⚙ 调整」
  // 且封面解析完成后才出现，等于要先猜一个页码才能看到上限。
  const add = sliceFn('function addFiles(');
  assert.ok(add.includes('probePdfPages(prec)'),
    '敏感模式整份保留 PDF 后必须调用 probePdfPages —— 否则卡片上没有页数');
  assert.match(add, /pages:\s*0/, 'PDF 记录要带 pages 字段（0 = 尚未识别）');

  const rf = sliceFn('function renderFiles(');
  assert.ok(rf.includes('class="pg"'), 'renderFiles 必须渲染 .pg 角标');
  assert.ok(rf.includes('isPdfFile(f.file)'), '角标只给整份 PDF 项，别给拆出来的逐页图片');

  const probe = sliceFn('function probePdfPages(');
  assert.ok(probe.includes('getPdfDocument(rec.file)'), '页数必须来自真实解析，不能靠文件名猜');
  assert.ok(probe.includes('doc.numPages'), '要用 pdf.js 的 doc.numPages');
  assert.equal(/show\(\$\('main-msg'\)/.test(probe), false,
    '识别失败不该弹全局错误 —— 页数只是参考信息，不能挡上传');
});

test('拆页插进 files[] 的每一项都必须带 fromPdf 元数据（重渲染靠它）', () => {
  const fn = sliceFn('function expandPdfIntoPages(');
  assert.match(fn, /fromPdf:\s*\{[^}]*src:\s*file[^}]*pageNo:\s*pageNo[^}]*quality:\s*quality[^}]*useWebp:\s*useWebp/,
    'fromPdf 必须记录源文件 / 页码 / 当时画质 / 当时格式');
  assert.ok(fn.includes('URL.createObjectURL(pf)'),
    '拆出的每一页都要有真实缩略图，不能都用 PDF 占位图');
  assert.ok(fn.includes('files.splice.apply(files, [at, 1].concat(items))'),
    '占位项必须被替换成逐页项，而不是并排留着');
});

test('拆页失败必须把占位项摘掉并报错，不能留一个坏条目给上传阶段', () => {
  const fn = sliceFn('function expandPdfIntoPages(');
  assert.match(fn, /catch\(function\(err\)\{[\s\S]*files\.splice\(at, 1\)/,
    '失败时要移除占位项');
  assert.match(fn, /catch\(function\(err\)\{[\s\S]*show\(\$\('main-msg'\)/,
    '失败时要给用户看得见的提示');
});

test('上传前若画质/格式被改过，必须按当前设置重渲染 PDF 页（滑杆否则是哑的）', () => {
  const fn = sliceFn('function uploadAll(');
  assert.ok(fn.includes('f.fromPdf.quality !== quality'),
    '必须比对拆页时的画质与当前滑杆值');
  assert.ok(fn.includes('f.fromPdf.useWebp !== convert'),
    'WebP 开关变化也要触发重渲染');
  assert.ok(fn.includes('renderPdfPageToFile(f.fromPdf.src, f.fromPdf.pageNo'),
    '重渲染要复用同一个 PDF 文档与页码');
});

/* ---------------- 渲染细节契约 ---------------- */

test('PDF 页渲染：先铺白底再 render（顺序反了会留下透明背景，转 WebP 成黑块）', () => {
  const fn = sliceFn('async function renderPdfPageToFile(');
  const fillAt = fn.indexOf('fillRect(');
  const renderAt = fn.indexOf('page.render(');
  assert.ok(fillAt >= 0 && renderAt >= 0, '找不到铺白底或渲染调用');
  assert.ok(fillAt < renderAt, '必须 fillRect 在 page.render 之前');
});

test('PDF 页渲染有长边上限，且不会把小开本放大到失真', () => {
  assert.match(ADMIN, /var PDF_PAGE_MAX_SIDE = \d+;/,
    '必须有单页长边上限常量，否则大开本 PDF 会把体积和内存打爆');
  const fn = sliceFn('async function renderPdfPageToFile(');
  // 长边档位允许调用方覆盖（封面传更小的档位），但没传时必须回落到全局上限 ——
  // 少了回落，封面的调用会直接把长边设成 0 或 NaN。
  assert.match(fn, /var side = Number\(maxSide\) \|\| PDF_PAGE_MAX_SIDE;/,
    '未传入 maxSide 时必须回落到 PDF_PAGE_MAX_SIDE');
  assert.match(fn, /Math\.min\(side \/ Math\.max\(base\.width, base\.height\), 2\)/,
    '长边收敛到档位，同时把放大倍数封顶在 2 倍');
});

test('pdf.js worker 有兜底设置（tools.js 没加载时也要能用）', () => {
  const fn = sliceFn('function pdfJsReady(');
  assert.ok(fn.includes('pdf.min.js') === false, 'worker 文件名应是 pdf.worker.min.js');
  assert.ok(fn.includes('pdf.worker.min.js'), '缺少 workerSrc 兜底会导致 fake worker 报错');
});

test('PDF 文档按文件缓存，重渲染不会重新解析一遍', () => {
  const fn = sliceFn('function getPdfDocument(');
  assert.ok(fn.includes('pdfDocCache.has(file)'), '必须命中缓存');
  assert.ok(/catch\(function\(err\)\{[\s\S]*pdfDocCache\.delete\(file\)/.test(fn),
    '解析失败时必须清缓存，否则会把 reject 的 Promise 永久挂住');
});

/* ---------------- 选择器契约 ---------------- */

test('文件选择器在两种模式下都收 PDF', () => {
  assert.match(ADMIN, /\$\('picker'\)\.accept = 'image\/\*\/?\s*,\s*application\/pdf'|accept = 'image\/\*,application\/pdf'/,
    'accept 不能再按模式二选一 —— 两条路径都支持 PDF 了');
});

test('从敏感模式切回普通模式时，整份 PDF 会被补拆页', () => {
  const fn = sliceFn('function refreshSecureUI(');
  assert.match(fn, /if \(!on\) \{[\s\S]*isPdfFile\(f\.file\)[\s\S]*expandPdfIntoPages\(f\.file\)/,
    '否则"敏感模式加 PDF → 取消勾选 → 上传"会在转码阶段炸');
});

/* ==========================================================================
 * 深度加密路径的 PDF 重渲染器（renderPdfPagesForVault）
 * ------------------------------------------------------------------------
 * 这一节是一次真实浏览器走查后补的回归护栏。当时的 bug 是：
 * `scale = min(maxSide / baseLong, 1)` 里的「只降不升」，在 PDF 上是错的 ——
 * pdf.js 的 viewport(scale:1) 返回**页面点尺寸**（A4 就是 595×842），
 * 不是内嵌图的像素尺寸。于是 maxSide 给 2000 和 1400 都算出 scale=1，
 * 两档全部退化成同一张 595×842 的低清图，还把原图分辨率白丢一大半。
 * 单测当时没抓到，因为渲染器是用桩注入的 —— 桩不会暴露 pdf.js 的坐标系语义。
 * ======================================================================== */

const VAULT_RENDER_FN = sliceFn('async function renderPdfPagesForVault(');
const VAULT_MAX_SCALE_DECL = ADMIN.match(/var PDF_VAULT_MAX_SCALE = \d+;/);
assert.ok(VAULT_MAX_SCALE_DECL, '找不到 PDF_VAULT_MAX_SCALE');

/** A4 页：点尺寸 595×842，内嵌一张 1400×2000 的扫描图 —— 真实漫画本的典型形态 */
const A4 = { w: 595, h: 842 };

/**
 * 用受控的 pdf.js 桩执行真实源码，记录「渲染那一刻 canvas 的实际像素尺寸」。
 * 必须在 render 时取尺寸：编码之后源码会把 canvas.width/height 归零。
 */
async function renderWithStub(maxSide, quality) {
  const rendered = [];

  const page = {
    getViewport({ scale }) {
      return { width: A4.w * scale, height: A4.h * scale };
    },
    render({ canvasContext, viewport }) {
      rendered.push({
        px: { w: canvasContext.canvas.width, h: canvasContext.canvas.height },
        vp: { w: viewport.width, h: viewport.height },
      });
      return { promise: Promise.resolve() };
    },
    cleanup() {},
  };

  const sandbox = {
    pdfJsReady: () => true,
    getPdfDocument: async () => ({ numPages: 2, getPage: async () => page }),
    canvasToJpegBlob: async () => ({ type: 'image/jpeg' }),
    document: {
      createElement() {
        const c = { width: 0, height: 0 };
        c.getContext = () => ({ fillStyle: '', fillRect() {}, canvas: c });
        return c;
      },
    },
    File: class {
      constructor(parts, name, opts) {
        this.name = name;
        this.type = opts && opts.type;
      }
    },
    console,
  };

  const factory = vm.runInNewContext(
    `${VAULT_MAX_SCALE_DECL[0]}\n${VAULT_RENDER_FN}\n;renderPdfPagesForVault`,
    sandbox
  );
  const files = await factory({ name: 'book.pdf' }, { maxSide, quality });
  return { files, rendered };
}

test('PDF 重渲染必须真的把长边渲染到目标值，而不是退化成 595×842', async () => {
  const { rendered } = await renderWithStub(2000, 0.85);
  const first = rendered[0];

  assert.notEqual(
    `${first.px.w}x${first.px.h}`,
    '595x842',
    '渲染尺寸等于页面点尺寸 = scale 被夹在 1，「只降不升」在 PDF 上是错的'
  );
  assert.ok(
    Math.max(first.px.w, first.px.h) >= 1900,
    '长边必须接近 maxSide(2000)，实测 ' + first.px.w + '×' + first.px.h
  );
  assert.ok(first.px.h > first.px.w, 'A4 是竖版，长边应落在高上');
});

test('两档必须渲染出**不同**的像素尺寸，否则档位形同虚设', async () => {
  const a = await renderWithStub(2000, 0.85);
  const b = await renderWithStub(1400, 0.8);

  const dims = (r) => `${r.rendered[0].px.w}x${r.rendered[0].px.h}`;
  assert.notEqual(dims(a), dims(b), '两档渲染尺寸必须不同：' + dims(a) + ' vs ' + dims(b));
  assert.ok(
    Math.max(a.rendered[0].px.w, a.rendered[0].px.h) > Math.max(b.rendered[0].px.w, b.rendered[0].px.h),
    '2000 档的长边必须大于 1400 档'
  );
});

test('放大倍数必须封顶，免得小开本矢量 PDF 被放大成巨型位图', async () => {
  const declared = Number(VAULT_MAX_SCALE_DECL[0].match(/(\d+)/)[1]);
  assert.ok(declared >= 2 && declared <= 4, '上限取 ' + declared + '，超出这个区间的值不合理');

  // 给一个离谱的 maxSide，scale 必须被夹在声明值上
  const { rendered } = await renderWithStub(99999, 0.85);
  const longSide = Math.max(rendered[0].px.w, rendered[0].px.h);
  const expectedCap = Math.round(A4.h * declared);
  assert.ok(longSide <= expectedCap + 1, '长边 ' + longSide + ' 超过封顶值 ' + expectedCap);
});

test('逐页产出：页序文件名、JPEG 类型、每页都渲染一次', async () => {
  const { files, rendered } = await renderWithStub(1600, 0.8);
  // Array.from 是必需的：files 由 vm realm 里的 Array 构造，
  // 直接 deepStrictEqual 会因原型不同而失败（值其实完全一致）
  const names = Array.from(files, (f) => f.name);

  assert.equal(rendered.length, 2, '两页就必须渲染两次');
  assert.equal(files.length, 2);
  assert.deepEqual(names, ['vault-p001.jpg', 'vault-p002.jpg'], '页序须零填充 3 位');
  assert.ok(Array.from(files).every((f) => f.type === 'image/jpeg'),
    'jsPDF 走 DCTDecode 只吃 JPEG，不能出 WebP/PNG');
});
