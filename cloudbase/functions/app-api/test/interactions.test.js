/* eslint-env node */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createInteractionsService } = require('../src/modules/interactions/service');
const { createInteractionsRepository } = require('../src/modules/interactions/repository');
const { registerInteractionRoutes } = require('../src/modules/interactions/routes');
const { createRouter } = require('../src/router');

const userId = '550e8400-e29b-41d4-a716-446655440001';
const workId = '550e8400-e29b-41d4-a716-446655440002';
const sessionId = '550e8400-e29b-41d4-a716-446655440003';
const itemId = '550e8400-e29b-41d4-a716-446655440004';
const now = '2030-01-01T00:00:00.000Z';
const ctx = (overrides = {}) => ({ actorId: userId, actorRole: 'member', actorSessionId: sessionId, requestId: 'req-1', idempotencyKey: 'mutation-0001', body: {}, query: {}, params: { id: workId }, ...overrides });

describe('interaction service', () => {
  it.each([['like', true], ['like', false], ['favorite', true], ['favorite', false]])('sets %s=%s idempotently without a toggle', async (type, active) => {
    const repository = { setReaction: vi.fn().mockResolvedValue({ active, count: active ? 3 : 2 }) };
    const service = createInteractionsService({ repository });
    await expect(service.setReaction(ctx(), type, active)).resolves.toEqual({ active, count: active ? 3 : 2 });
    expect(repository.setReaction).toHaveBeenCalledWith({ userId, sessionId, workRef: workId, type, active });
  });

  it('lists only repository-approved published comments with a bounded cursor', async () => {
    const repository = { listComments: vi.fn().mockResolvedValue({ items: [{ id: itemId, authorName: 'member', body: 'hello', createdAt: now }], nextCursor: null, count: 1 }) };
    const service = createInteractionsService({ repository });
    await expect(service.listComments(ctx({ actorId: undefined, actorSessionId: undefined, query: { limit: '20' } }))).resolves.toMatchObject({ count: 1, nextCursor: null });
    expect(repository.listComments).toHaveBeenCalledWith({ userId: undefined, sessionId: undefined, workRef: workId, limit: 20, beforeAt: undefined, beforeId: undefined });
    await expect(service.listComments(ctx({ query: { cursor: `${now}|${itemId}` } }))).resolves.toMatchObject({ count: 1 });
    expect(repository.listComments).toHaveBeenLastCalledWith(expect.objectContaining({ beforeAt: now, beforeId: itemId }));
  });

  it('normalizes comment whitespace and returns pending without echoing moderation details', async () => {
    const repository = { createComment: vi.fn().mockResolvedValue({ id: itemId, status: 'pending', createdAt: now }) };
    const service = createInteractionsService({ repository });
    await expect(service.createComment(ctx({ body: { body: '  hello\n   world  ' } }))).resolves.toEqual({ id: itemId, status: 'pending', createdAt: now });
    expect(repository.createComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello world', userId, sessionId, workRef: workId, requestId: 'req-1' }));
  });

  it.each(['', ' '.repeat(3), 'x'.repeat(501), '<script>alert(1)</script>\u0000'])('rejects invalid comment body %j', async (body) => {
    const repository = { createComment: vi.fn() };
    const service = createInteractionsService({ repository });
    await expect(service.createComment(ctx({ body: { body } }))).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it('soft deletes an owned comment and supports audited admin hide/restore', async () => {
    const repository = {
      deleteComment: vi.fn().mockResolvedValue({ id: itemId, status: 'deleted' }),
      moderateComment: vi.fn().mockResolvedValue({ id: itemId, status: 'hidden' }),
    };
    const service = createInteractionsService({ repository });
    await expect(service.deleteComment(ctx({ params: { id: itemId } }))).resolves.toEqual({ id: itemId, status: 'deleted' });
    await expect(service.moderateComment(ctx({ actorRole: 'admin', params: { id: itemId }, body: { reason: 'policy violation' } }), 'hide')).resolves.toEqual({ id: itemId, status: 'hidden' });
    expect(repository.moderateComment).toHaveBeenCalledWith({ adminId: userId, sessionId, commentId: itemId, action: 'hide', reason: 'policy violation', requestId: 'req-1' });
  });

  it('validates comic and novel progress positions and passes a stable mutation/version tuple', async () => {
    const repository = { putProgress: vi.fn().mockResolvedValue({ accepted: true, position: { kind: 'comic', page: 12 }, percent: 40, logicVersion: 2, clientVersion: 9, mutationId: itemId, version: 4, updatedAt: now }) };
    const service = createInteractionsService({ repository });
    const body = { position: { kind: 'comic', page: 12 }, percent: 40, logicVersion: 2, clientVersion: 9, baseVersion: 3, mutationId: itemId };
    await expect(service.putProgress(ctx({ body, idempotencyKey: itemId }))).resolves.toMatchObject({ accepted: true, version: 4 });
    expect(repository.putProgress).toHaveBeenCalledWith({ userId, sessionId, workRef: workId, ...body });
    await expect(service.putProgress(ctx({ body: { ...body, baseVersion: -1 }, idempotencyKey: itemId }))).rejects.toMatchObject({ status: 400 });
    await expect(service.putProgress(ctx({ body: { ...body, position: { kind: 'novel', chapter: 1, offset: -1 } }, idempotencyKey: itemId }))).rejects.toMatchObject({ status: 400 });
    await expect(service.putProgress(ctx({ body, idempotencyKey: 'different-mutation' }))).rejects.toMatchObject({ status: 400 });
  });

  it('creates deduplicated reports and validates target/reason/note allowlists', async () => {
    const repository = { createReport: vi.fn().mockResolvedValue({ id: itemId, status: 'pending', duplicate: true }) };
    const service = createInteractionsService({ repository });
    await expect(service.createReport(ctx({ body: { targetType: 'comment', targetId: itemId, reason: 'spam', note: ' repeated links ' } }))).resolves.toEqual({ id: itemId, status: 'pending', duplicate: true });
    expect(repository.createReport).toHaveBeenCalledWith({ reporterId: userId, sessionId, targetType: 'comment', targetId: itemId, reason: 'spam', note: 'repeated links', requestId: 'req-1' });
    await expect(service.createReport(ctx({ body: { targetType: 'hidden', targetId: itemId, reason: 'anything' } }))).rejects.toMatchObject({ status: 400 });
  });

  it('allows active admins to transition reports with a reason', async () => {
    const repository = { moderateReport: vi.fn().mockResolvedValue({ id: itemId, status: 'resolved' }) };
    const service = createInteractionsService({ repository });
    await expect(service.moderateReport(ctx({ actorRole: 'admin', params: { id: itemId }, body: { status: 'resolved', reason: 'reviewed evidence' } }))).resolves.toEqual({ id: itemId, status: 'resolved' });
    expect(repository.moderateReport).toHaveBeenCalledWith({ adminId: userId, sessionId, reportId: itemId, status: 'resolved', reason: 'reviewed evidence', requestId: 'req-1' });
  });
});

describe('interaction repository and routes', () => {
  it('maps controlled RPCs without direct table access and hides database errors', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ active: true, reaction_count: 2 }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'age_consent_required internal' } });
    const repository = createInteractionsRepository({ rdb: { rpc } });
    await expect(repository.setReaction({ userId, sessionId, workRef: workId, type: 'like', active: true })).resolves.toEqual({ active: true, count: 2 });
    expect(rpc).toHaveBeenCalledWith('set_work_reaction_v2', { p_user_id: userId, p_session_id: sessionId, p_work_ref: workId, p_reaction_type: 'like', p_active: true });
    await expect(repository.listComments({ workRef: workId, limit: 20 })).rejects.toMatchObject({ status: 403, errorCode: 'AGE_CONSENT_REQUIRED' });
  });

  it('registers CSRF-protected session/admin writes, domain progress idempotency and safe replay policies', () => {
    const router = createRouter();
    registerInteractionRoutes(router, new Proxy({}, { get: () => vi.fn() }));
    expect(router.resolve('PUT', `/works/${workId}/like`).metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'none' } });
    expect(router.resolve('POST', `/works/${workId}/comments`).metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'required' }, rateLimit: [{ bucket: 'comment-ip', limit: 10, windowSeconds: 60 }] });
    expect(router.resolve('PUT', `/works/${workId}/progress`).metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'domain' } });
    expect(router.resolve('POST', `/admin/comments/${itemId}/hide`).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required' } });
    expect(router.resolve('POST', `/admin/reports/${itemId}`).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required' } });
  });

  it('registers the interaction module in the deployed modular runtime', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    expect(source).toMatch(/registerInteractionRoutes\(api\.router,[\s\S]*createInteractionsService[\s\S]*createInteractionsRepository/);
  });
});
