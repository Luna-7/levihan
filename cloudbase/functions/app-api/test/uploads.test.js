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
  return { actorId, actorRole: 'admin', requestId: 'req-upload', idempotencyKey: 'upload-operation-1', idempotencyRequestHash: 'f'.repeat(64), body, params };
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

  it('reuses one domain identity while issuing a fresh signed URL for the same request hash', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId, state: 'declared', objectKey: `staging/admin/${uploadId}/${fileId}.webp` }) };
    const objectStore = { signPut: vi.fn().mockResolvedValueOnce({ url: 'https://bucket.cos.test/one', headers: { 'content-type': 'image/webp' } }).mockResolvedValueOnce({ url: 'https://bucket.cos.test/two', headers: { 'content-type': 'image/webp' } }) };
    const service = createUploadsService({ repository, objectStore, now: () => new Date('2030-01-01T00:00:00.000Z') });
    const body = { workId, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' };
    const first = await service.initAdmin(ctx(body)); const second = await service.initAdmin(ctx(body));
    expect(first.uploadId).toBe(second.uploadId); expect(first.objectKey).toBe(second.objectKey); expect(first.uploadUrl).not.toBe(second.uploadUrl);
    expect(repository.createUpload.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'upload-operation-1', requestHash: 'f'.repeat(64) });
  });

  it('returns the prior completion identity when the upload operation is already bound', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId, state: 'bound', assetId: workId }) };
    const objectStore = { signPut: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.initAdmin(ctx({ workId, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' }))).resolves.toEqual({ uploadId, fileId, assetId: workId, status: 'verified' });
    expect(objectStore.signPut).not.toHaveBeenCalled();
  });

  it('returns durable processing identity without re-signing staging while promotion is active', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId, state: 'promoting' }) };
    const objectStore = { signPut: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.initAdmin(ctx({ workId, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' }))).resolves.toEqual({ uploadId, fileId, status: 'processing' });
    expect(objectStore.signPut).not.toHaveBeenCalled();
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
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue(declared), beginPromotion: vi.fn().mockResolvedValue({ promotionToken: uploadId, objectKey: `media/works/${workId}/${fileId}.webp`, storageZone: 'public', state: 'promoting' }), completeAndBind: vi.fn().mockResolvedValue({ assetId: workId, status: 'verified' }) };
    const bytes = Buffer.concat([Buffer.from('524946460400000057454250', 'hex'), Buffer.alloc(1012)]);
    const checksum = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    declared.checksum = checksum;
    const objectStore = { head: vi.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'image/webp', etag: 'etag-1' }), read: vi.fn().mockResolvedValue(bytes), promote: vi.fn().mockResolvedValue(undefined), headFinal: vi.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'image/webp', etag: 'etag-2' }), readFinal: vi.fn().mockResolvedValue(bytes), delete: vi.fn() };
    const service = createUploadsService({ repository, objectStore, now: () => new Date('2030-01-01T00:01:00.000Z') });
    const result = await service.completeAdmin(ctx({}, { id: uploadId }));
    expect(result).toEqual({ assetId: workId, status: 'verified' });
    expect(repository.completeAndBind).toHaveBeenCalledWith(expect.objectContaining({ uploadId, fileId, actorId, requestId: 'req-upload', promotionToken: uploadId, etag: 'etag-2' }));
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

  it('resumes a durable promotion from the final object after staging is gone', async () => {
    const bytes = Buffer.concat([Buffer.from('524946460400000057454250', 'hex'), Buffer.alloc(12)]);
    const checksum = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const promoting = { uploadId, fileId, workId, ownerId: actorId, purpose: 'work_asset', objectKey: `staging/admin/${uploadId}/${fileId}.webp`, expectedSize: bytes.length, mimeType: 'image/webp', checksum, kind: 'page', pageNo: 1, accessLevel: 'public', status: 'promoting', promotionToken: uploadId, finalObjectKey: `media/works/${workId}/${fileId}.webp`, storageZone: 'public' };
    const repository = { getUploadForCompletion: vi.fn().mockResolvedValue(promoting), completeAndBind: vi.fn().mockResolvedValue({ assetId: workId, status: 'verified' }) };
    const objectStore = { promote: vi.fn().mockRejectedValue(new Error('staging missing')), headFinal: vi.fn().mockResolvedValue({ sizeBytes: bytes.length, contentType: 'image/webp', etag: 'final' }), readFinal: vi.fn().mockResolvedValue(bytes), delete: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.completeAdmin(ctx({}, { id: uploadId }))).resolves.toEqual({ assetId: workId, status: 'verified' });
    expect(repository.completeAndBind).toHaveBeenCalledWith(expect.objectContaining({ promotionToken: uploadId, objectKey: promoting.finalObjectKey }));
  });

  it('deletes both tracked objects then token-finalizes stale promotion cleanup', async () => {
    const repository = { claimStalePromotions: vi.fn().mockResolvedValue([{ fileId, stagingKey: `staging/admin/${uploadId}/${fileId}.webp`, finalKey: `media/works/${workId}/${fileId}.webp`, cleanupToken: uploadId }]), finalizePromotionCleanup: vi.fn() };
    const objectStore = { delete: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.cleanupStalePromotions({ actorId, actorRole: 'admin' })).resolves.toEqual({ claimed: 1, failed: 0, reportingFailed: 0 });
    expect(objectStore.delete).toHaveBeenCalledTimes(2);
    expect(repository.finalizePromotionCleanup).toHaveBeenCalledWith({ fileId, cleanupToken: uploadId, actorId });
  });

  it('persists a safe retry outcome when cleanup fails instead of silently swallowing it', async () => {
    const repository = { claimStalePromotions: vi.fn().mockResolvedValue([{ fileId, stagingKey: `staging/admin/${uploadId}/${fileId}.webp`, finalKey: `media/works/${workId}/${fileId}.webp`, cleanupToken: uploadId }]), finalizePromotionCleanup: vi.fn(), failPromotionCleanup: vi.fn() };
    const objectStore = { delete: vi.fn().mockRejectedValue(new Error('SDK secret detail')) };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.cleanupStalePromotions({ actorId, actorRole: 'admin' })).resolves.toEqual({ claimed: 1, failed: 1, reportingFailed: 0 });
    expect(repository.failPromotionCleanup).toHaveBeenCalledWith({ fileId, cleanupToken: uploadId, actorId, errorCode: 'FINAL_DELETE_FAILED' });
    expect(repository.finalizePromotionCleanup).not.toHaveBeenCalled();
  });

  it('classifies cleanup stages and processes the whole batch when finalize and failure reporting fail', async () => {
    const secondFile = actorId; const secondToken = workId;
    const repository = {
      claimStalePromotions: vi.fn().mockResolvedValue([
        { fileId, stagingKey: 'staging/admin/a', finalKey: 'media/works/a', cleanupToken: uploadId },
        { fileId: secondFile, stagingKey: 'staging/admin/b', finalKey: 'media/works/b', cleanupToken: secondToken },
      ]),
      finalizePromotionCleanup: vi.fn().mockRejectedValueOnce(new Error('token detail')).mockResolvedValueOnce(undefined),
      failPromotionCleanup: vi.fn().mockRejectedValueOnce(new Error('database detail')),
    };
    const objectStore = { delete: vi.fn() };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.cleanupStalePromotions({ actorId, actorRole: 'admin' })).resolves.toEqual({ claimed: 2, failed: 1, reportingFailed: 1 });
    expect(repository.failPromotionCleanup).toHaveBeenCalledWith({ fileId, cleanupToken: uploadId, actorId, errorCode: 'CLEANUP_FINALIZE_FAILED' });
    expect(repository.finalizePromotionCleanup).toHaveBeenCalledWith({ fileId: secondFile, cleanupToken: secondToken, actorId });
    expect(objectStore.delete).toHaveBeenCalledTimes(4);
  });

  it('distinguishes staging deletion failure from final deletion failure', async () => {
    const repository = { claimStalePromotions: vi.fn().mockResolvedValue([{ fileId, stagingKey: 'staging/admin/a', finalKey: 'media/works/a', cleanupToken: uploadId }]), finalizePromotionCleanup: vi.fn(), failPromotionCleanup: vi.fn() };
    const objectStore = { delete: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('private detail')) };
    const service = createUploadsService({ repository, objectStore });
    await expect(service.cleanupStalePromotions({ actorId, actorRole: 'admin' })).resolves.toEqual({ claimed: 1, failed: 1, reportingFailed: 0 });
    expect(repository.failPromotionCleanup).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STAGING_DELETE_FAILED' }));
  });
});

describe('upload repository transaction boundary', () => {
  it('creates and completes uploads only through ownership-validating routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ upload_id: uploadId, file_id: fileId }], error: null })
      .mockResolvedValueOnce({ data: [{ promotion_token: uploadId, object_key: `media/works/${workId}/${fileId}.webp`, storage_zone: 'public', state: 'promoting' }], error: null })
      .mockResolvedValueOnce({ data: [{ asset_id: workId, status: 'verified' }], error: null });
    const repository = createUploadsRepository({ rdb: { rpc } });
    expect(await repository.createUpload({ uploadId, fileId, ownerId: actorId, workId, objectKey: 'staging/admin/key.webp', expectedSize: 4, mimeType: 'image/webp', checksum: 'a'.repeat(64), kind: 'cover', accessLevel: 'public', expiresAt: '2030-01-01T00:05:00Z', requestId: 'req' })).toEqual({ uploadId, fileId, state: 'declared' });
    await repository.beginPromotion({ uploadId, fileId, actorId, promotionToken: uploadId, objectKey: `media/works/${workId}/${fileId}.webp`, storageZone: 'public', sizeBytes: 4, mimeType: 'image/webp', checksum: 'a'.repeat(64), etag: 'e' });
    expect(await repository.completeAndBind({ uploadId, fileId, ownerId: actorId, actorId, workId, objectKey: 'staging/admin/key.webp', sizeBytes: 4, mimeType: 'image/webp', checksum: 'a'.repeat(64), etag: 'e', kind: 'cover', accessLevel: 'public', requestId: 'req' })).toEqual({ assetId: workId, status: 'verified' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['create_work_upload', 'begin_work_upload_promotion', 'complete_work_upload']);
  });

  it('maps domain idempotency conflicts to 409 instead of dependency 503', async () => {
    const repository = createUploadsRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'idempotency_conflict' } }) } });
    await expect(repository.createUpload({})).rejects.toMatchObject({ status: 409, errorCode: 'IDEMPOTENCY_CONFLICT' });
  });

  it.each([
    ['upload_unavailable', 409, 'STATE_CONFLICT'], ['upload_state_conflict', 409, 'STATE_CONFLICT'], ['slot_conflict', 409, 'STATE_CONFLICT'],
    ['restricted_storage_invalid', 422, 'UPLOAD_NOT_VERIFIED'], ['body_cardinality_invalid', 422, 'UPLOAD_NOT_VERIFIED'],
  ])('maps controlled SQL error %s to %s', async (message, status, errorCode) => {
    const repository = createUploadsRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) } });
    await expect(repository.createUpload({})).rejects.toMatchObject({ status, errorCode });
  });

  it('preserves every cleanup row returned by the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { upload_id: uploadId, file_id: fileId, staging_key: 'staging/admin/a', final_key: 'media/works/a', storage_zone: 'public', cleanup_token: uploadId },
      { upload_id: workId, file_id: actorId, staging_key: 'staging/admin/b', final_key: 'protected/works/b', storage_zone: 'private', cleanup_token: workId },
    ], error: null });
    const repository = createUploadsRepository({ rdb: { rpc } });
    await expect(repository.claimStalePromotions({ actorId, limit: 20 })).resolves.toHaveLength(2);
  });

  it('persists cleanup failure using only a safe code and fencing token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const repository = createUploadsRepository({ rdb: { rpc } });
    await repository.failPromotionCleanup({ fileId, cleanupToken: uploadId, actorId, errorCode: 'OBJECT_DELETE_FAILED' });
    expect(rpc).toHaveBeenCalledWith('fail_upload_promotion_cleanup', { p_file_id: fileId, p_cleanup_token: uploadId, p_actor_id: actorId, p_error_code: 'OBJECT_DELETE_FAILED' });
  });
});
