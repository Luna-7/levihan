/* eslint-env node */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCosObjectStore } = require('../src/infrastructure/cos');

describe('COS object-store adapter', () => {
  it('uses methods exposed by the installed COS SDK contract', () => {
    const COS = require('cos-nodejs-sdk-v5');
    const client = new COS({ SecretId: 'test-id', SecretKey: 'test-key' });
    for (const method of ['getObjectUrl', 'headObject', 'getObject', 'putObjectCopy', 'putObject', 'deleteObject', 'getBucketVersioning']) expect(client[method]).toBeTypeOf('function');
    const types = readFileSync(require.resolve('cos-nodejs-sdk-v5/index.d.ts'), 'utf8');
    expect(types).toMatch(/interface GetBucketVersioningResult[\s\S]*?VersioningConfiguration:\s*VersioningConfiguration/);
  });
  it('signs only a five-minute PUT for the exact staging object and declared headers', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1' }));
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl } });
    const result = await store.signPut({ objectKey: 'staging/admin/u/f.webp', contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123', Region: 'ap-test', Key: 'staging/admin/u/f.webp', Method: 'PUT', Sign: true, Expires: 300, Headers: { 'Content-Type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } }), expect.any(Function));
    expect(result).toEqual({ url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } });
  });

  it('normalizes staging HEAD metadata', async () => {
    const cos = {
      headObject: vi.fn((_params, callback) => callback(null, { headers: { 'content-length': '5', 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64), etag: '"etag"' } })),
    };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    expect(await store.head({ objectKey: 'staging/admin/u/f.webp' })).toEqual({ sizeBytes: 5, contentType: 'image/webp', checksum: 'a'.repeat(64), etag: 'etag' });
  });

  it('promotes staging across explicit storage zones and never reads staging from public', async () => {
    const cos = { putObjectCopy: vi.fn((_params, cb) => cb(null, {})), getObject: vi.fn((_params, cb) => cb(null, { Body: Buffer.from('abc') })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await store.promote({ sourceKey: 'staging/admin/u/f.webp', destinationKey: 'media/works/w/f.webp', storageZone: 'public', contentType: 'image/webp' });
    expect(cos.putObjectCopy).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'public-123', CopySource: 'private-123.cos.ap-test.myqcloud.com/staging/admin/u/f.webp', Key: 'media/works/w/f.webp' }), expect.any(Function));
    await store.read({ objectKey: 'staging/admin/u/f.webp' });
    expect(cos.getObject).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123' }), expect.any(Function));
  });

  it('uses the COS forbid-overwrite header and parses the installed SDK versioning result shape', async () => {
    const valid = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":1,"works":[]}');
    const cos = { getBucketVersioning: vi.fn((_params, cb) => cb(null, { VersioningConfiguration: {} })), putObject: vi.fn((_params, cb) => cb(null, {})) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await store.putImmutable('snapshots/public/catalog.v1.json', valid, { version: 1, schemaVersion: 1, cacheControl: 'immutable' });
    expect(cos.getBucketVersioning).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'public-123' }), expect.any(Function));
    expect(cos.putObject).toHaveBeenCalledWith(expect.objectContaining({ Headers: { 'x-cos-forbid-overwrite': 'true' } }), expect.any(Function));
    const putObject = vi.fn();
    const versioned = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: { Status: 'Enabled' } })), putObject } });
    await expect(versioned.putImmutable('snapshots/public/catalog.v1.json', valid, { version: 1, schemaVersion: 1 })).rejects.toMatchObject({ status: 409, errorCode: 'SNAPSHOT_CONFLICT' });
    expect(putObject).not.toHaveBeenCalled();
    const suspended = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: { Status: 'Suspended' } })), putObject: vi.fn((_p, cb) => cb(null, {})) } });
    await expect(suspended.putImmutable('snapshots/public/catalog.v1.json', valid, { version: 1, schemaVersion: 1 })).resolves.toMatchObject({ existed: false });
  });

  it.each([{}, { VersioningConfiguration: null }, { VersioningConfiguration: { Status: 'Broken' } }])('fails closed for malformed bucket versioning result %j', async (result) => {
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getBucketVersioning: vi.fn((_p, cb) => cb(null, result)), putObject: vi.fn() } });
    const bytes = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":1,"works":[]}');
    await expect(store.putImmutable('snapshots/public/catalog.v1.json', bytes, { version: 1, schemaVersion: 1 })).rejects.toMatchObject({ status: 503, errorCode: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('accepts an existing immutable object only after reading and validating its bytes', async () => {
    const bytes = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[]}');
    async function* stream() { yield bytes.subarray(0, 9); yield bytes.subarray(9); }
    const cos = { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: {} })), putObject: vi.fn((_p, cb) => cb({ code: 'FileAlreadyExists', statusCode: 409 })), getObject: vi.fn((_p, cb) => cb(null, { Body: stream() })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await expect(store.putImmutable('snapshots/public/catalog.v2.json', bytes, { version: 2, schemaVersion: 1 })).resolves.toMatchObject({ bytes, existed: true });
  });

  it.each([
    ['extra internal field', '{"generatedAt":"2030-01-01T00:00:00.000Z","internalId":"x","schemaVersion":1,"version":2,"works":[]}'],
    ['restricted work', '{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[{"assets":[],"chapters":[],"publishedAt":"2030-01-01T00:00:00.000Z","rating":"restricted","slug":"x","summary":"","title":"X","type":"comic"}]}'],
    ['protected path', '{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[{"assets":[{"kind":"page","path":"protected/works/x/1.webp"}],"chapters":[],"publishedAt":"2030-01-01T00:00:00.000Z","rating":"general","slug":"x","summary":"","title":"X","type":"comic"}]}'],
    ['non canonical', '{ "schemaVersion": 1, "version": 2, "generatedAt": "2030-01-01T00:00:00.000Z", "works": [] }'],
    ['wrong work sort', '{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[{"assets":[],"chapters":[],"publishedAt":"2030-01-01T00:00:00.000Z","rating":"general","slug":"z","summary":"","title":"Z","type":"comic"},{"assets":[],"chapters":[],"publishedAt":"2030-01-01T00:00:00.000Z","rating":"general","slug":"a","summary":"","title":"A","type":"comic"}]}'],
    ['different job timestamp', '{"generatedAt":"2031-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[]}'],
  ])('rejects existing immutable catalog with %s', async (_name, text) => {
    const cos = { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: {} })), putObject: vi.fn((_p, cb) => cb({ code: 'FileAlreadyExists', statusCode: 409 })), getObject: vi.fn((_p, cb) => cb(null, { Body: Buffer.from(text) })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    const proposed = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[]}');
    await expect(store.putImmutable('snapshots/public/catalog.v2.json', proposed, { version: 2, schemaVersion: 1 })).rejects.toMatchObject({ status: 409, errorCode: 'SNAPSHOT_CONFLICT' });
  });

  it('validates proposed bytes before any immutable write', async () => {
    const putObject = vi.fn();
    const cos = { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: {} })), putObject };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    const unsafe = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[{"assets":[],"chapters":[],"publishedAt":"2030-01-01T00:00:00.000Z","rating":"restricted","slug":"x","summary":"","title":"X","type":"comic"}]}');
    await expect(store.putImmutable('snapshots/public/catalog.v2.json', unsafe, { version: 2, schemaVersion: 1 })).rejects.toMatchObject({ status: 409 });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('stops collecting an oversized existing immutable stream', async () => {
    let yielded = 0;
    async function* oversized() { while (yielded < 12) { yielded += 1; yield Buffer.alloc(1024 * 1024); } }
    const cos = { getBucketVersioning: vi.fn((_p, cb) => cb(null, { VersioningConfiguration: {} })), putObject: vi.fn((_p, cb) => cb({ code: 'FileAlreadyExists', statusCode: 409 })), getObject: vi.fn((_p, cb) => cb(null, { Body: oversized() })) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    const proposed = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":2,"works":[]}');
    await expect(store.putImmutable('snapshots/public/catalog.v2.json', proposed, { version: 2, schemaVersion: 1 })).rejects.toMatchObject({ status: 413 });
    expect(yielded).toBeLessThan(12);
  });
});
