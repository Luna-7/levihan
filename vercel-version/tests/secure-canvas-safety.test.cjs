/**
 * ============================================================================
 * secure-canvas-safety.test.cjs — 画布安全网的两条防线
 * ----------------------------------------------------------------------------
 * 钉住两类**静默**行为。它们的共同点是：坏了不会报错、不会变红、不会让任何
 * 现有测试失败，只能靠这里的断言发现。
 *
 *   ① iOS 静默白页防线
 *      iOS Safari 的 canvas 有面积上限（约 16.7MP）。超出后 drawImage / fillRect
 *      既不抛错也不告警，画布保持全透明 —— 这一页被编码成空白图，流水线照常
 *      报「上传成功」，读者打开是白纸。所以必须「先画 → 再验 → 验砸了才降采样」。
 *      反过来，桌面画布正常时必须**原样通过、绝不降质**，这条同样重要：
 *      一刀切按 16.7MP 砍会让桌面本可无损通过的大图白白掉分辨率。
 *
 *   ② 无谓的全图 alpha 扫描
 *      canvasHasAlpha() 做一次全图 getImageData（48MP 的图是 183MB）。
 *      但 policy='keep' + PNG 源、以及 policy='jpeg' 这两种情况结论是写死的，
 *      扫完就扔 —— 逐页循环上百次就是几十秒的纯浪费，在手机上还会直接撑爆标签页。
 *      结论真的影响决策时（auto + PNG、webp/gif 源）扫描必须保留。
 *
 * 运行：
 *   node --test tests/secure-canvas-safety.test.cjs
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
const SAFE_AREA = 16 * 1024 * 1024;   // 与 CONFIG.MAX_PAGE_AREA_PX 保持一致

/* ---------------- 可控 canvas 桩 ---------------- */

// canvas.width >= 该值时模拟"画布静默失效"：像素读回一律全 0（全透明）。
// 默认 Infinity = 画布永远正常（桌面行为）。
let deadAtWidth = Infinity;
let gidCalls = [];      // 每次 getImageData 的记录，用于断言"扫了什么"
let lastEncode = null;
let srcW = 800;
let srcH = 1200;

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
          const dead = canvas.width >= deadAtWidth;
          gidCalls.push({ w, h, canvasW: canvas.width, dead });
          const data = new Uint8ClampedArray(Math.max(4, w * h * 4));
          if (!dead) data.fill(255);
          return { data };
        },
      };
    },
    toDataURL(type) {
      lastEncode = { mime: type, w: canvas.width, h: canvas.height };
      return 'data:' + type + ';base64,AAAA';
    },
  };
  return canvas;
}

globalThis.document = {
  createElement: () => makeCanvas(),
  body: {},
  documentElement: {},
};
globalThis.createImageBitmap = async () => ({ width: srcW, height: srcH, close() {} });

vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });
const vault = globalThis.LeVihanVault;
assert.ok(vault, 'secure-upload.js 未能导出 LeVihanVault');

/* ---------------- 辅助 ---------------- */

const pngFile = () => ({ name: 'page01.png', type: 'image/png', size: 4096 });
const webpFile = () => ({ name: 'page01.webp', type: 'image/webp', size: 4096 });

async function place(w, h, opts) {
  opts = opts || {};
  srcW = w;
  srcH = h;
  gidCalls = [];
  lastEncode = null;
  if (opts.policy) vault.CONFIG.PNG_POLICY = opts.policy;
  const placed = await vault.buildPageImage(opts.file || pngFile(), 0);
  return {
    placed,
    enc: lastEncode,
    fullScan: gidCalls.filter(g => g.h > 1),      // 全图扫描（昂贵的那种）
    probe: gidCalls.filter(g => g.h === 1),       // 单行探测（便宜的那种）
  };
}

/* ==========================================================================
 * ① alpha 扫描：只在结论真的影响决策时才付代价
 * ========================================================================== */

test('keep + PNG 源：结论写死为保留，不做全图 alpha 扫描', async () => {
  vault.CONFIG.PNG_POLICY = 'keep';
  const r = await place(800, 1200, { policy: 'keep' });

  assert.equal(r.fullScan.length, 0, 'keep 策略下扫描结果根本不会被用到，不该扫');
  assert.equal(r.enc.mime, 'image/png', '仍必须保留 PNG 无损');
  assert.equal(r.placed.width, 800);
});

test('jpeg 策略：一律转 JPEG，同样不该做全图 alpha 扫描', async () => {
  const r = await place(800, 1200, { policy: 'jpeg' });

  assert.equal(r.fullScan.length, 0);
  assert.equal(r.enc.mime, 'image/jpeg');
});

test('auto + PNG 源：结论决定要不要转 JPEG，扫描必须保留', async () => {
  const r = await place(800, 1200, { policy: 'auto' });

  assert.equal(r.fullScan.length, 1, 'auto 策略下必须照旧扫描，行为不能变');
  // 桩的画布是不透明的 → hasAlpha=false → auto 策略下不透明 PNG 转 JPEG
  assert.equal(r.enc.mime, 'image/jpeg');
});

test('webp 源（PDF 装不下）：靠扫描决定 PNG 兜底还是转 JPEG，必须保留', async () => {
  vault.CONFIG.PNG_POLICY = 'keep';
  const r = await place(800, 1200, { file: webpFile() });

  assert.equal(r.fullScan.length, 1, '非 PNG 源的分支依赖 hasAlpha，不能省');
});

/* ==========================================================================
 * ② 画布静默失效：桌面绝不降质，失效必须降采样
 * ========================================================================== */

test('大图 + 画布正常（桌面）：探测通过，原尺寸输出，绝不降质', async () => {
  deadAtWidth = Infinity;
  vault.CONFIG.PNG_POLICY = 'keep';
  const r = await place(8000, 6000);

  assert.equal(r.enc.w, 8000, '桌面画布没失效就不该动分辨率');
  assert.equal(r.enc.h, 6000);
  assert.equal(r.placed.downscaled, false, 'downscaled 必须为 false，否则桌面会被悄悄降质');
  // 探测本身必须发生（否则失效就没人发现了），且是单行而非全图
  assert.ok(r.probe.length > 0, '超面积时必须做过探测');
  assert.equal(r.fullScan.length, 0, '探测必须是单行，不能是全图');
});

test('大图 + 画布静默失效（模拟 iOS）：降采样到安全面积内并重画', async () => {
  deadAtWidth = 4096;   // 宽度 ≥4096 的画布读回全 0 —— 正是 iOS 的表现
  vault.CONFIG.PNG_POLICY = 'keep';
  const r = await place(8000, 6000);

  const area = r.enc.w * r.enc.h;
  assert.ok(r.enc.w < 8000, '必须真的缩小了');
  assert.ok(area <= SAFE_AREA * 1.01, '降级后必须落在安全面积内，实际 ' + r.enc.w + 'x' + r.enc.h);
  assert.equal(r.placed.downscaled, true, 'downscaled 必须为 true，供上层如实上报画质被动过');
  assert.ok(r.probe.length > 0, '必须探测到失效才会降级');
});

test('小图：完全不探测，画布失效阈值也影响不到它', async () => {
  deadAtWidth = 1;   // 极端：连最小的画布都"失效"
  vault.CONFIG.PNG_POLICY = 'keep';
  const r = await place(800, 1200);

  assert.equal(r.enc.w, 800, '未超安全面积 → 不探测 → 不受影响');
  assert.equal(r.enc.h, 1200);
  assert.equal(r.placed.downscaled, false);
  assert.equal(r.probe.length, 0, '小图零开销');
});
