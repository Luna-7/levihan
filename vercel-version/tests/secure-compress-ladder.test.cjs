/**
 * ============================================================================
 * secure-compress-ladder.test.cjs — 「先压缩、再判定」两段式的验收
 * ----------------------------------------------------------------------------
 * 验的是**选档决策**，不是编码结果：
 *   ① 判定依据必须是产出的 PDF 实测体积，而不是输入体积之和
 *   ② 阶梯"够用即停"：无损能过就绝不多降一档
 *   ③ 降了画质必须如实上报（degraded），不能静默降
 *   ④ 每档跑完 CONFIG 必须还原 —— 包括抛错路径
 *   ⑤ PDF 输入走图像旋钮是空转，必须识别并交给 PDF 专用档
 *
 * 为什么用「假 jsPDF」而不是真 jsPDF：
 *   本文件要控制"产出 PDF 有多大"来驱动选档。真 jsPDF 的体积由它内部的
 *   编码器决定，测试无法操纵；换成假 jsPDF 后，产出体积 = 嵌入数据总长，
 *   完全由 canvas 桩决定，选档逻辑就能被确定性地钉住。
 *   真实编码行为（DCTDecode 直通、字节级零重编码）另有
 *   secure-pdf-compress.test.cjs 用**真 jsPDF** 覆盖，两者互不替代。
 *
 * 运行：node --test tests/secure-compress-ladder.test.cjs
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
const JPEG_BYTES = fs.readFileSync(SAMPLE_JPEG);
const JPEG_SIZE = JPEG_BYTES.length;

/* ==========================================================================
 * 环境桩
 * ======================================================================== */

/** 源图尺寸。故意大于所有长边档，好让每个长边档都真的触发降采样 */
const SRC_W = 3000;
const SRC_H = 4000;

/**
 * 伪造的编码体积。
 * 刻意复刻真实世界的两条特征：
 *   - PNG 无损在网点纹理下几乎压不动（按每像素粗估，远大于 JPEG）
 *   - JPEG 体积随 quality 线性缩放
 * 数值量级被 /100 缩小，只是为了让测试跑得快，不影响档位之间的单调关系。
 */
function fabricatedLength(type, quality, w, h) {
  const px = w * h;
  const body = type === 'image/png'
    ? Math.round((px * 1.5) / 100)
    : Math.round((px * quality * 0.35) / 100);
  return body + 32;
}

let lastEncode = null;

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
          data.fill(255); // 全不透明 → PNG 策略 'auto' 会转 JPEG
          return { data };
        },
      };
    },
    toDataURL(type, quality) {
      lastEncode = { type, quality, width: canvas.width, height: canvas.height };
      const len = fabricatedLength(type, quality, canvas.width, canvas.height);
      return 'data:' + type + ';base64,' + 'A'.repeat(Math.max(4, len));
    },
  };
  return canvas;
}

globalThis.document = {
  createElement: () => makeCanvas(),
  body: makeCanvas(),
  documentElement: makeCanvas(),
};

/**
 * normalizeToPdfBytes 走的是 readFileAsArrayBuffer，那条路**总是**用 FileReader
 * （file.arrayBuffer 的快捷路径只在 readBytesIfPossible 里）。Node 没有 FileReader，必须补桩。
 */
globalThis.FileReader = class {
  readAsArrayBuffer(file) {
    Promise.resolve()
      .then(() => file.arrayBuffer())
      .then(
        (buf) => { this.result = buf; if (this.onload) this.onload(); },
        (err) => { if (this.onerror) this.onerror(err); }
      );
  }
};

let bitmapDims = { width: SRC_W, height: SRC_H };
let bitmapShouldThrow = false;
globalThis.createImageBitmap = async () => {
  if (bitmapShouldThrow) throw new Error('桩：解码失败');
  return { width: bitmapDims.width, height: bitmapDims.height, close() {} };
};

/**
 * 假 jsPDF：产出体积 = 嵌入数据总长，且带头部合法的 %PDF- 前缀
 * （normalizeToPdfBytes 会校验文件头，不能省）。
 */
let lastPdfImages = [];
class FakeJsPDF {
  constructor(opts) { this.opts = opts; this.images = []; }
  addPage() { /* 页数不影响测试关心的体积 */ }
  addImage(data, format, x, y, w, h) {
    this.images.push({ data, format, w, h });
    lastPdfImages.push({ format, w, h, bytes: String(data).length });
  }
  output() {
    const payload = this.images.reduce((s, im) => s + String(im.data).length, 0);
    const head = Buffer.from('%PDF-1.7\n', 'utf8');
    const buf = Buffer.alloc(head.length + payload, 0x41);
    head.copy(buf);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
}
globalThis.jspdf = { jsPDF: FakeJsPDF };

vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });
const vault = globalThis.LeVihanVault;
assert.ok(vault && typeof vault.runCompressLadder === 'function', 'secure-upload.js 未导出 runCompressLadder');

const KEYS_TOUCHED = ['IMAGE_LONG_SIDE_MAX', 'PNG_POLICY', 'JPEG_QUALITY', 'MAX_INPUT_BYTES'];

function snapshotConfig() {
  const snap = {};
  KEYS_TOUCHED.forEach((k) => { snap[k] = vault.CONFIG[k]; });
  return snap;
}
function assertConfigRestored(snap, msg) {
  KEYS_TOUCHED.forEach((k) => assert.equal(vault.CONFIG[k], snap[k], msg + '：' + k + ' 未还原'));
}

/** 仓库默认的阶梯档位，测试改过之后要能还原回去 */
const DEFAULT_LADDER = JSON.parse(JSON.stringify(vault.CONFIG.COMPRESS_LADDER));

/** 把 CONFIG 拉回仓库默认值，免得测试之间互相污染 */
function resetConfig() {
  vault.configure({
    MAX_OUTPUT_BYTES: 60 * 1024 * 1024,
    MAX_INPUT_BYTES: 1024 * 1024 * 1024,
    AUTO_DOWNSCALE: true,
    COMPRESS_LADDER: JSON.parse(JSON.stringify(DEFAULT_LADDER)),
    IMAGE_LONG_SIDE_MAX: 0,
    PNG_POLICY: 'keep',
    JPEG_QUALITY: 0.9,
    renderPdfPages: null,
  });
}

/* ---------------- 假文件对象 ---------------- */

/** PNG 源：走 canvas 路径，体积由桩决定 */
const pngFile = (name = 'page01.png') => ({
  name,
  type: 'image/png',
  size: 4096,
  arrayBuffer: async () => new ArrayBuffer(16),
});

/** JPEG 源：长边 ≤ maxSide 时会走原字节直通 */
const jpegFile = (name = 'page01.jpg') => ({
  name,
  type: 'image/jpeg',
  size: JPEG_SIZE,
  arrayBuffer: async () =>
    JPEG_BYTES.buffer.slice(JPEG_BYTES.byteOffset, JPEG_BYTES.byteOffset + JPEG_BYTES.byteLength),
});

/** 假 PDF：体积可控、文件头合法 */
const pdfFile = (byteLength = 400000, name = 'book.pdf') => {
  const buf = Buffer.alloc(byteLength, 0x42);
  Buffer.from('%PDF-1.7\n', 'utf8').copy(buf);
  return {
    name,
    type: 'application/pdf',
    size: byteLength,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

test.beforeEach(() => { resetConfig(); lastPdfImages = []; });

/* ==========================================================================
 * ① 判定依据：产出，而不是输入
 * ======================================================================== */

test('输入闸门已降级为安全阀：声明 200MB 的输入不再被"压缩前"拦下', async () => {
  assert.ok(
    vault.CONFIG.MAX_INPUT_BYTES >= 1024 * 1024 * 1024,
    'MAX_INPUT_BYTES 必须远高于任何真实批次（旧值 60MB 曾误杀 67.71MB 的批次）'
  );

  // size 声明 200MB，实际内容很小 —— 旧实现会在这里直接抛「请分批上传」
  const fat = pngFile('huge.png');
  fat.size = 200 * 1024 * 1024;
  const out = await vault.normalizeToPdfBytes([fat]);
  assert.ok(out.pdfBytes.length > 0, '声明体积大不应被拒 —— 判定已经移到产出侧');
});

test('产出体积才是判定依据：目标给足时无损档一次通过', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 10 * 1024 * 1024 });
  const out = await vault.runCompressLadder([pngFile()]);

  assert.equal(out.ladder.attempts.length, 1, '达标就该立刻停手，不许多跑档位');
  assert.equal(out.ladder.chosenId, 'lossless');
  assert.equal(out.ladder.degraded, false, '走无损档不算降画质');
  assert.equal(out.ladder.withinTarget, true);
});

/* ==========================================================================
 * ② 阶梯：无损优先、够用即停
 * ======================================================================== */

test('无损超目标时自动降档，且降到"刚好够"的那一档就停', async () => {
  // 先量出无损档的产出，再据此定一个必须降档的目标
  vault.configure({ MAX_OUTPUT_BYTES: 0 });
  const lossless = await vault.runCompressLadder([pngFile()]);
  const losslessBytes = lossless.ladder.outputBytes;
  assert.ok(losslessBytes > 0);

  // 目标 = 无损产出的 95%：无损必挂，PNG 转 JPEG 必过
  vault.configure({ MAX_OUTPUT_BYTES: Math.floor(losslessBytes * 0.95) });
  const out = await vault.runCompressLadder([pngFile()]);

  assert.equal(out.ladder.chosenId, 'png2jpeg', 'PNG 无损超目标时，下一步应是转 JPEG 而不是直接降分辨率');
  assert.equal(out.ladder.degraded, true);
  assert.equal(out.ladder.withinTarget, true);
  assert.equal(out.ladder.attempts.length, 2, '够用即停：不该继续跑长边档');
  assert.ok(out.ladder.outputBytes < losslessBytes, '降档后必须真的变小');
});

test('一档不够会继续往下，直到有档达标', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 0 });
  const measured = await vault.runCompressLadder([pngFile()]);
  const losslessBytes = measured.ladder.outputBytes;

  // 目标压到无损的 5%：转 JPEG 不够、长边 2400 也不够，长边 1600 才行
  const target = Math.floor(losslessBytes * 0.05);
  vault.configure({ MAX_OUTPUT_BYTES: target });
  const out = await vault.runCompressLadder([pngFile()]);

  const ids = out.ladder.attempts.map((a) => a.id);
  assert.deepEqual(ids, ['lossless', 'png2jpeg', 'side2400', 'side1600']);
  assert.equal(out.ladder.chosenId, 'side1600');
  assert.equal(out.ladder.withinTarget, true);

  // 每档都必须比上一档小，否则"阶梯"名不副实
  const sizes = out.ladder.attempts.map((a) => a.bytes);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] < sizes[i - 1], '档 ' + ids[i] + ' 没有比上一档更小');
  }

  // 自校验"第一个达标即停"：选中档必须是记录里第一个 ≤ 目标的那一档
  const firstFit = out.ladder.attempts.find((a) => typeof a.bytes === 'number' && a.bytes <= target);
  assert.equal(out.ladder.chosenId, firstFit.id, '选的必须是第一个达标的档，而不是压得最狠的档');
});

test('所有档都不够时取最小者，并如实标记"超出目标"而不是假装成功', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 1 });
  const out = await vault.runCompressLadder([pngFile()]);

  assert.equal(out.ladder.chosenId, 'side1200', '应取最后一档（压得最狠的）');
  assert.equal(out.ladder.withinTarget, false, '不能假装达标');
  assert.equal(out.ladder.degraded, true);

  const note = vault.describeLadder(out.ladder);
  assert.match(note, /仍超目标/, '文案必须说清没达标');
  assert.match(note, /分片上传/, '并给出可行的下一步');
});

test('AUTO_DOWNSCALE 关闭时只跑无损档，超目标也不降画质', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 1, AUTO_DOWNSCALE: false });
  const out = await vault.runCompressLadder([pngFile()]);

  assert.equal(out.ladder.attempts.length, 1);
  assert.equal(out.ladder.chosenId, 'lossless');
  assert.equal(out.ladder.degraded, false, '关掉自动降画质就不许动人画质');
  assert.equal(out.ladder.withinTarget, false);
});

/* ==========================================================================
 * ③ 降画质必须可见
 * ======================================================================== */

test('describeLadder：无损不写"已降至"，降档必须写明降到了哪一档', () => {
  const lossless = vault.describeLadder({
    outputBytes: 1024 * 1024, targetBytes: 60 * 1024 * 1024,
    withinTarget: true, degraded: false, chosenLabel: '无损直通',
  });
  assert.match(lossless, /无损/);
  assert.doesNotMatch(lossless, /已降至/);

  const degraded = vault.describeLadder({
    outputBytes: 1024 * 1024, targetBytes: 60 * 1024 * 1024,
    withinTarget: true, degraded: true, chosenLabel: '长边 ≤ 1600px',
  });
  assert.match(degraded, /已降至/);
  assert.match(degraded, /长边 ≤ 1600px/, '必须点名具体档位，不能含糊说"已压缩"');
});

/* ==========================================================================
 * ④ 档位选择的守卫：不白跑、不越界
 * ======================================================================== */

test('批量里没有 PNG 源时跳过 PNG 档，并记录跳过原因', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 1 });
  const out = await vault.runCompressLadder([jpegFile()]);

  const pngTier = out.ladder.attempts.find((a) => a.id === 'png2jpeg');
  assert.ok(pngTier, 'PNG 档应出现在记录里');
  assert.equal(pngTier.bytes, null, '跳过的档不该产出体积');
  assert.match(String(pngTier.skipped), /没有 PNG/);
});

test('降无可降时不谎报降过画质：小图跑遍长边档体积不变，如实报"未达标"', async () => {
  // 样图长边仅 418，低于所有长边档，因此每个长边档都不会触发降采样
  vault.configure({ MAX_OUTPUT_BYTES: 1 });
  const out = await vault.runCompressLadder([jpegFile()]);

  const tried = out.ladder.attempts.filter((a) => typeof a.bytes === 'number');
  assert.ok(tried.length >= 2, '长边档应被真的跑过，而不是直接跳过');
  assert.ok(
    tried.every((a) => a.bytes === tried[0].bytes),
    '小图在各长边档下体积应当相同 —— 没有可压缩的余量'
  );
  assert.equal(out.ladder.withinTarget, false, '压不动就要承认没达标');
  assert.equal(
    out.ladder.degraded, false,
    '什么都没降就不能标记 degraded —— 谎报降画质和静默降画质一样糟'
  );
});

test('JPEG 源被强制降采样时必须走 canvas，且不得被 PNG 策略拐成无损 PNG', async () => {
  // 用一个极端长边档把 418 的样图也逼进 canvas 路径
  vault.configure({
    MAX_OUTPUT_BYTES: 1,
    COMPRESS_LADDER: [
      { id: 'lossless', label: '无损直通', patch: {} },
      { id: 'tiny', label: '长边 ≤ 100px', patch: { PNG_POLICY: 'auto', IMAGE_LONG_SIDE_MAX: 100 } },
    ],
  });
  lastPdfImages = [];
  const out = await vault.runCompressLadder([jpegFile()]);

  assert.equal(out.ladder.chosenId, 'tiny');
  const last = lastPdfImages[lastPdfImages.length - 1];
  assert.equal(
    last.format, 'JPEG',
    'JPEG 源即便走 canvas 也必须输出 JPEG —— 转成无损 PNG 只会让体积暴涨且救不回信息'
  );
  assert.ok(last.w <= 100 && last.h <= 100, '长边档必须真的生效，实测 ' + last.w + '×' + last.h);
});

test('JPEG 源在长边合格时走原字节直通，体积由真实源图决定', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 0 }); // 只跑无损档
  const out = await vault.runCompressLadder([jpegFile()]);

  assert.equal(out.ladder.chosenId, 'lossless');
  assert.equal(out.stats.passthrough, 1, '418×208 的源图长边远小于任何档，必须直通');
  assert.equal(out.stats.reencoded, 0);
  // 直通体积 = 源 JPEG 的 base64 + PDF 头部开销，量级应贴近源图
  assert.ok(
    out.ladder.outputBytes >= JPEG_SIZE && out.ladder.outputBytes < JPEG_SIZE * 2,
    '直通产出应贴近源图体积，实测 ' + out.ladder.outputBytes
  );
});

/* ==========================================================================
 * ⑤ CONFIG 还原：含抛错路径
 * ======================================================================== */

test('每档跑完都还原 CONFIG，不会把降采样设置残留给后续上传', async () => {
  const before = snapshotConfig();
  vault.configure({ MAX_OUTPUT_BYTES: 1 });
  await vault.runCompressLadder([pngFile()]);
  assertConfigRestored(before, '正常跑完');
});

test('档位内部抛错时 CONFIG 也必须还原（finally 的意义）', async () => {
  const before = snapshotConfig();

  // 用一个必然抛错的档：把安全阀压到 1 字节，normalizeToPdfBytes 会拒绝输入
  vault.configure({
    MAX_OUTPUT_BYTES: 1,
    COMPRESS_LADDER: [{ id: 'boom', label: '必炸档', patch: { MAX_INPUT_BYTES: 1 } }],
  });
  await assert.rejects(
    () => vault.runCompressLadder([pngFile()]),
    /安全阀/,
    '错误信息本身就是"patch 生效过"的证据 —— MAX_INPUT_BYTES=1 让它以安全阀名义拒绝；' +
    '同时也要原样抛出，不许吞掉'
  );
  // 抛错当下 patch 已经生效（见上面的 /安全阀/），而 tryLadderTier 的 finally 已把它还原
  assertConfigRestored(before, '抛错路径');
  // MAX_INPUT_BYTES 由 beforeEach 的 resetConfig 统一还原，这里不必手工收尾
});

/* ==========================================================================
 * ⑥ PDF 输入：图像旋钮空转问题
 * ======================================================================== */

test('PDF 直通：图像档对它无效，识别到超目标后直接跳出、不空转', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 1 });
  const out = await vault.runCompressLadder([pdfFile()]);

  assert.equal(out.mergedFromImages, false, 'PDF 是原字节直通，不是图片合并');
  // 只有一档真的产出了体积；其余记录都是"跳过"，不该出现被空跑的图像档
  const ran = out.ladder.attempts.filter((a) => typeof a.bytes === 'number');
  assert.equal(ran.length, 1, 'PDF 输入不该把图像档一个个空跑一遍，实跑了 ' + ran.length + ' 档');
  assert.equal(ran[0].id, 'lossless');
});

test('PDF 直通超目标且未注入渲染器：如实跳过并说明原因，不假装压过', async () => {
  vault.configure({ MAX_OUTPUT_BYTES: 1, AUTO_DOWNSCALE: true });
  const out = await vault.runCompressLadder([pdfFile()]);

  const skipped = out.ladder.attempts.find((a) => a.skipped);
  assert.ok(skipped, '必须有跳过记录');
  assert.match(String(skipped.skipped), /renderPdfPages/);
  assert.equal(out.ladder.rendererAvailable, false);
  assert.equal(out.ladder.withinTarget, false, '压不动就要承认没达标');
});

test('注入渲染器后 PDF 走专用档：逐页重渲染再拼回，并能真的达标', async () => {
  const calls = [];
  // 原始 PDF 声明 400KB；重渲染后只剩一张真实 JPEG 页（约 96KB），目标 200KB 可达
  vault.configure({
    MAX_OUTPUT_BYTES: 200000,
    AUTO_DOWNSCALE: true,
    renderPdfPages: async (file, opts) => {
      calls.push({ name: file.name, opts });
      return [{ ...jpegFile('vault-p001.jpg') }];
    },
  });

  const out = await vault.runCompressLadder([pdfFile()]);

  assert.equal(out.ladder.chosenId, 'pdf-side2000');
  assert.equal(out.ladder.pdfRerendered, true, '必须标记这是重渲染产出，不是原文件');
  assert.equal(out.ladder.withinTarget, true);
  assert.equal(calls.length, 1, '第一档达标就该停，不该继续跑第二档');
  assert.equal(calls[0].opts.maxSide, 2000);
  assert.equal(calls[0].opts.quality, 0.85);
  assert.ok(out.ladder.outputBytes < 400000, '重渲染产出应显著小于原始 PDF');

  vault.configure({ renderPdfPages: null });
});

test('PDF 重渲染期间把长边旋钮归零，避免"渲染一次、再缩一次"', async () => {
  let seenMaxSide = 'unset';
  vault.configure({
    MAX_OUTPUT_BYTES: 1,
    renderPdfPages: async () => {
      // 渲染器在调用瞬间观察 CONFIG：此时必须已是 0
      seenMaxSide = vault.CONFIG.IMAGE_LONG_SIDE_MAX;
      return [{ ...jpegFile('vault-p001.jpg') }];
    },
  });
  const before = vault.CONFIG.IMAGE_LONG_SIDE_MAX;

  await vault.runCompressLadder([pdfFile()]);
  assert.equal(seenMaxSide, 0, '渲染器被调用时 IMAGE_LONG_SIDE_MAX 必须为 0');
  assert.equal(vault.CONFIG.IMAGE_LONG_SIDE_MAX, before, '调用结束后必须还原');

  vault.configure({ renderPdfPages: null });
});

test('渲染器返回空数组时明确报错，而不是悄悄产出一份空 PDF', async () => {
  vault.configure({
    MAX_OUTPUT_BYTES: 1,
    renderPdfPages: async () => [],
  });
  await assert.rejects(
    () => vault.runCompressLadder([pdfFile()]),
    /没有产出任何页面/
  );
  vault.configure({ renderPdfPages: null });
});
