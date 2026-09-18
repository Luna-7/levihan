/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCosObjectStore } = require('../src/infrastructure/cos');

describe('COS object-store adapter', () => {
  it('signs only a five-minute PUT for the exact staging object and declared headers', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1' }));
    const store = createCosObjectStore({ bucket: 'bucket-123', region: 'ap-test', cos: { getObjectUrl } });
    const result = await store.signPut({ objectKey: 'staging/admin/u/f.webp', contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'bucket-123', Region: 'ap-test', Key: 'staging/admin/u/f.webp', Method: 'PUT', Sign: true, Expires: 300, Headers: { 'Content-Type': 'image/webp', 'Content-Length': 123, 'x-cos-meta-sha256': 'a'.repeat(64) } }), expect.any(Function));
    expect(result).toEqual({ url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1', headers: { 'content-type': 'image/webp', 'content-length': '123', 'x-cos-meta-sha256': 'a'.repeat(64) } });
  });

  it('normalizes HEAD metadata and promotes a temporary JSON object with server-side copy', async () => {
    const cos = {
      headObject: vi.fn((_params, callback) => callback(null, { headers: { 'content-length': '5', 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64), etag: '"etag"' } })),
      putObject: vi.fn((_params, callback) => callback(null, {})),
      putObjectCopy: vi.fn((_params, callback) => callback(null, {})),
    };
    const store = createCosObjectStore({ bucket: 'bucket-123', region: 'ap-test', cos });
    expect(await store.head({ objectKey: 'staging/admin/u/f.webp' })).toEqual({ sizeBytes: 5, contentType: 'image/webp', checksum: 'a'.repeat(64), etag: 'etag' });
    await store.putJson('snapshots/public/catalog.v1.json', { ok: true }, { sourceKey: 'snapshots/public/.tmp/catalog.v1.nonce.json', cacheControl: 'public,max-age=31536000,immutable' });
    expect(cos.putObjectCopy).toHaveBeenCalledWith(expect.objectContaining({ Key: 'snapshots/public/catalog.v1.json', CopySource: 'bucket-123.cos.ap-test.myqcloud.com/snapshots/public/.tmp/catalog.v1.nonce.json', MetadataDirective: 'Replaced', ContentType: 'application/json; charset=utf-8' }), expect.any(Function));
  });
});
