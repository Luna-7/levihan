'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('封面 COS 凭证请求失败时显示接口错误', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/admin/index.html'), 'utf8');
  const start = source.indexOf('function getCosCredential(prefix)');
  const end = source.indexOf('function loadBooks()', start);
  assert.ok(start >= 0 && end > start, '未找到管理页 COS 上传函数');

  class FakeCOS {
    constructor(options) { this.options = options; }
    putObject(params, callback) {
      this.options.getAuthorization({}, (credentials) => {
        callback(credentials && credentials.TmpSecretId
          ? null
          : new Error('getAuthorization callback params missing "TmpSecretId"'));
      });
    }
  }
  const context = {
    api: () => Promise.reject(new Error('STS 签发失败')),
    cosClients: Object.create(null),
    cosCredentials: Object.create(null),
    cosCredentialErrors: Object.create(null),
    COS_BUCKET: 'levihan-1325571558',
    COS_REGION: 'ap-nanjing',
    window: { COS: FakeCOS },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  await assert.rejects(
    context.uploadToCos('lh-123/', 'lh-123/cover.jpg', new Blob(['cover']), 'image/jpeg'),
    /STS 签发失败/
  );
});

test('封面凭证正常时仍可直传 COS', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/admin/index.html'), 'utf8');
  const start = source.indexOf('function getCosCredential(prefix)');
  const end = source.indexOf('function loadBooks()', start);
  class FakeCOS {
    constructor(options) { this.options = options; }
    putObject(params, callback) {
      this.options.getAuthorization({}, (credentials) => {
        callback(credentials && credentials.TmpSecretId === 'tmp-id'
          ? null
          : new Error('COS 临时凭证缺失'), { ETag: 'etag' });
      });
    }
  }
  const context = {
    api: () => Promise.resolve({ credentials: {
      tmpSecretId: 'tmp-id', tmpSecretKey: 'tmp-key', sessionToken: 'token',
      expiredTime: Math.floor(Date.now() / 1000) + 1800,
    } }),
    cosClients: Object.create(null),
    cosCredentials: Object.create(null),
    cosCredentialErrors: Object.create(null),
    COS_BUCKET: 'levihan-1325571558',
    COS_REGION: 'ap-nanjing',
    window: { COS: FakeCOS },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  const result = await context.uploadToCos('lh-123/', 'lh-123/cover.jpg', new Blob(['cover']), 'image/jpeg');
  assert.equal(result.ETag, 'etag');
});
