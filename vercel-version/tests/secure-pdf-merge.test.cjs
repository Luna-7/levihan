/**
 * ============================================================================
 * secure-pdf-merge.test.cjs — 「图片按顺序合并成 PDF」这段的无浏览器验收
 * ----------------------------------------------------------------------------
 * 这一步原本只能在真实浏览器里跑（canvas + jsPDF）。这里用最小的 DOM 桩把它拉到 Node，
 * 验的是**容易写错的那部分**：jsPDF 的 unit / format 数组 / addPage 签名 / addImage 格式串，
 * 以及"一图一页"的页数、页面尺寸换算、和后续加密的端到端往返。
 * canvas 与图片解码本身不是验证对象，所以被桩化。
 *
 * 运行（二选一）：
 *   LH_JSPDF_UMD=/path/to/jspdf.umd.min.js node --test tests/secure-pdf-merge.test.cjs
 *   NODE_PATH=<有 jspdf 的 node_modules> node --test tests/secure-pdf-merge.test.cjs
 * 两者都没有时整个文件自动跳过，不影响仓库原有的测试命令。
 * 推荐用页面同款 UMD 构建（https://cdn.staticfile.net/jspdf/2.5.1/jspdf.umd.min.js），
 * 这样测的就是浏览器真正加载的那份产物。
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
const SAMPLE_JPEG = path.join(__dirname, '..', 'public', 'daxigua', 'res', 'share.jpg');

/* ---------------- 最小 DOM 桩：只覆盖流水线真正用到的 API ---------------- */
function fakeElement() {
  return {
    style: {},
    width: 0,
    height: 0,
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    addEventListener() {},
    getContext() {
      return { fillStyle: '#000', fillRect() {}, drawImage() {} };
    },
    toDataURL() {
      return SAMPLE_DATA_URL;
    },
  };
}

const SAMPLE_DATA_URL = 'data:image/jpeg;base64,' + fs.readFileSync(SAMPLE_JPEG).toString('base64');

globalThis.document = { createElement: () => fakeElement(), body: fakeElement(), documentElement: fakeElement() };
// 注意：Node 22 的 globalThis.navigator 是只读 getter，不能赋值，也不需要赋值
// 固定尺寸，避免依赖真实图片解码
globalThis.createImageBitmap = async () => ({ width: 800, height: 1200, close() {} });

/** jsPDF 来源：依次尝试 环境变量 → 项目 node_modules → CDN 下载的 UMD 构建（页面同款） */
function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
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
    if (mod && typeof mod.jsPDF === 'function') return { jsPDF: mod.jsPDF, source: 'node_modules' };
  } catch {
    /* 仓库没装 jspdf，走下面的 UMD 分支 */
  }
  if (JSPDF_UMD_PATH) {
    vm.runInThisContext(fs.readFileSync(JSPDF_UMD_PATH, 'utf8'), { filename: JSPDF_UMD_PATH });
    const lib = globalThis.jspdf;
    if (lib && typeof lib.jsPDF === 'function') return { jsPDF: lib.jsPDF, source: JSPDF_UMD_PATH };
  }
  return null;
}

const jsPdf = loadJsPdf();

if (!jsPdf) {
  // 显式登记为 skip：不能让"没跑"看起来像"跑过了"
  test('图片合并 PDF 验收', { skip: '未找到 jspdf：设置 LH_JSPDF_UMD=<jspdf.umd.min.js 路径>，或用 NODE_PATH 指向含 jspdf 的 node_modules' }, () => {});
} else {
  console.log('[info] jsPDF 来源：' + jsPdf.source);
  globalThis.jspdf = { jsPDF: jsPdf.jsPDF };

  vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });
  const vault = globalThis.LeVihanVault;
  assert.ok(vault && typeof vault.imagesToPdfBytes === 'function', 'secure-upload.js 未能导出 LeVihanVault');

  const asFile = (name) => ({ name, type: 'image/jpeg', size: 1024 });
  const pageCountOf = (bytes) => (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

  test('两张图片合并出的 PDF：文件头正确、恰好两页', async () => {
    const bytes = Buffer.from(await vault.imagesToPdfBytes([asFile('a.jpg'), asFile('b.jpg')]));

    assert.ok(vault.isPdfBytes(bytes), '必须以 %PDF- 开头');
    assert.match(bytes.toString('latin1'), /%PDF-1\.\d/);
    assert.ok(bytes.toString('latin1').includes('%%EOF'), 'PDF 必须有 %%EOF 收尾');
    assert.equal(pageCountOf(bytes), 2, '一图一页：两张图必须得到两页');
  });

  test('页面尺寸按 96dpi→72pt 换算（800x1200px → 600x900pt）', async () => {
    const bytes = Buffer.from(await vault.imagesToPdfBytes([asFile('only.jpg')]));
    // jsPDF 对整数值会写成 "600." （带尾点），所以这里不能要求点号后必须有数字
    assert.match(
      bytes.toString('latin1'),
      /MediaBox\s*\[\s*0\s+0\s+600\.?\d*\s+900\.?\d*\s*\]/,
      'MediaBox 应为 600x900pt'
    );
  });

  test('文件名按自然排序合并：image2 排在 image10 之前', async () => {
    const bytes = Buffer.from(
      await vault.imagesToPdfBytes([asFile('image10.jpg'), asFile('image2.jpg'), asFile('image1.jpg')])
    );
    assert.ok(vault.isPdfBytes(bytes));
    assert.equal(pageCountOf(bytes), 3);
  });

  test('端到端：图片 → PDF → 加密 → Base64 → 解密 → 字节完全一致', async () => {
    const pdfBytes = new Uint8Array(await vault.imagesToPdfBytes([asFile('a.jpg'), asFile('b.jpg'), asFile('c.jpg')]));

    const base64 = await vault.encryptPdfBytesToBase64(pdfBytes);
    assert.match(base64, /^[A-Za-z0-9+/]+={0,2}$/, '密文必须是纯 Base64');

    const restored = Buffer.from(await vault.decryptVaultToPdfBytes(base64));
    assert.deepEqual(restored, Buffer.from(pdfBytes), '解密结果必须与加密前的 PDF 逐字节相同');
    assert.ok(vault.isPdfBytes(restored), '还原结果必须能通过 PDF 魔数校验');
    assert.equal(pageCountOf(restored), 3, '解密后的 PDF 结构应完好，仍是 3 页');
  });

  test('体积：AES 填充不超过 16 字节，Base64 膨胀在 40% 以内', async () => {
    const pdfBytes = new Uint8Array(await vault.imagesToPdfBytes([asFile('a.jpg')]));
    const base64 = await vault.encryptPdfBytesToBase64(pdfBytes);

    const padded = pdfBytes.length + (16 - ((pdfBytes.length % 16) || 16));
    assert.equal(vault.base64ToBytes(base64).length, padded, '填充后长度必须对齐 16 字节分组');
    assert.ok(padded - pdfBytes.length <= 16, '填充不得超过一个分组');
    assert.ok(base64.length < pdfBytes.length * 1.4, 'Base64 膨胀不应超过 40%');
  });
}
