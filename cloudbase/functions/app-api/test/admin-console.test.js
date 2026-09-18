/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAdminConsoleService } = require('../src/modules/admin-console/service');
const { createAdminConsoleRepository } = require('../src/modules/admin-console/repository');
const { registerAdminConsoleRoutes } = require('../src/modules/admin-console/routes');
const { createRouter } = require('../src/router');

const adminId = '550e8400-e29b-41d4-a716-446655440001';
const sessionId = '550e8400-e29b-41d4-a716-446655440002';
const targetId = '550e8400-e29b-41d4-a716-446655440003';
const operation = 'admin-operation-0001';
const requestHash = 'a'.repeat(64);
const ctx = (overrides = {}) => ({ actorId: adminId, actorRole: 'admin', actorSessionId: sessionId, requestId: 'request-1', idempotencyKey: operation, idempotencyRequestHash: requestHash, params: {}, query: {}, body: {}, ...overrides });

describe('admin console policy boundary', () => {
  it('registers every route below /admin with an authenticated administrator policy', () => {
    const router = createRouter();
    registerAdminConsoleRoutes(router, new Proxy({}, { get: () => vi.fn() }));
    for (const path of ['/admin/dashboard', '/admin/moderation/comments', '/admin/moderation/reports', '/admin/users', '/admin/questions', '/admin/jobs', '/admin/audit']) {
      expect(router.resolve('GET', path).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
    }
    for (const [method, path] of [['POST', `/admin/users/${targetId}/status`], ['POST', '/admin/questions'], ['PATCH', `/admin/questions/${targetId}`], ['POST', `/admin/questions/${targetId}/status`], ['POST', `/admin/jobs/${targetId}/retry`]]) {
      expect(router.resolve(method, path).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' }, rateLimit: expect.anything() });
    }
  });

  it('passes the concrete session and domain idempotency material for mutations', async () => {
    const repository = { setUserStatus: vi.fn().mockResolvedValue({ id: targetId, username: 'member', role: 'member', status: 'suspended', version: 2 }) };
    const service = createAdminConsoleService({ repository });
    await service.setUserStatus(ctx({ params: { id: targetId }, body: { version: 1, status: 'suspended', reason: 'abuse' } }));
    expect(repository.setUserStatus).toHaveBeenCalledWith(expect.objectContaining({ adminId, adminSessionId: sessionId, targetId, expectedVersion: 1, idempotencyKey: operation, requestHash }));
  });

  it('uses stable compound cursors and positive projections without secrets', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ items: [{ id: targetId, username: 'member', role: 'member', status: 'active', version: 1, created_at: '2030-01-01T00:00:00Z', password_hash: 'secret' }], next_cursor: '2030-01-01T00:00:00Z|550e8400-e29b-41d4-a716-446655440003' }], error: null });
    const repository = createAdminConsoleRepository({ rdb: { rpc } });
    const result = await repository.listUsers({ adminId, adminSessionId: sessionId, status: null, search: null, limit: 20, beforeAt: null, beforeId: null });
    expect(rpc).toHaveBeenCalledWith('admin_list_users_v2', expect.objectContaining({ p_admin_session_id: sessionId }));
    expect(result.nextCursor).toContain('|');
    expect(JSON.stringify(result)).not.toMatch(/password|token|acceptedAnswerHashes|objectKey/i);
  });

  it('never returns accepted answer hashes or internal audit storage fields', async () => {
    const repository = {
      listQuestions: vi.fn().mockResolvedValue({ items: [{ id: targetId, prompt: '题目', options: ['A', 'B'], status: 'active', version: 2, samplingWeight: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' }], nextCursor: null }),
    };
    const result = await createAdminConsoleService({ repository }).listQuestions(ctx({ query: { limit: '20' } }));
    expect(JSON.stringify(result)).not.toContain('acceptedAnswer');
  });

  it('hashes replacement answers with the explicitly preserved normalization rule', async () => {
    const repository = { updateQuestion: vi.fn().mockResolvedValue({ id: targetId, version: 3 }) };
    const answerHasher = vi.fn((value) => `hash:${value}`);
    const service = createAdminConsoleService({ repository, answerHasher });
    await service.updateQuestion(ctx({ params: { id: targetId }, body: { version: 2, normalizationRule: 'trim_lowercase_collapse_whitespace', acceptedAnswers: ['  A   B  '] } }));
    expect(answerHasher).toHaveBeenCalledWith('a b');
    expect(repository.updateQuestion).toHaveBeenCalledWith(expect.objectContaining({ changes: expect.objectContaining({ acceptedAnswerHashes: ['hash:a b'], normalizationRule: 'trim_lowercase_collapse_whitespace' }) }));
  });
  it.each([
    { version: 2, prompt: '' },
    { version: 2, options: ['only-one'] },
    { version: 2, samplingWeight: 0 },
    { version: 2, acceptedAnswers: ['x'] },
  ])('rejects invalid question version input before PostgreSQL %#', async (body) => {
    const repository = { updateQuestion: vi.fn() }; const service = createAdminConsoleService({ repository });
    await expect(service.updateQuestion(ctx({ params: { id: targetId }, body }))).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    expect(repository.updateQuestion).not.toHaveBeenCalled();
  });
});
