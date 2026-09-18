/* eslint-env node */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCosObjectStore, createRuntimeCosObjectStore } = require('../src/infrastructure/cos');
const SIGN_NOW_SECONDS = 2_000_000_000;
function signedReadUrl(changes = {}) {
  const params = new URLSearchParams({
    'q-sign-algorithm': 'sha1', 'q-ak': 'testpublicid1', 'q-sign-time': `${SIGN_NOW_SECONDS - 5};${SIGN_NOW_SECONDS + 295}`,
    'q-key-time': `${SIGN_NOW_SECONDS - 5};${SIGN_NOW_SECONDS + 295}`, 'q-header-list': 'host', 'q-url-param-list': '', 'q-signature': 'a'.repeat(40),
    ...(changes.params || {}),
  });
  for (const key of changes.remove || []) params.delete(key);
  for (const [key, value] of changes.duplicates || []) params.append(key, value);
  for (const [key, value] of Object.entries(changes.extraParams || {})) params.append(key, value);
  return `${changes.origin || 'https://private-123.cos.ap-test.myqcloud.com'}${changes.path || '/protected/works/w/p.webp'}?${params}${changes.fragment || ''}`;
}

describe('COS object-store adapter', () => {
  it('uses methods exposed by the installed COS SDK contract', () => {
    const COS = require('cos-nodejs-sdk-v5');
    const client = new COS({ SecretId: 'test-id', SecretKey: 'test-key' });
    for (const method of ['getObjectUrl', 'headObject', 'getObject', 'putObjectCopy', 'putObject', 'deleteObject', 'getBucketVersioning', 'headBucket', 'getBucketACL', 'getBucketCors']) expect(client[method]).toBeTypeOf('function');
    const types = readFileSync(require.resolve('cos-nodejs-sdk-v5/index.d.ts'), 'utf8');
    expect(types).toMatch(/interface GetBucketVersioningResult[\s\S]*?VersioningConfiguration:\s*VersioningConfiguration/);
  });
  it('checks both buckets and their ACL/CORS configuration without returning names or SDK errors', async () => {
    const method = (data) => vi.fn((_params, callback) => callback(null, data));
    const cos = { headBucket: method({}), getBucketACL: method({ Grants: [] }), getBucketCors: method({ CORSRules: [] }) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    await expect(store.health()).resolves.toEqual({ ok: true, region: 'ap-test', publicBucketConfigured: true, privateBucketConfigured: true, publicCorsConfigured: true, privateCorsConfigured: true });
    expect(cos.headBucket).toHaveBeenCalledTimes(2); expect(cos.getBucketACL).toHaveBeenCalledTimes(2); expect(cos.getBucketCors).toHaveBeenCalledTimes(2);
    const failed = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { headBucket: vi.fn((_params, callback) => callback(new Error('private detail'))) } });
    const degraded = await failed.health();
    expect(degraded).toMatchObject({ ok: false, publicBucketConfigured: false, privateBucketConfigured: false });
    expect(JSON.stringify(degraded)).not.toMatch(/private detail|public-123|private-123/);
  });
  it('signs only a five-minute PUT for the exact staging object and declared headers', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1' }));
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl } });
    const result = await store.signPut({ objectKey: 'staging/admin/u/f.webp', contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123', Region: 'ap-test', Key: 'staging/admin/u/f.webp', Method: 'PUT', Sign: true, Expires: 300, Headers: { 'Content-Type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } }), expect.any(Function));
    expect(result).toEqual({ url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } });
  });

  it('keeps submission staging out of header-signed PUT tickets', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: 'https://bucket.cos.test/key?q-sign-algorithm=sha1' }));
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl } });
    const userId = '11111111-1111-4111-8111-111111111111';
    const submissionId = '22222222-2222-4222-8222-222222222222';
    const uploadId = '33333333-3333-4333-8333-333333333333';
    const fileId = '44444444-4444-4444-8444-444444444444';
    const objectKey = `staging/submissions/${userId}/${submissionId}/${uploadId}/${fileId}.webp`;
    for (const invalid of [objectKey,
      `staging/submissions/${userId}/${submissionId}/${uploadId}/../${fileId}.webp`,
      `staging/submissions/${userId}/${submissionId}/not-an-upload/${fileId}.webp`,
      `staging/submissions/${userId}/${submissionId}/${uploadId}/${fileId}.webp/extra`,
    ]) await expect(store.signPut({ objectKey: invalid, contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 })).rejects.toMatchObject({ status: 400 });
    expect(getObjectUrl).not.toHaveBeenCalled();
  });

  it('creates a five-minute browser POST policy bound to key, size, MIME and checksum', async () => {
    const store = createCosObjectStore({
      publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: {}, clock: () => SIGN_NOW_SECONDS * 1000,
      credentials: { secretId: 'testpublicid1', secretKey: 'test-secret-key', securityToken: 'test-token' },
    });
    const key = 'staging/submissions/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp';
    const ticket = await store.signPost({ objectKey: key, contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(ticket.url).toBe('https://private-123.cos.ap-test.myqcloud.com/');
    expect(ticket.fields).toMatchObject({ key, 'Content-Type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64), 'q-sign-algorithm': 'sha1', 'q-ak': 'testpublicid1', 'x-cos-security-token': 'test-token' });
    expect(ticket.fields['q-signature']).toMatch(/^[a-f0-9]{40}$/);
    const policy = JSON.parse(Buffer.from(ticket.fields.policy, 'base64').toString('utf8'));
    expect(policy).toEqual({ expiration: new Date((SIGN_NOW_SECONDS + 300) * 1000).toISOString(), conditions: [
      { bucket: 'private-123' }, ['eq', '$key', key], ['content-length-range', 1, 123], ['eq', '$Content-Type', 'image/webp'], ['eq', '$x-cos-meta-sha256', 'a'.repeat(64)],
      { 'q-sign-algorithm': 'sha1' }, { 'q-ak': 'testpublicid1' }, { 'q-sign-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 300}` }, ['eq', '$x-cos-security-token', 'test-token'],
    ] });
  });

  it('builds browser POST policies from the same temporary credentials used by the runtime SDK client', async () => {
    const clients = [];
    class FakeCOS { constructor(options) { this.options = options; clients.push(this); } }
    const store = createRuntimeCosObjectStore({ config: { cosPublicBucket: 'public-123', cosPrivateBucket: 'private-123', cosRegion: 'ap-test' }, env: { TENCENTCLOUD_SECRETID: 'runtimepublicid', TENCENTCLOUD_SECRETKEY: 'fixture-secret-key', TENCENTCLOUD_SESSIONTOKEN: 'fixture-token' }, COS: FakeCOS });
    const key = 'staging/submissions/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp';
    const ticket = await store.signPost({ objectKey: key, contentType: 'image/webp', contentLength: 5, checksum: 'a'.repeat(64), expiresInSeconds: 300 });
    expect(clients[0].options).toMatchObject({ SecretId: 'runtimepublicid', SecretKey: 'fixture-secret-key', SecurityToken: 'fixture-token', Protocol: 'https:' });
    expect(ticket.fields).toMatchObject({ 'q-ak': 'runtimepublicid', 'x-cos-security-token': 'fixture-token' });
  });

  it('rejects malformed submission POST requests and missing signing credentials', async () => {
    const key = 'staging/submissions/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp';
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: {}, credentials: { secretId: 'id', secretKey: 'fixture-secret-key' } });
    await expect(store.signPost({ objectKey: key.replace('staging/submissions/', 'staging/admin/'), contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 })).rejects.toMatchObject({ status: 400 });
    await expect(store.signPost({ objectKey: key, contentType: 'image/webp', contentLength: 0, checksum: 'a'.repeat(64), expiresInSeconds: 300 })).rejects.toMatchObject({ status: 400 });
    await expect(createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: {} }).signPost({ objectKey: key, contentType: 'image/webp', contentLength: 123, checksum: 'a'.repeat(64), expiresInSeconds: 300 })).rejects.toMatchObject({ status: 503 });
  });

  it('signs GET only from the private protected work prefix for exactly five minutes', async () => {
    const getObjectUrl = vi.fn((_params, callback) => callback(null, { Url: signedReadUrl() }));
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl }, clock: () => SIGN_NOW_SECONDS * 1000 });
    const result = await store.signGet({ objectKey: 'protected/works/w/p.webp', expiresInSeconds: 300 });
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'private-123', Region: 'ap-test', Key: 'protected/works/w/p.webp', Method: 'GET', Sign: true, Expires: 300 }), expect.any(Function));
    expect(result.url).toContain('private-123.cos.ap-test.myqcloud.com');
    expect(result.expiresAt).toBe(new Date((SIGN_NOW_SECONDS + 295) * 1000).toISOString());
    await expect(store.signGet({ objectKey: 'media/works/w/p.webp', expiresInSeconds: 300 })).rejects.toMatchObject({ status: 400 });
    await expect(store.signGet({ objectKey: 'protected/works/w/p.webp', expiresInSeconds: 600 })).rejects.toMatchObject({ status: 400 });
  });

  it('accepts the installed COS SDK GET signing scope: host header and no signed URL params', async () => {
    const COS = require('cos-nodejs-sdk-v5');
    const cos = new COS({ SecretId: 'testpublicid1', SecretKey: 'test-secret-key', SecurityToken: 'test-security-token', Protocol: 'https:' });
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    const result = await store.signGet({ objectKey: 'protected/works/w/p.webp', expiresInSeconds: 300 });
    const params = new URL(result.url).searchParams;
    expect(params.get('q-header-list')).toBe('host');
    expect(params.get('q-url-param-list')).toBe('');
    expect(params.get('x-cos-security-token')).toBe('test-security-token');
  });

  it('accepts canonical percent-encoded signed query names only when the actual query scope matches', async () => {
    const url = signedReadUrl({ params: { 'q-url-param-list': 'a%20b;download' }, extraParams: { 'a b': 'x', download: '1' } });
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl: vi.fn((_params, cb) => cb(null, { Url: url })) }, clock: () => SIGN_NOW_SECONDS * 1000 });
    await expect(store.signGet({ objectKey: 'protected/works/w/p.webp', expiresInSeconds: 300 })).resolves.toMatchObject({ expiresAt: new Date((SIGN_NOW_SECONDS + 295) * 1000).toISOString() });
  });

  it.each([
    ['website host', signedReadUrl({ origin: 'https://private-123.cos-website.ap-test.myqcloud.com' })],
    ['suffix host', signedReadUrl({ origin: 'https://private-123.cos.ap-test.myqcloud.com.evil.test' })],
    ['userinfo', signedReadUrl({ origin: 'https://user@private-123.cos.ap-test.myqcloud.com' })],
    ['non-default port', signedReadUrl({ origin: 'https://private-123.cos.ap-test.myqcloud.com:444' })],
    ['wrong path', signedReadUrl({ path: '/protected/works/other/p.webp' })],
    ['fragment', signedReadUrl({ fragment: '#leak' })],
    ...['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature'].map((field) => [`missing ${field}`, signedReadUrl({ remove: [field] })]),
    ...['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature'].map((field) => [`duplicate ${field}`, signedReadUrl({ duplicates: [[field, field === 'q-signature' ? 'b'.repeat(40) : 'duplicate']] })]),
    ['algorithm', signedReadUrl({ params: { 'q-sign-algorithm': 'sha256' } })],
    ['access key', signedReadUrl({ params: { 'q-ak': 'bad!' } })],
    ['signature', signedReadUrl({ params: { 'q-signature': 'xyz' } })],
    ['missing signed host', signedReadUrl({ params: { 'q-header-list': '' } })],
    ['uppercase header list', signedReadUrl({ params: { 'q-header-list': 'Host' } })],
    ['duplicate header list', signedReadUrl({ params: { 'q-header-list': 'host;host' } })],
    ['unexpected signed header', signedReadUrl({ params: { 'q-header-list': 'host;x-cos-meta-test' } })],
    ['claimed URL param absent', signedReadUrl({ params: { 'q-url-param-list': 'download' } })],
    ['actual URL param omitted', signedReadUrl({ extraParams: { download: '1' } })],
    ['duplicate URL list', signedReadUrl({ params: { 'q-url-param-list': 'download;download' }, extraParams: { download: '1' } })],
    ['unsorted URL list', signedReadUrl({ params: { 'q-url-param-list': 'z;a' }, extraParams: { a: '1', z: '2' } })],
    ['noncanonical encoded URL list', signedReadUrl({ params: { 'q-url-param-list': '%41' }, extraParams: { A: '1' } })],
    ['case-shadowed signature field', signedReadUrl({ params: { 'q-url-param-list': 'q-ak' }, extraParams: { 'Q-AK': 'shadow' } })],
    ['mismatched key time', signedReadUrl({ params: { 'q-key-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 100}` } })],
    ['window too long', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 301}`, 'q-key-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 301}` } })],
    ['future start', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS + 61};${SIGN_NOW_SECONDS + 100}`, 'q-key-time': `${SIGN_NOW_SECONDS + 61};${SIGN_NOW_SECONDS + 100}` } })],
    ['any future start', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS + 1};${SIGN_NOW_SECONDS + 100}`, 'q-key-time': `${SIGN_NOW_SECONDS + 1};${SIGN_NOW_SECONDS + 100}` } })],
    ['end beyond remaining five minutes', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 301}`, 'q-key-time': `${SIGN_NOW_SECONDS};${SIGN_NOW_SECONDS + 301}` } })],
    ['start too old', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS - 61};${SIGN_NOW_SECONDS + 100}`, 'q-key-time': `${SIGN_NOW_SECONDS - 61};${SIGN_NOW_SECONDS + 100}` } })],
    ['expired', signedReadUrl({ params: { 'q-sign-time': `${SIGN_NOW_SECONDS - 400};${SIGN_NOW_SECONDS - 61}`, 'q-key-time': `${SIGN_NOW_SECONDS - 400};${SIGN_NOW_SECONDS - 61}` } })],
  ])('rejects malformed COS read URL: %s', async (_name, url) => {
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos: { getObjectUrl: vi.fn((_params, cb) => cb(null, { Url: url })) }, clock: () => SIGN_NOW_SECONDS * 1000 });
    await expect(store.signGet({ objectKey: 'protected/works/w/p.webp', expiresInSeconds: 300 })).rejects.toMatchObject({ status: 503, errorCode: 'DEPENDENCY_UNAVAILABLE' });
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

  it('promotes submission staging only to its same private work and file key', async () => {
    const cos = { putObjectCopy: vi.fn((_params, cb) => cb(null, {})) };
    const store = createCosObjectStore({ publicBucket: 'public-123', privateBucket: 'private-123', region: 'ap-test', cos });
    const userId = '11111111-1111-4111-8111-111111111111';
    const submissionId = '22222222-2222-4222-8222-222222222222';
    const uploadId = '33333333-3333-4333-8333-333333333333';
    const fileId = '44444444-4444-4444-8444-444444444444';
    const sourceKey = `staging/submissions/${userId}/${submissionId}/${uploadId}/${fileId}.webp`;
    const destinationKey = `protected/works/${submissionId}/${fileId}.webp`;
    await expect(store.promote({ sourceKey, destinationKey, storageZone: 'private', contentType: 'image/webp' })).resolves.toBeUndefined();
    for (const invalid of [
      { destinationKey: `media/works/${submissionId}/${fileId}.webp`, storageZone: 'public' },
      { destinationKey: `protected/works/55555555-5555-4555-8555-555555555555/${fileId}.webp`, storageZone: 'private' },
      { destinationKey: `protected/works/${submissionId}/66666666-6666-4666-8666-666666666666.webp`, storageZone: 'private' },
    ]) await expect(store.promote({ sourceKey, contentType: 'image/webp', ...invalid })).rejects.toMatchObject({ status: 400 });
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
