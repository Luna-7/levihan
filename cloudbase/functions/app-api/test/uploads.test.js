/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createUploadsService } = require('../src/modules/uploads/service');
const { createUploadsRepository } = require('../src/modules/uploads/repository');

const actorId = '550e8400-e29b-41d4-a716-446655440001';
const workId = '550e8400-e29b-41d4-a716-446655440002';
const uploadId = '550e8400-e29b-41d4-a716-446655440003';
const fileId = '550e8400-e29b-41d4-a716-446655440004';

function ctx(body, params = {}) {
  return { actorId, actorRole: 'admin', requestId: 'req-upload', body, params };
}

describe('direct COS upload tickets', () => {
  it('issues a short-lived server-selected staging key with exact PUT constraints', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId }) };
    const objectStore = { signPut: vi.fn().mockResolvedValue({ url: 'https://bucket.cos.test/staging?signature=redacted', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) } }) };
    const service = createUploadsService({ repository, objectStore, now: () => new Date('2030-01-01T00:00:00.000Z') });
    const response = await service.initAdmin(ctx({ workId, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 1024, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' }));
    expect(response).toEqual(expect.objectContaining({ uploadId, fileId, method: 'PUT', expiresAt: '2030-01-01T00:05:00.000Z' }));
    expect(response.objectKey).toMatch(new RegExp(`^staging/admin/${uploadId}/${fileId}\\.webp$`));
    expect(repository.createUpload).toHaveBeenCalledWith(expect.objectContaining({ ownerId: actorId, purpose: 'work_asset', expiresAt: '2030-01-01T00:05:00.000Z' }));
    expect(objectStore.signPut).toHaveBeenCalledWith(expect.objectContaining({ contentLength: 1024, contentType: 'image/webp', expiresInSeconds: 300 }));
  });

  it.each([
    [{ filename: 'x.html', mimeType: 'text/html', sizeBytes: 10 }, 'type'],
    [{ filename: 'x.jpg', mimeType: 'image/png', sizeBytes: 10 }, 'extension'],
    [{ filename: 'x.webp', mimeType: 'image/webp', sizeBytes: 20 * 1024 * 1024 + 1 }, 'size'],
    [{ filename: 'x.webp', mimeType: 'image/webp', sizeBytes: 10, data: 'base64' }, 'unsupported'],
  ])('rejects unsafe declarations (%s)', async (unsafe) => {
    const service = createUploadsService({ repository: {}, objectStore: {} });
    await expect(service.initAdmin(ctx({ workId, checksum: 'a'.repeat(64), kind: 'cover', accessLevel: 'public', ...unsafe })))
      .rejects.toMatchObject({ status: expect.any(Number), errorCode: expect.stringMatching(/VALIDATION_FAILED|PAYLOAD_TOO_LARGE/) });
  });

  it('HEAD-verifies size, MIME and checksum before atomically binding a work asset', async () => {
    const declared = { uploadId, fileId, workId, ownerId: actorId, objectKey: `staging/admin/${uploadId}/${fileId}.webp`, expectedSize: 1024, mimeType: 'image/webp', checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public', expiresAt: '2030-01-01T00:05:00.000Z', status: 'declared' };
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue(declared), completeAndBind: vi.fn().mockResolvedValue({ assetId: workId, status: 'verified' }) };
    const bytes = Buffer.concat([Buffer.from('524946460400000057454250', 'hex'), Buffer.alloc(1012)]);
    const checksum = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    declared.checksum = checksum;
    const objectStore = { head: vi.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'image/webp', etag: 'etag-1' }), read: vi.fn().mockResolvedValue(bytes), promote: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    const service = createUploadsService({ repository, objectStore, now: () => new Date('2030-01-01T00:01:00.000Z') });
    const result = await service.completeAdmin(ctx({}, { id: uploadId }));
    expect(result).toEqual({ assetId: workId, status: 'verified' });
    expect(repository.completeAndBind).toHaveBeenCalledWith(expect.objectContaining({ uploadId, fileId, actorId, requestId: 'req-upload', etag: 'etag-1' }));
    expect(objectStore.promote).toHaveBeenCalledWith(expect.objectContaining({ storageZone: 'public', destinationKey: expect.stringMatching(/^media\/works\//) }));
    expect(objectStore.delete).toHaveBeenCalledWith(declared.objectKey);
  });

  it.each([
    [{ sizeBytes: 1023, contentType: 'image/webp', checksum: 'a'.repeat(64) }],
    [{ sizeBytes: 1024, contentType: 'text/html', checksum: 'a'.repeat(64) }],
    [{ sizeBytes: 1024, contentType: 'image/webp', checksum: 'b'.repeat(64) }],
  ])('rejects a mismatched COS object without binding it', async (metadata) => {
    const declared = { uploadId, fileId, workId, ownerId: actorId, objectKey: `staging/admin/${uploadId}/${fileId}.webp`, expectedSize: 1024, mimeType: 'image/webp', checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public', expiresAt: '2030-01-01T00:05:00.000Z', status: 'declared' };
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue(declared), completeAndBind: vi.fn() };
    const service = createUploadsService({ repository, objectStore: { head: vi.fn().mockResolvedValue(metadata), read: vi.fn().mockResolvedValue(Buffer.from('bad')), promote: vi.fn() }, now: () => new Date('2030-01-01T00:01:00.000Z') });
    await expect(service.completeAdmin(ctx({}, { id: uploadId }))).rejects.toMatchObject({ status: 422, errorCode: 'UPLOAD_NOT_VERIFIED' });
    expect(repository.completeAndBind).not.toHaveBeenCalled();
  });

  it('rejects executable text even when HEAD metadata and declared checksum claim text/plain', async () => {
    const bytes = Buffer.from('<script>alert(1)</script>');
    const checksum = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const declared = { uploadId, fileId, workId, ownerId: actorId, objectKey: `staging/admin/${uploadId}/${fileId}.txt`, expectedSize: bytes.length, mimeType: 'text/plain', checksum, kind: 'body', pageNo: null, accessLevel: 'public', expiresAt: '2030-01-01T00:05:00.000Z', status: 'declared' };
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue(declared), completeAndBind: vi.fn() };
    const service = createUploadsService({ repository, objectStore: { head: vi.fn().mockResolvedValue({ sizeBytes: bytes.length, contentType: 'text/plain', etag: 'e' }), read: vi.fn().mockResolvedValue(bytes), promote: vi.fn() }, now: () => new Date('2030-01-01T00:01:00.000Z') });
    await expect(service.completeAdmin(ctx({}, { id: uploadId }))).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_VERIFIED' });
    expect(repository.completeAndBind).not.toHaveBeenCalled();
  });

  it('returns the existing asset for an idempotent completion retry after staging cleanup', async () => {
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue({ uploadId, fileId, workId, ownerId: actorId, purpose: 'work_asset', status: 'bound', assetId: workId, finalObjectKey: `media/works/${workId}/${fileId}.webp`, storageZone: 'public' }) };
    const objectStore = { head: vi.fn(), read: vi.fn(), promote: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.completeAdmin(ctx({}, { id: uploadId }))).resolves.toEqual({ assetId: workId, status: 'verified' });
    expect(objectStore.head).not.toHaveBeenCalled();
  });
});

describe('upload repository transaction boundary', () => {
  it('creates and completes uploads only through ownership-validating routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ upload_id: uploadId, file_id: fileId }], error: null })
      .mockResolvedValueOnce({ data: [{ asset_id: workId, status: 'verified' }], error: null });
    const repository = createUploadsRepository({ rdb: { rpc } });
    expect(await repository.createUpload({ uploadId, fileId, ownerId: actorId, workId, objectKey: 'staging/admin/key.webp', expectedSize: 4, mimeType: 'image/webp', checksum: 'a'.repeat(64), kind: 'cover', accessLevel: 'public', expiresAt: '2030-01-01T00:05:00Z', requestId: 'req' })).toEqual({ uploadId, fileId });
    expect(await repository.completeAndBind({ uploadId, fileId, ownerId: actorId, actorId, workId, objectKey: 'staging/admin/key.webp', sizeBytes: 4, mimeType: 'image/webp', checksum: 'a'.repeat(64), etag: 'e', kind: 'cover', accessLevel: 'public', requestId: 'req' })).toEqual({ assetId: workId, status: 'verified' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['create_work_upload', 'complete_work_upload']);
  });
});
