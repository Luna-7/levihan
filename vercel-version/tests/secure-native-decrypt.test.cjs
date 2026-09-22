'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'secureComicDecrypt.js')).href;

test('原生解密兼容现有 AES-CBC 密文，包括大文件和错误密码', async () => {
  const { decryptOuterLayer } = await import(moduleUrl);
  const password = 'levihan';
  const plain = new Uint8Array(1024 * 1024 + 23);
  webcrypto.getRandomValues(plain.subarray(0, 65536));
  for (let i = 65536; i < plain.length; i += 1) plain[i] = plain[i % 65536];
  plain.set(new TextEncoder().encode('%PDF-'), 0);

  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const key = await webcrypto.subtle.importKey('raw', digest, 'AES-CBC', false, ['encrypt']);
  const cipher = await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv: new TextEncoder().encode('levihan-vault-iv') }, key, plain);
  const base64 = Buffer.from(cipher).toString('base64');

  assert.deepEqual(await decryptOuterLayer(base64, password), plain);
  await assert.rejects(decryptOuterLayer(base64, 'wrong'));
});
