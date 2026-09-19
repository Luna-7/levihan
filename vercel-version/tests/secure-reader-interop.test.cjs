/**
 * ============================================================================
 * secure-reader-interop.test.cjs — 「一密双解」的跨实现验证
 * ----------------------------------------------------------------------------
 * 阅读端要在浏览器里做两件互相独立、但共用同一个密码的事：
 *   外层：crypto-js 解 AES-256-CBC（密文 = COMIC 管理台上传时由 WebCrypto 生成）
 *   内层：PDF.js 用同一个密码解 jsPDF 施加的 PDF 标准口令
 *
 * 这里把这两步在 Node 里跑通，用的是**浏览器端的真实实现**（同一个 UMD / legacy 构建），
 * 只把入口换掉。验的是"两套加密库能不能对上"，而不是"我自己跟自己一致"。
 *
 * 运行：
 *   npm install                 # 装好 crypto-js / pdfjs-dist 后直接可跑
 *   node --test tests/secure-reader-interop.test.cjs
 *
 * 依赖产物缺失时（例如还没 npm install）可用环境变量指向从 CDN 取来的构建：
 *   LH_CRYPTOJS=<crypto-js.min.js> \
 *   LH_PDFJS_LEGACY=<pdfjs-dist legacy/build/pdf.js> \
 *   LH_PDFJS_WORKER=<同版本 pdf.worker.js> \
 *   LH_JSPDF_UMD=<jspdf.umd.min.js> \
 *   node --test tests/secure-reader-interop.test.cjs
 * 全都找不到时整个文件显式 skip。
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
const PROJECT = path.join(__dirname, '..');

/**
 * 依赖产物定位：npm install 之后走 node_modules，否则允许用环境变量指向 CDN 下载的构建。
 * 两边都找不到就显式 skip —— 不能让"没跑"看起来像"跑过了"。
 */
function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return '';
}

const JSPDF_UMD = firstExisting([
  process.env.LH_JSPDF_UMD,
  path.join(PROJECT, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
  '/tmp/jspdf.umd.min.js',
]);
const CRYPTOJS = firstExisting([
  process.env.LH_CRYPTOJS,
  path.join(PROJECT, 'node_modules', 'crypto-js', 'crypto-js.js'),
  '/tmp/crypto-js.min.js',
]);
const PDFJS_LEGACY = firstExisting([
  process.env.LH_PDFJS_LEGACY,
  path.join(PROJECT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'),
  '/tmp/pdfjs-legacy.js',
]);

/** 与阅读端约定一致的两个常量：外壳密码与 IV 都写死在交付的 JS 里 */
const PASSWORD = 'levihan';
const IV_UTF8 = 'levihan-vault-iv';

const hasCryptoJs = fs.existsSync(CRYPTOJS);
const hasPdfJs = fs.existsSync(PDFJS_LEGACY);

if (!hasCryptoJs && !hasPdfJs) {
  test('一密双解跨实现验证', { skip: '需要 LH_CRYPTOJS 与 LH_PDFJS_LEGACY' }, () => {});
} else {
  /* ---------------- 加载被测代码 ---------------- */

  // 管理台上传时用的同一份加密逻辑（WebCrypto）
  vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });
  const vault = globalThis.LeVihanVault;

  // crypto-js 4.x UMD 会在没有 CJS 环境时挂到全局
  if (hasCryptoJs) {
    vm.runInThisContext(fs.readFileSync(CRYPTOJS, 'utf8'), { filename: CRYPTOJS });
  }
  const CryptoJS = globalThis.CryptoJS;

  /** WordArray → Uint8Array */
  function wordArrayToBytes(wordArray) {
    const { words, sigBytes } = wordArray;
    const out = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i += 1) {
      out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return out;
  }

  /**
   * 【阅读端外层解密的真实实现】—— 与 SecureComicReader.tsx 里逐行对应。
   * 密文 → PDF 字节流。
   *
   * 关键点：外层解出来**直接就是 PDF 的二进制字节**。
   * 管理台那边是 encrypt(pdfBytes) → base64(cipher)，所以这里只需把 base64 还原成密文字节再解密；
   * 千万不要在解密后再做一次 Base64 解码，也不要用 Utf8 去读它（PDF 里有非 UTF-8 字节，
   * 会直接抛 Malformed UTF-8 data）。
   */
  function decryptOuterLayerWithCryptoJs(cipherTextBase64, password) {
    const key = CryptoJS.SHA256(password); // 32 字节 → AES-256
    const iv = CryptoJS.enc.Utf8.parse(IV_UTF8);
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(cipherTextBase64) }),
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    assert.ok(decrypted.sigBytes > 0, 'AES 解出的明文为空 —— 密码或 IV 不匹配');
    return wordArrayToBytes(decrypted);
  }

  if (hasCryptoJs) {
    test('外层：crypto-js 能解开 WebCrypto 生成的密文，且字节与原 PDF 完全一致', async () => {
      const originalPdf = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n' + 'L'.repeat(5000), 'binary');

      // ① 管理台侧：WebCrypto 加密 → 就是 COS 上那个 .txt 的全部内容
      const cipherText = await vault.encryptPdfBytesToBase64(new Uint8Array(originalPdf));
      assert.match(cipherText, /^[A-Za-z0-9+/]+={0,2}$/);

      // ② 阅读端侧：crypto-js 解密
      const restored = decryptOuterLayerWithCryptoJs(cipherText, PASSWORD);

      assert.deepEqual(Buffer.from(restored), originalPdf, '跨实现解密结果必须逐字节一致');
      assert.ok(vault.isPdfBytes(restored), '解出来必须是合法 PDF');
    });

    test('外层：密码错误时解不出合法 PDF（不能静默返回垃圾）', async () => {
      const originalPdf = Buffer.from('%PDF-1.7\n' + 'X'.repeat(2048), 'binary');
      const cipherText = await vault.encryptPdfBytesToBase64(new Uint8Array(originalPdf));

      let bad = null;
      try {
        bad = decryptOuterLayerWithCryptoJs(cipherText, 'wrong-password');
      } catch {
        bad = null; // 抛异常也是可接受的失败方式
      }
      assert.ok(!bad || !vault.isPdfBytes(bad), '错误密码绝不能解出合法 PDF');
    });

    test('外层：100KB 量级同样成立（覆盖大文件的分块 Base64 通路）', async () => {
      const big = Buffer.from('%PDF-1.7\n' + 'B'.repeat(100 * 1024), 'binary');
      const cipherText = await vault.encryptPdfBytesToBase64(new Uint8Array(big));
      const restored = decryptOuterLayerWithCryptoJs(cipherText, PASSWORD);
      assert.deepEqual(Buffer.from(restored), big);
    });
  }

  if (hasPdfJs) {
    // PDF.js legacy 构建（CJS）—— 浏览器里用 build/pdf.js + worker，Node 里用这份。
    // Node 下必须显式给 workerSrc：legacy 构建的 fake worker 默认去找同目录的 ./pdf.worker.js，
    // 裸 require 一个 /tmp 下的文件时那个相对路径是找不到的。
    const pdfjsLib = require(PDFJS_LEGACY);
    const workerPath = process.env.LH_PDFJS_WORKER || path.join(path.dirname(PDFJS_LEGACY), 'pdf.worker.js');
    if (fs.existsSync(workerPath)) pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

    /** 造一份带标准口令的 PDF：正是工具箱「转加密 PDF」的产物形态 */
    async function makePasswordProtectedPdf(userPassword) {
      vm.runInThisContext(fs.readFileSync(JSPDF_UMD, 'utf8'), { filename: JSPDF_UMD });
      const JsPDF = globalThis.jspdf.jsPDF;
      const doc = new JsPDF({
        unit: 'pt',
        format: [595, 842],
        orientation: 'portrait',
        encryption: { userPassword, ownerPassword: userPassword },
      });
      doc.text('levihan secure test', 40, 60);
      doc.addPage([595, 842], 'portrait');
      return new Uint8Array(doc.output('arraybuffer'));
    }

    test('内层：带口令的 PDF 必须提供密码才能打开', async () => {
      const protectedPdf = await makePasswordProtectedPdf(PASSWORD);

      await assert.rejects(
        () => pdfjsLib.getDocument({ data: protectedPdf.slice() }).promise,
        (err) => {
          assert.equal(err.name, 'PasswordException', '未给密码时必须抛 PasswordException，实际：' + err.name);
          return true;
        }
      );
    });

    test('内层：把同一个密码透传给 pdfjs.getDocument 即可解锁（一密双解的内层）', async () => {
      const protectedPdf = await makePasswordProtectedPdf(PASSWORD);
      const doc = await pdfjsLib.getDocument({ data: protectedPdf.slice(), password: PASSWORD }).promise;
      assert.equal(doc.numPages, 2, '解锁后应能正确读到页数');
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      assert.ok(viewport.width > 0 && viewport.height > 0, '页面视口可计算，说明文档结构完好');
    });

    test('内层：密码错误时 pdfjs 明确报错，不会给出错误内容', async () => {
      const protectedPdf = await makePasswordProtectedPdf(PASSWORD);
      await assert.rejects(
        () => pdfjsLib.getDocument({ data: protectedPdf.slice(), password: 'nope' }).promise,
        (err) => {
          assert.equal(err.name, 'PasswordException');
          return true;
        }
      );
    });

    test('完整链路：WebCrypto 加密 → crypto-js 解外层 → pdfjs 解内层 → 页数正确', async (t) => {
      if (!hasCryptoJs) {
        t.skip('缺 crypto-js');
        return;
      }
      // ① 工具箱先做 PDF 口令加密，产出双层结构的内层
      const protectedPdf = await makePasswordProtectedPdf(PASSWORD);
      // ② 管理台上传时再套一层 AES，落成 COS 上的 .txt
      const cipherText = await vault.encryptPdfBytesToBase64(protectedPdf);
      assert.ok(!cipherText.startsWith('JVBERi'), '密文不得残留 PDF 文件头');

      // ③ 阅读端：crypto-js 解外层
      const outerDecrypted = decryptOuterLayerWithCryptoJs(cipherText, PASSWORD);
      assert.ok(vault.isPdfBytes(outerDecrypted), '外层解出来必须是 PDF');

      // ④ 阅读端：pdfjs 用同一个密码解内层
      const doc = await pdfjsLib.getDocument({ data: outerDecrypted.slice(), password: PASSWORD }).promise;
      assert.equal(doc.numPages, 2, '双层解开后页数必须正确');
    });
  }
}
