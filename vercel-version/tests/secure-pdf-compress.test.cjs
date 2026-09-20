/**
 * ============================================================================
 * secure-pdf-compress.test.cjs — 「不损伤画质」压缩策略的验收
 * ----------------------------------------------------------------------------
 * 验三件事：
 *   ① readJpegHeader 能只扫标记段读出真实宽高（直通路径全靠它）
 *   ② buildPageImage 的**路径判定**：JPEG 直通 / 降采样 / PNG 策略
 *   ③ imagesToPdfBytes 走直通时，PDF 里确实嵌着**原始 JPEG 字节**
 *      （这是"零重编码"的硬证据 —— 比"体积看起来合理"强得多）
 *
 * 运行：
 *   LH_JSPDF_UMD=/tmp/jspdf.umd.min.js node --test tests/secure-pdf-compress.test.cjs
 * 缺 jsPDF 时只有第 ③ 组整体跳过，前两组照跑（它们不需要 jsPDF）。
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
// 真实 JPEG：418×208 · 3 分量 · 73,387 字节（与 secure-pdf-merge 用的是同一张）
const SAMPLE_JPEG = path.join(__dirname, '..', 'public', 'daxigua', 'res', 'share.jpg');
const JPEG_BYTES = fs.readFileSync(SAMPLE_JPEG);
const JPEG_SIZE = JPEG_BYTES.length;

/* ---------------- 可控 canvas 桩 ---------------- */
let lastEncode = null;   // { type, quality, width, height }
let alphaProbe = 255;    // 非 255 表示画布里存在透明像素
let compositeOps = [];   // 记录 globalCompositeOperation 的变更顺序

function makeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        fillRect() {},
        drawImage() {},
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(Math.max(4, w * h * 4));
          data.fill(255);
          if (alphaProbe !== 255) data[3] = alphaProbe;
          return { data };
        },
      };
    },
    toDataURL(type, quality) {
      lastEncode = { type, quality, width: canvas.width, height: canvas.height };
      return 'data:' + type + ';base64,' + Buffer.from('ENCODED-' + type).toString('base64');
    },
  };
  // 用 defineProperty 记录 composite 变更，便于断言"白底铺在图像之下"
  const origGetContext = canvas.getContext;
  canvas.getContext = function () {
    const ctx = origGetContext.call(canvas);
    let _op = ctx.globalCompositeOperation;
    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get() { return _op; },
      set(v) { _op = v; compositeOps.push(v); },
    });
    return ctx;
  };
  return canvas;
}

globalThis.document = {
  createElement: () => makeCanvas(),
  body: makeCanvas(),
  documentElement: makeCanvas(),
};
globalThis.createImageBitmap = async () => ({ width: 800, height: 1200, close() {} });

vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });
const vault = globalThis.LeVihanVault;
assert.ok(vault, 'secure-upload.js 未能导出 LeVihanVault');

/* ---------------- 假文件对象 ---------------- */

/** 带真实字节的 JPEG（能走直通） */
const jpegFile = (name = 'page01.jpg') => ({
  name,
  type: 'image/jpeg',
  size: JPEG_SIZE,
  arrayBuffer: async () => JPEG_BYTES.buffer.slice(JPEG_BYTES.byteOffset, JPEG_BYTES.byteOffset + JPEG_BYTES.byteLength),
});

/** 明确是 PNG：不该被读字节去试 JPEG 直通 */
let pngBytesRead = 0;
const pngFile = (name = 'page01.png') => ({
  name,
  type: 'image/png',
  size: 4096,
  arrayBuffer: async () => { pngBytesRead += 1; return new ArrayBuffer(16); },
});

const resetStubs = () => { lastEncode = null; compositeOps = []; pngBytesRead = 0; };

/* ==========================================================================
 * ① readJpegHeader —— 只扫标记段，不解码像素
 * ======================================================================== */

test('readJpegHeader：从真实 JPEG 读出宽高与分量数', () => {
  const head = vault.readJpegHeader(new Uint8Array(JPEG_BYTES));
  assert.ok(head, '必须识别出 SOF');
  assert.equal(head.width, 418);
  assert.equal(head.height, 208);
  assert.equal(head.components, 3, '这张样本是 RGB JPEG');
});

test('readJpegHeader：非 JPEG 一律返回 null', () => {
  assert.equal(vault.readJpegHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'PNG 魔数');
  assert.equal(vault.readJpegHeader(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'PDF 魔数');
  assert.equal(vault.readJpegHeader(new Uint8Array(0)), null, '空字节');
  assert.equal(vault.readJpegHeader(null), null, 'null');
});

test('readJpegHeader：截断的 JPEG 不会越界抛错，返回 null', () => {
  // 只留 SOI + 一段不完整的标记，解析器必须安全退出而不是读越界
  const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  assert.equal(vault.readJpegHeader(truncated), null);
});

/* ==========================================================================
 * ② buildPageImage —— 路径判定
 * ======================================================================== */

test('JPEG 源 + 未限制长边 → 走原字节直通，尺寸取自 JPEG 头而非解码', async () => {
  resetStubs();
  const placed = await vault.buildPageImage(jpegFile(), 0);

  assert.equal(placed.passthrough, true, '必须走直通');
  assert.equal(placed.downscaled, false);
  assert.equal(placed.format, 'JPEG');
  assert.equal(placed.width, 418, '宽必须来自 JPEG SOF 头');
  assert.equal(placed.height, 208);
  assert.equal(lastEncode, null, '直通路径绝不能碰 canvas 编码器');
  assert.match(placed.data, /^data:image\/jpeg;base64,/);
  // 直通必须原样搬运字节：解开 base64 后应与源文件逐字节相同
  const carried = Buffer.from(placed.data.split(',')[1], 'base64');
  assert.equal(carried.length, JPEG_SIZE, '直通的字节数必须等于源文件');
  assert.deepEqual(carried, JPEG_BYTES, '直通必须逐字节还原源 JPEG');
});

test('JPEG 源 + 长边上限小于图宽 → 放弃直通，改走降采样', async () => {
  resetStubs();
  const placed = await vault.buildPageImage(jpegFile(), 200);

  assert.equal(placed.passthrough, false, '超限就不能直通');
  assert.equal(placed.downscaled, true);
  assert.ok(lastEncode, '应该经过 canvas 编码');
  // 桩里的 createImageBitmap 固定 800×1200（竖版），长边是 1200（高）。
  // 上限 200 约束的是长边 → 高变 200，宽按比例 133。
  assert.equal(lastEncode.height, 200, '长边（这里是高）必须收到上限值');
  assert.equal(lastEncode.width, 133, '短边按原始比例跟随');
  assert.equal(lastEncode.type, 'image/jpeg');
  assert.equal(placed.width, 133);
  assert.equal(placed.height, 200);
});

test('JPEG 源需要降采样时也必须输出 JPEG，不能因为 PNG_POLICY=keep 就重编码成 PNG', async () => {
  // 回归保护：早期实现把 PNG_POLICY 无差别套到所有源上，
  // 导致一张有损 JPEG 被重编码成无损 PNG —— 体积暴涨且救不回任何信息。
  resetStubs();
  const saved = vault.CONFIG.PNG_POLICY;
  try {
    vault.CONFIG.PNG_POLICY = 'keep';
    const placed = await vault.buildPageImage(jpegFile(), 200);
    assert.equal(placed.passthrough, false);
    assert.equal(placed.format, 'JPEG', 'JPEG 源走 canvas 时仍必须是 JPEG');
    assert.equal(lastEncode.type, 'image/jpeg');
  } finally {
    vault.CONFIG.PNG_POLICY = saved;
  }
});

test('JPEG 源 + 长边上限大于图宽 → 仍然直通（上限不触发就零损失）', async () => {
  resetStubs();
  const placed = await vault.buildPageImage(jpegFile(), 4000);
  assert.equal(placed.passthrough, true);
  assert.equal(lastEncode, null);
});

test('PNG 源不会被读字节去试 JPEG 直通', async () => {
  resetStubs();
  await vault.buildPageImage(pngFile(), 0);
  assert.equal(pngBytesRead, 0, '明确是 PNG 就不该白读一遍字节');
});

test('PNG_POLICY=keep → 保持 PNG 无损（严格零画质损失）', async () => {
  resetStubs();
  const saved = vault.CONFIG.PNG_POLICY;
  try {
    vault.CONFIG.PNG_POLICY = 'keep';
    const placed = await vault.buildPageImage(pngFile(), 0);
    assert.equal(placed.format, 'PNG', 'keep 策略下必须输出 PNG');
    assert.equal(lastEncode.type, 'image/png');
    assert.equal(compositeOps.length, 0, '保持 PNG 就不该铺白底（白底会毁掉透明通道）');
  } finally {
    vault.CONFIG.PNG_POLICY = saved;
  }
});

test('PNG_POLICY=auto → 无透明像素时转 JPEG（省体积的那一档）', async () => {
  resetStubs();
  alphaProbe = 255;   // 全不透明
  const saved = vault.CONFIG.PNG_POLICY;
  try {
    vault.CONFIG.PNG_POLICY = 'auto';
    const placed = await vault.buildPageImage(pngFile(), 0);
    assert.equal(placed.format, 'JPEG', '无 alpha 就该转 JPEG');
    assert.equal(lastEncode.type, 'image/jpeg');
    assert.ok(compositeOps.includes('destination-over'),
      '必须用 destination-over 把白底铺在图像之下，而不是先 fillRect 再画图');
    assert.equal(compositeOps[compositeOps.length - 1], 'source-over', '铺完白底要还原合成模式');
  } finally {
    vault.CONFIG.PNG_POLICY = saved;
  }
});

test('PNG_POLICY=auto → 真有透明像素时保留 PNG（不丢透明信息）', async () => {
  resetStubs();
  alphaProbe = 0;     // 存在全透明像素
  const saved = vault.CONFIG.PNG_POLICY;
  try {
    vault.CONFIG.PNG_POLICY = 'auto';
    const placed = await vault.buildPageImage(pngFile(), 0);
    assert.equal(placed.format, 'PNG', '有 alpha 就必须保留 PNG，JPEG 装不下透明');
  } finally {
    vault.CONFIG.PNG_POLICY = saved;
    alphaProbe = 255;
  }
});

test('JPEG_QUALITY 默认不再是 0.92（它高于常见源图质量，会让体积变大）', () => {
  assert.ok(vault.CONFIG.JPEG_QUALITY < 0.92,
    'JPEG_QUALITY 必须低于 0.92，否则重编码出的体积会超过源图');
  assert.equal(vault.CONFIG.IMAGE_LONG_SIDE_MAX, 0, '默认不降采样，否则就不是"不损伤画质"了');
  assert.equal(vault.CONFIG.PNG_POLICY, 'keep', '默认取严格无损，不替用户做有损决定');
});

/* ==========================================================================
 * ③ 真实 jsPDF：直通嵌入的证据
 * ======================================================================== */

function firstExisting(candidates) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return '';
}

const JSPDF_UMD_PATH = firstExisting([
  process.env.LH_JSPDF_UMD,
  path.join(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
  '/tmp/jspdf.umd.min.js',
]);

function loadJsPdf() {
  try {
    const mod = require('jspdf');
    if (mod && typeof mod.jsPDF === 'function') return mod.jsPDF;
  } catch { /* 走 UMD */ }
  if (JSPDF_UMD_PATH) {
    vm.runInThisContext(fs.readFileSync(JSPDF_UMD_PATH, 'utf8'), { filename: JSPDF_UMD_PATH });
    const lib = globalThis.jspdf;
    if (lib && typeof lib.jsPDF === 'function') return lib.jsPDF;
  }
  return null;
}

const JsPDF = loadJsPdf();

if (!JsPDF) {
  test('直通嵌入验收', { skip: '未找到 jspdf：设置 LH_JSPDF_UMD=<jspdf.umd.min.js 路径>' }, () => {});
} else {
  globalThis.jspdf = { jsPDF: JsPDF };

  test('直通：PDF 里嵌的是原始 JPEG 字节（零重编码的硬证据）', async () => {
    const bytes = Buffer.from(await vault.imagesToPdfBytes([jpegFile()]));
    const latin = bytes.toString('latin1');

    assert.ok(vault.isPdfBytes(bytes), '必须是合法 PDF');
    assert.match(latin, /DCTDecode/, 'JPEG 必须以 DCTDecode 滤镜嵌入');

    // 取源 JPEG 中段一段有辨识度的字节，去 PDF 里找。
    // 若 jsPDF 做了重编码，这段字节不可能原样出现。
    const probe = JPEG_BYTES.subarray(2000, 2048);
    assert.notEqual(bytes.indexOf(probe), -1,
      'PDF 里找不到源 JPEG 的原始字节片段 —— 说明发生了重编码，直通没生效');
  });

  test('直通：体积只有源图 + 少量 PDF 结构开销，不再膨胀', async () => {
    const bytes = Buffer.from(await vault.imagesToPdfBytes([jpegFile()]));
    const overhead = bytes.length - JPEG_SIZE;

    assert.ok(overhead > 0, '总得有点 PDF 结构开销');
    assert.ok(overhead < 20 * 1024,
      '单页直通的结构开销应远小于 20KB，实测只有几 KB；' +
      '若这个数暴涨，说明走了 canvas 重编码（旧行为会膨胀约 15%）');
  });

  test('直通：页面尺寸按 JPEG 真实像素 × 0.75 换算（418×208 → 313.5×156pt）', async () => {
    const bytes = Buffer.from(await vault.imagesToPdfBytes([jpegFile()]));
    assert.match(
      bytes.toString('latin1'),
      /MediaBox\s*\[\s*0\s+0\s+313\.5\d*\s+156\.?\d*\s*\]/,
      'MediaBox 必须来自 JPEG 头的真实尺寸，而不是 canvas 解码结果'
    );
  });

  test('onStats 回调报出直通/重编码的页数', async () => {
    let seen = null;
    await vault.imagesToPdfBytes([jpegFile('a.jpg'), jpegFile('b.jpg')], {
      onStats: (s) => { seen = s; },
    });
    assert.ok(seen, 'onStats 必须被调用');
    assert.equal(seen.pages, 2);
    assert.equal(seen.passthrough, 2, '两张都是合格 JPEG，应全部直通');
    assert.equal(seen.reencoded, 0);
    assert.equal(seen.sourceBytes, JPEG_SIZE * 2);
    assert.ok(seen.pdfBytes > 0);
  });

  test('返回值签名不变：仍是 ArrayBuffer（对外导出的 API 契约）', async () => {
    const out = await vault.imagesToPdfBytes([jpegFile()]);
    assert.ok(out instanceof ArrayBuffer,
      'imagesToPdfBytes 必须继续返回 ArrayBuffer —— 测试与调用方都依赖它');
  });
}
