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
    for (const path of ['/admin/dashboard', '/admin/moderation/comments', '/admin/moderation/reports', '/admin/users', '/admin/questions', '/admin/jobs', '/admin/audit', '/admin/settings', '/admin/health']) {
      expect(router.resolve('GET', path).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'none' } });
    }
    for (const [method, path] of [['POST', `/admin/users/${targetId}/status`], ['POST', `/admin/users/${targetId}/promote`], ['POST', '/admin/questions'], ['PATCH', `/admin/questions/${targetId}`], ['PATCH', '/admin/settings/announcement'], ['POST', `/admin/questions/${targetId}/status`], ['POST', `/admin/jobs/${targetId}/retry`]]) {
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

  it('reauthenticates the acting session with the acting administrator password before promotion', async () => {
    const repository = {
      getAdminCredential: vi.fn().mockResolvedValue({ passwordHash: 'argon-hash' }),
      markReauthenticated: vi.fn().mockResolvedValue(true),
      promoteUser: vi.fn().mockResolvedValue({ id: targetId, username: 'member', role: 'admin', status: 'active', version: 2 }),
    };
    const passwordHasher = { verify: vi.fn().mockResolvedValue(true) };
    const service = createAdminConsoleService({ repository, passwordHasher, authPepper: 'a'.repeat(32), opaqueToken: () => 'n'.repeat(43) });
    const password = ['actor','password','value'].join('-');
    const result = await service.promoteUser(ctx({ params: { id: targetId }, body: { version: 1, password } }));
    expect(passwordHasher.verify).toHaveBeenCalledWith('argon-hash', password);
    expect(repository.getAdminCredential).toHaveBeenCalledWith({ adminId, adminSessionId: sessionId });
    expect(repository.markReauthenticated).toHaveBeenCalledWith(expect.objectContaining({ adminId, adminSessionId: sessionId, nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(repository.promoteUser).toHaveBeenCalledWith(expect.objectContaining({ targetId, expectedVersion: 1, adminSessionId: sessionId, nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(result.user.role).toBe('admin');
  });

  it('maps a consumed concurrent reauthentication nonce to an explicit retryable authentication response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'reauthentication_required' } });
    const repository = createAdminConsoleRepository({ rdb: { rpc } });
    await expect(repository.promoteUser({ adminId, adminSessionId: sessionId, targetId, expectedVersion: 1, nonceHash: 'b'.repeat(64), idempotencyKey: operation, requestHash, requestId: 'request-1' }))
      .rejects.toMatchObject({ status: 401, errorCode: 'AUTH_REQUIRED' });
  });

  it('does not promote the wrong target when concurrent requests on one session race', async () => {
    let currentNonce = '';
    let marked = 0;
    let releaseMarks;
    const bothMarked = new Promise((resolve) => { releaseMarks = resolve; });
    const promoted = [];
    const repository = {
      getAdminCredential: vi.fn().mockResolvedValue({ passwordHash: 'argon-hash' }),
      markReauthenticated: vi.fn(async ({ nonceHash }) => { currentNonce = nonceHash; marked += 1; if (marked === 2) releaseMarks(); await bothMarked; return true; }),
      promoteUser: vi.fn(async ({ targetId: requestedTarget, nonceHash }) => {
        if (nonceHash !== currentNonce) throw Object.assign(new Error('Administrator reauthentication is required'), { status: 401, errorCode: 'AUTH_REQUIRED' });
        currentNonce = ''; promoted.push(requestedTarget);
        return { id: requestedTarget, username: 'member', role: 'admin', status: 'active', version: 2 };
      }),
    };
    let sequence = 0;
    const service = createAdminConsoleService({ repository, passwordHasher: { verify: vi.fn().mockResolvedValue(true) }, authPepper: 'a'.repeat(32), opaqueToken: () => `${++sequence}`.padEnd(43, 'n') });
    const secondTarget = '550e8400-e29b-41d4-a716-446655440004';
    const password = ['actor', 'password', 'value'].join('-');
    const first = service.promoteUser(ctx({ params: { id: targetId }, body: { version: 1, password } }));
    const second = service.promoteUser(ctx({ params: { id: secondTarget }, body: { version: 1, password }, idempotencyKey: 'admin-operation-0002' }));
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')[0]).toMatchObject({ reason: { status: 401, errorCode: 'AUTH_REQUIRED' } });
    expect(promoted).toHaveLength(1);
    expect([targetId, secondTarget]).toContain(promoted[0]);
  });

  it('validates setting shapes and returns combined DB/COS health without secret configuration', async () => {
    const repository = {
      updateSetting: vi.fn().mockResolvedValue({ key: 'announcement', value: { enabled: true, text: '维护中' }, version: 2 }),
      health: vi.fn().mockResolvedValue({ ok: true, databaseVersion: 'v2', snapshot: {}, migration: {}, jobs: {} }),
    };
    const objectStore = { health: vi.fn().mockResolvedValue({ ok: true, region: 'test-region', publicBucketConfigured: true, privateBucketConfigured: true }) };
    const service = createAdminConsoleService({ repository, objectStore });
    await expect(service.updateSetting(ctx({ params: { key: 'announcement' }, body: { version: 1, value: { enabled: true, text: '维护中' } } }))).resolves.toMatchObject({ setting: { version: 2 } });
    await expect(service.updateSetting(ctx({ params: { key: 'unknown' }, body: { version: 1, value: {} } }))).rejects.toMatchObject({ status: 400 });
    const health = await service.health(ctx());
    expect(health).toMatchObject({ database: { ok: true }, storage: { ok: true, publicBucketConfigured: true, privateBucketConfigured: true } });
    expect(JSON.stringify(health)).not.toMatch(/secret|token|bucketName/i);
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
