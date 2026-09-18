/* eslint-env node */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSubmissionsService } = require('../src/modules/submissions/service');
const { createSubmissionsRepository } = require('../src/modules/submissions/repository');
const { registerSubmissionRoutes } = require('../src/modules/submissions/routes');
const { createRouter } = require('../src/router');

const userId = '550e8400-e29b-41d4-a716-446655440001';
const sessionId = '550e8400-e29b-41d4-a716-446655440002';
const submissionId = '550e8400-e29b-41d4-a716-446655440003';
const uploadId = '550e8400-e29b-41d4-a716-446655440004';
const fileId = '550e8400-e29b-41d4-a716-446655440005';
const operation = 'submission-operation-1';
const requestHash = 'a'.repeat(64);

function ctx(overrides = {}) {
  return { actorId: userId, actorRole: 'member', actorSessionId: sessionId, requestId: 'request-1', idempotencyKey: operation, idempotencyRequestHash: requestHash, params: {}, query: {}, body: {}, ...overrides };
}

describe('submission service state writes', () => {
  it('creates a private draft through a session-bound idempotent transaction', async () => {
    const repository = { createDraft: vi.fn().mockResolvedValue({ id: submissionId, type: 'novel', title: '春', summary: '', status: 'draft', version: 1, assetCount: 0 }) };
    const service = createSubmissionsService({ repository, objectStore: {} });
    await expect(service.createDraft(ctx({ body: { type: 'novel', title: ' 春 ', summary: '', description: '正文说明', rating: 'mature' } }))).resolves.toMatchObject({ id: submissionId, status: 'draft' });
    expect(repository.createDraft).toHaveBeenCalledWith(expect.objectContaining({ userId, sessionId, title: '春', idempotencyKey: operation, requestHash, payload: { description: '正文说明', rating: 'mature' } }));
  });

  it('submits and withdraws using explicit expected versions', async () => {
    const repository = { transition: vi.fn().mockResolvedValue({ id: submissionId, status: 'submitted', version: 2, assetCount: 1 }) };
    const service = createSubmissionsService({ repository, objectStore: {} });
    await service.submit(ctx({ params: { id: submissionId }, body: { version: 1 } }));
    expect(repository.transition).toHaveBeenCalledWith(expect.objectContaining({ action: 'submit', expectedVersion: 1, userId, sessionId, idempotencyKey: operation }));
  });

  it('requires an active administrator session for review and keeps internal notes repository-only', async () => {
    const repository = { review: vi.fn().mockResolvedValue({ id: submissionId, status: 'rejected', version: 3, rejectionReason: '素材不完整', acceptedWorkId: null }) };
    const service = createSubmissionsService({ repository, objectStore: {} });
    const response = await service.review(ctx({ actorRole: 'admin', body: { version: 2, action: 'reject', rejectionReason: '素材不完整', internalNote: 'risk-token' }, params: { id: submissionId } }));
    expect(repository.review).toHaveBeenCalledWith(expect.objectContaining({ adminId: userId, adminSessionId: sessionId, internalNote: 'risk-token' }));
    expect(JSON.stringify(response)).not.toContain('risk-token');
  });

  it.each([
    [{ type: 'video', title: 'x', summary: '', description: '', rating: 'general' }],
    [{ type: 'novel', title: '', summary: '', description: '', rating: 'general' }],
    [{ type: 'novel', title: 'x', summary: '', description: 'x'.repeat(10001), rating: 'general' }],
  ])('rejects invalid draft input %#', async (body) => {
    const service = createSubmissionsService({ repository: {}, objectStore: {} });
    await expect(service.createDraft(ctx({ body }))).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
  });
});

describe('submission private direct uploads', () => {
  const declaration = { submissionType: 'comic', filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 16, checksum: 'b'.repeat(64), kind: 'page', pageNo: 1 };

  it('issues only a short-lived owner/submission-bound private staging ticket', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId, state: 'declared', objectKey: `staging/submissions/${userId}/${submissionId}/${uploadId}/${fileId}.webp` }) };
    const objectStore = { signPost: vi.fn().mockResolvedValue({ url: 'https://private.cos.test/', fields: { key: 'staging-key', policy: 'policy' } }) };
    const service = createSubmissionsService({ repository, objectStore, now: () => new Date('2030-01-01T00:00:00Z'), randomUUID: vi.fn().mockReturnValueOnce(uploadId).mockReturnValueOnce(fileId) });
    const result = await service.initUpload(ctx({ params: { id: submissionId }, body: declaration }));
    expect(result).toMatchObject({ uploadId, fileId, method: 'POST', fields: { policy: 'policy' }, expiresAt: '2030-01-01T00:05:00.000Z' });
    expect(repository.createUpload).toHaveBeenCalledWith(expect.objectContaining({ userId, sessionId, submissionId, submissionType: 'comic', purpose: 'submission_asset', objectKey: expect.stringMatching(/^staging\/submissions\//) }));
    expect(objectStore.signPost).toHaveBeenCalledWith(expect.objectContaining({ contentLength: 16, expiresInSeconds: 300 }));
  });

  it.each([
    [{ ...declaration, submissionType: 'novel' }],
    [{ ...declaration, submissionType: 'comic', kind: 'body', pageNo: undefined }],
    [{ ...declaration, submissionType: 'novel', kind: 'body', pageNo: undefined, mimeType: 'image/webp' }],
  ])('rejects type/kind/MIME mismatch before creating a ticket %#', async (body) => {
    const repository = { createUpload: vi.fn() };
    const service = createSubmissionsService({ repository, objectStore: {} });
    await expect(service.initUpload(ctx({ params: { id: submissionId }, body }))).rejects.toMatchObject({ status: 400 });
    expect(repository.createUpload).not.toHaveBeenCalled();
  });

  it('streams and magic-checks bytes before durable private binding', async () => {
    const bytes = Buffer.concat([Buffer.from('524946460400000057454250', 'hex'), Buffer.alloc(4)]);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const repository = {
      getUpload: vi.fn().mockResolvedValue({ uploadId, fileId, submissionId, ownerId: userId, purpose: 'submission_asset', objectKey: `staging/submissions/${userId}/${submissionId}/${uploadId}/${fileId}.webp`, expectedSize: bytes.length, mimeType: 'image/webp', checksum, kind: 'page', pageNo: 1, expiresAt: '2030-01-01T00:05:00Z', status: 'declared' }),
      beginPromotion: vi.fn().mockResolvedValue({ promotionToken: uploadId, objectKey: `protected/works/${submissionId}/${fileId}.webp`, storageZone: 'private' }),
      completeUpload: vi.fn().mockResolvedValue({ fileId, status: 'verified' }),
    };
    const objectStore = { head: vi.fn().mockResolvedValue({ sizeBytes: bytes.length, contentType: 'image/webp' }), read: vi.fn().mockResolvedValue(bytes), promote: vi.fn(), headFinal: vi.fn().mockResolvedValue({ sizeBytes: bytes.length, contentType: 'image/webp' }), readFinal: vi.fn().mockResolvedValue(bytes), delete: vi.fn() };
    const service = createSubmissionsService({ repository, objectStore, now: () => new Date('2030-01-01T00:01:00Z'), randomUUID: () => uploadId });
    await expect(service.completeUpload(ctx({ params: { id: submissionId, uploadId }, body: {} }))).resolves.toEqual({ fileId, status: 'verified' });
    expect(repository.completeUpload).toHaveBeenCalledWith(expect.objectContaining({ userId, sessionId, submissionId, objectKey: `protected/works/${submissionId}/${fileId}.webp`, storageZone: 'private', checksum }));
  });

  it('does not expose or persist a signed URL after a completed upload replay', async () => {
    const repository = { createUpload: vi.fn().mockResolvedValue({ uploadId, fileId, state: 'bound' }) };
    const objectStore = { signPost: vi.fn() };
    const service = createSubmissionsService({ repository, objectStore });
    await expect(service.initUpload(ctx({ params: { id: submissionId }, body: declaration }))).resolves.toEqual({ uploadId, fileId, status: 'verified' });
    expect(objectStore.signPost).not.toHaveBeenCalled();
  });
});

describe('submission repository and route boundaries', () => {
  it('passes session and idempotency material to PostgreSQL RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: submissionId, type: 'other', title: 'x', summary: '', status: 'draft', version: 1, asset_count: 0, created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z' }], error: null });
    const repository = createSubmissionsRepository({ rdb: { rpc } });
    await repository.createDraft({ userId, sessionId, type: 'other', title: 'x', summary: '', payload: {}, idempotencyKey: operation, requestHash, requestId: 'r' });
    expect(rpc).toHaveBeenCalledWith('create_submission_draft_v2', expect.objectContaining({ p_user_id: userId, p_session_id: sessionId, p_idempotency_key: operation, p_request_hash: requestHash }));
  });

  it('maps editable user fields while keeping internal notes admin-only', async () => {
    const row = { id: submissionId, user_id: userId, type: 'novel', title: 'x', summary: '', status: 'draft', version: 1, asset_count: 1, payload: { description: 'edit me', rating: 'restricted' }, internal_note: 'moderator only', assets: [{ file_id: fileId, kind: 'body', page_no: null, status: 'bound', mime_type: 'text/plain', size_bytes: 12 }] };
    const rpc = vi.fn().mockResolvedValue({ data: [{ items: [row], next_cursor: null }], error: null });
    const repository = createSubmissionsRepository({ rdb: { rpc } });
    const mine = await repository.listMine({ userId, sessionId, limit: 20, beforeAt: null, beforeId: null });
    expect(mine.items[0]).toMatchObject({ payload: { description: 'edit me', rating: 'restricted' }, assets: [{ fileId, kind: 'body' }] });
    expect(JSON.stringify(mine)).not.toContain('moderator only');
    const admin = await repository.listAdmin({ adminId: userId, adminSessionId: sessionId, status: null, limit: 20, beforeAt: null, beforeId: null });
    expect(admin.items[0]).toMatchObject({ userId, internalNote: 'moderator only', payload: { description: 'edit me' } });
  });

  it('registers session, admin, rate and domain-idempotency policies for every write', () => {
    const router = createRouter();
    registerSubmissionRoutes(router, new Proxy({}, { get: () => vi.fn() }));
    for (const [method, path] of [['POST', '/submissions'], ['PATCH', `/submissions/${submissionId}`], ['POST', `/submissions/${submissionId}/submit`], ['POST', `/submissions/${submissionId}/withdraw`], ['POST', `/submissions/${submissionId}/uploads/init`], ['POST', `/submissions/${submissionId}/uploads/${uploadId}/complete`]]) {
      expect(router.resolve(method, path).metadata).toMatchObject({ sessionRequired: true, rateLimit: expect.anything() });
    }
    expect(router.resolve('PATCH', `/admin/submissions/${submissionId}`).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' } });
    expect(router.resolve('GET', '/admin/submissions').metadata.role).toBe('admin');
    expect(router.resolve('GET', `/submissions/${submissionId}`).metadata).toMatchObject({ sessionRequired: true });
  });
});
