/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCosObjectStore } = require('../src/infrastructure/cos');

describe('COS object-store adapter', () => {
  it('uses methods exposed by the installed COS SDK contract', () => {
    const COS = require('cos-nodejs-sdk-v5');
    const client = new COS({ SecretId: 'test-id', SecretKey: 'test-key' });
    for (const method of ['getObjectUrl', 'headObject', 'getObject', 'putObjectCopy', 'putObject', 'deleteObject', 'getBucketVersioning']) expect(client[method]).toBeTypeOf('function');
  });
  it('signs only a five-minute PUT for the exact staging object and declared headers', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1' }));
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl } });
    const result = await store.signPut({ objectKey: 'staging/admin/u/f.webp', contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123', Region: 'ap-test', Key: 'staging/admin/u/f.webp', Method: 'PUT', Sign: true, Expires: 300, Headers: { 'Content-Type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } }), expect.any(Function));
    expect(result).toEqual({ url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } });
  });

  it('normalizes HEAD metadata and promotes a temporary JSON object with server-side copy', async () => {
    const cos = {
      headObject: vi.fn((_params, callback) => callback(null, { headers: { 'content-length': '5', 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64), etag: '"etag"' } })),
      putObject: vi.fn((_params, callback) => callback(null, {})),
      putObjectCopy: vi.fn((_params, callback) => callback(null, {})),
    };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    expect(await store.head({ objectKey: 'staging/admin/u/f.webp' })).toEqual({ sizeBytes: 5, contentType: 'image/webp', checksum: 'a'.repeat(64), etag: 'etag' });
    await store.putBytes('snapshots/public/catalog.v1.json', Buffer.from('{}'), { sourceKey: 'snapshots/public/.tmp/catalog.v1.nonce.json', cacheControl: 'public,max-age=31536000,immutable' });
    expect(cos.putObjectCopy).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'public-123', Key: 'snapshots/public/catalog.v1.json', CopySource: 'public-123.cos.ap-test.myqcloud.com/snapshots/public/.tmp/catalog.v1.nonce.json', MetadataDirective: 'Replaced', ContentType: 'application/json; charset=utf-8' }), expect.any(Function));
  });

  it('promotes staging across explicit storage zones and never reads staging from public', async () => {
    const cos = { putObjectCopy: vi.fn((_params, cb) => cb(null, {})), getObject: vi.fn((_params, cb) => cb(null, { Body: Buffer.from('abc') })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await store.promote({ sourceKey: 'staging/admin/u/f.webp', destinationKey: 'media/works/w/f.webp', storageZone: 'public', contentType: 'image/webp' });
    expect(cos.putObjectCopy).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'public-123', CopySource: 'private-123.cos.ap-test.myqcloud.com/staging/admin/u/f.webp', Key: 'media/works/w/f.webp' }), expect.any(Function));
    await store.read({ objectKey: 'staging/admin/u/f.webp' });
    expect(cos.getObject).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123' }), expect.any(Function));
  });

  it('uses the COS forbid-overwrite header and rejects versioned public buckets', async () => {
    const cos = { getBucketVersioning: vi.fn((_params, cb) => cb(null, {})), putObject: vi.fn((_params, cb) => cb(null, {})) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await store.putImmutable('snapshots/public/catalog.v1.json', Buffer.from('{"schemaVersion":1,"version":1,"works":[]}'), { version: 1, schemaVersion: 1, cacheControl: 'immutable' });
    expect(cos.getBucketVersioning).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'public-123' }), expect.any(Function));
    expect(cos.putObject).toHaveBeenCalledWith(expect.objectContaining({ Headers: { 'x-cos-forbid-overwrite': 'true' } }), expect.any(Function));
    const versioned = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getBucketVersioning: vi.fn((_p, cb) => cb(null, { Status: 'Enabled' })) } });
    await expect(versioned.putImmutable('snapshots/public/catalog.v1.json', Buffer.from('{}'), { version: 1, schemaVersion: 1 })).rejects.toMatchObject({ status: 409, errorCode: 'SNAPSHOT_CONFLICT' });
  });

  it('accepts an existing immutable object only after reading and validating its bytes', async () => {
    const bytes = Buffer.from('{"schemaVersion":1,"version":2,"works":[]}');
    async function* stream() { yield bytes.subarray(0, 9); yield bytes.subarray(9); }
    const cos = { getBucketVersioning: vi.fn((_p, cb) => cb(null, {})), putObject: vi.fn((_p, cb) => cb({ code: 'FileAlreadyExists', statusCode: 409 })), getObject: vi.fn((_p, cb) => cb(null, { Body: stream() })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await expect(store.putImmutable('snapshots/public/catalog.v2.json', Buffer.from('changed'), { version: 2, schemaVersion: 1 })).resolves.toMatchObject({ bytes, existed: true });
  });
});
