/**
 * ============================================================================
 * secure-vault.test.cjs — 「深度加密直传」流水线的密码学验收测试
 * ----------------------------------------------------------------------------
 * 目的：证明 public/admin/secure-upload.js 里的加密逻辑就是**标准 AES-256-CBC +
 *       PKCS#7**，而不是只在自家两个函数之间"自洽"的自定义算法。
 *       做法是用 node:crypto 独立实现同一条配方，再逐字节比对密文。
 *
 * 运行：node --test tests/secure-vault.test.cjs
 * 说明：模块本身用 WebCrypto 实现，Node 18+ 的 globalThis.crypto 就是 WebCrypto，
 *       所以这里加载的是**浏览器里跑的同一份代码**，不是复制品。
 *
 * 为什么不用 require()：
 *   vercel-version/package.json 里是 "type": "module"，于是本目录下的 .js 会被 Node
 *   当成 ESM，require 进来的 UMD 导出是空的。这里改用 vm.runInThisContext 在当前上下文
 *   求值同一份源码 —— 模块的 UMD 外壳会顺手把接口挂到 globalThis.LeVihanVault，
 *   与浏览器里的加载方式（<script src>）完全一致。
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'), { filename: MODULE_PATH });

const vault = globalThis.LeVihanVault;
assert.ok(vault && typeof vault.handleComicUpload === 'function', 'secure-upload.js 未能导出 LeVihanVault');

const PASSPHRASE = 'levihan';
const IV_UTF8 = 'levihan-vault-iv';

/** 独立的参考实现：sha256 派生密钥 → aes-256-cbc（PKCS#7） */
function referenceEncrypt(plainBuffer) {
  const key = nodeCrypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest();
  const iv = Buffer.from(IV_UTF8, 'utf8');
  const cipher = nodeCrypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
}

/** 造一段带真实 PDF 文件头的假数据，用于验证"文件头被打碎" */
function fakePdf(sizeBytes) {
  const head = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const body = Buffer.alloc(Math.max(0, sizeBytes - head.length), 0x41);
  return Buffer.concat([head, body]);
}

test('IV 常量必须是 16 字节，否则 AES 分组会直接抛错', () => {
  assert.equal(Buffer.from(IV_UTF8, 'utf8').length, 16);
  assert.equal(Buffer.byteLength(IV_UTF8, 'utf8'), 16);
});

test('密钥派生：SHA-256("levihan") 与 node:crypto 一致，且为 32 字节', async () => {
  const derived = await vault.deriveKeyBytes();
  const expected = nodeCrypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest();
  assert.equal(derived.length, 32, 'AES-256 需要 32 字节密钥');
  assert.deepEqual(Buffer.from(derived), expected);
});

test('已知答案测试：WebCrypto 密文与 node:crypto 的 aes-256-cbc 逐字节相同', async () => {
  // 19 字节：故意不是 16 的整数倍，用来证明 PKCS#7 填充行为一致
  const plain = Buffer.from('levihan vault test!', 'utf8');
  assert.equal(plain.length, 19);

  const mine = Buffer.from(await vault.aesEncrypt(new Uint8Array(plain)));
  const ref = referenceEncrypt(plain);

  assert.deepEqual(mine, ref, '密文不一致 → 说明不是标准 AES-256-CBC/PKCS#7');
  assert.equal(mine.length, 32, '19 字节 + 13 字节填充 = 32 字节');
});

test('较大数据（1MB 假 PDF）同样与参考实现完全一致', async () => {
  const plain = fakePdf(1024 * 1024);
  const mine = Buffer.from(await vault.aesEncrypt(new Uint8Array(plain)));
  assert.deepEqual(mine, referenceEncrypt(plain));
});

test('解密往返：还原出的字节与原始 PDF 完全相同', async () => {
  const plain = fakePdf(4096);
  const cipher = await vault.aesEncrypt(new Uint8Array(plain));
  const back = Buffer.from(await vault.aesDecrypt(cipher));
  assert.deepEqual(back, plain);
});

test('完整加密段：输出是纯 Base64，且 %PDF 文件头已被打碎', async () => {
  const plain = fakePdf(2048);
  const base64 = await vault.encryptPdfBytesToBase64(new Uint8Array(plain));

  assert.match(base64, /^[A-Za-z0-9+/]+={0,2}$/, '必须是纯 Base64，不含换行或其它字符');
  assert.equal(Buffer.from(base64, 'base64').length, 2048 + 16 - (2048 % 16));
  assert.ok(!base64.startsWith('JVBERi'), '开头不得残留 "%PDF" 的 Base64 形态');
  assert.ok(!base64.includes('%PDF'), '密文里不得出现明文文件头');
  assert.ok(vault.base64ToBytes(base64).length > 0);
});

test('Blob 重包装：类型为 text/plain，内容与密文一一对应', async () => {
  const plain = fakePdf(512);
  const payload = await vault.encryptPdfToCipherPayload(new Uint8Array(plain));

  assert.equal(payload.blob.type, 'text/plain; charset=utf-8');
  assert.equal(payload.blob.size, payload.base64.length);
  assert.equal(await payload.blob.text(), payload.base64);
});

test('解密入口能从 text/plain Blob 读回原始 PDF（阅读端通路）', async () => {
  const plain = fakePdf(3000);
  const base64 = await vault.encryptPdfBytesToBase64(new Uint8Array(plain));
  const blob = new Blob([base64], { type: 'text/plain; charset=utf-8' });

  const back = Buffer.from(await vault.decryptVaultToPdfBytes(blob));
  assert.deepEqual(back, plain);
  assert.ok(vault.isPdfBytes(back), '还原结果必须能通过 PDF 魔数校验');
});

test('解密入口拒绝被篡改 / 不是 PDF 的密文', async () => {
  // 用正确密码加密一段"不是 PDF"的明文 → 解密能成功但过不了 PDF 魔数校验
  const notPdf = Buffer.from('hello levihan', 'utf8');
  const base64 = vault.bytesToBase64(await vault.aesEncrypt(new Uint8Array(notPdf)));
  await assert.rejects(() => vault.decryptVaultToPdfBytes(base64), /解密后不是有效的 PDF/);
});

test('Key 伪装：抹掉 .pdf / .jpg 后缀，统一强改为 .txt', () => {
  const timestamped = vault.buildVaultKey('lh-123.pdf', { versioned: true });
  assert.match(timestamped, /^comic_vault\/\d+_secure\.txt$/, '不得残留任何原后缀');
  assert.ok(!/\.pdf|\.jpg|\.jpeg|\.png|\.webp/i.test(timestamped));

  const stable = vault.buildVaultKey('lh-123.jpg', { versioned: false });
  assert.equal(stable, 'comic_vault/lh-123_secure.txt', '固定命名便于阅读端仅凭 bookId 反推');

  const sanitized = vault.buildVaultKey('lh-9/../evil.pdf', { versioned: false });
  assert.equal(sanitized, 'comic_vault/lh-9evil_secure.txt', '斜杠与点号必须被清理，防止路径穿越');
});

test('公开访问 URL 由 Key 拼出，走 COS 静态网站域名', () => {
  const url = vault.keyToPublicUrl('comic_vault/lh-123_secure.txt');
  assert.equal(url, vault.CONFIG.COS.CdnBase + '/comic_vault/lh-123_secure.txt');
});

test('Base64 编解码在 1MB 量级不爆栈（分块实现的回归保护）', async () => {
  const bytes = new Uint8Array(fakePdf(1024 * 1024));
  const base64 = vault.bytesToBase64(bytes);
  const back = vault.base64ToBytes(base64);
  assert.equal(back.length, bytes.length);
  assert.equal(back[0], 0x25); // '%'
  assert.deepEqual(Buffer.from(back), Buffer.from(bytes));
});
