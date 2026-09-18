/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { decideAccess } = require('../src/modules/access/policy');
const { createAccessService } = require('../src/modules/access/service');
const { createAccessRepository } = require('../src/modules/access/repository');
const { registerAccessRoutes } = require('../src/modules/access/routes');
const { createRouter } = require('../src/router');

const userId = '550e8400-e29b-41d4-a716-446655440001';
const workId = '550e8400-e29b-41d4-a716-446655440002';
const sessionId = '550e8400-e29b-41d4-a716-446655440005';

describe('table-driven content access policy', () => {
  it('covers every actor/status/work/rating/consent combination without exposing unpublished metadata', () => {
    const actors = [null, { role: 'member', status: 'active' }, { role: 'member', status: 'suspended' }, { role: 'admin', status: 'active' }, { role: 'admin', status: 'suspended' }];
    const workStates = ['draft', 'review', 'published', 'archived', 'deleted'];
    const ratings = ['general', 'mature', 'restricted'];
    const consents = ['current', 'missing', 'revoked', 'stale'];
    let cases = 0;
    for (const actor of actors) for (const workStatus of workStates) for (const rating of ratings) for (const consent of consents) {
      cases += 1;
      const actual = decideAccess({ actor, workStatus, rating, consent });
      let expected;
      if (!actor) expected = workStatus === 'published' ? { allowed: false, safeMetadataOnly: rating === 'restricted', errorCode: 'AUTH_REQUIRED' } : { allowed: false, safeMetadataOnly: false, errorCode: 'NOT_FOUND' };
      else if (actor.status !== 'active') expected = { allowed: false, safeMetadataOnly: rating === 'restricted' && workStatus === 'published', errorCode: 'ACCESS_DENIED' };
      else if (workStatus === 'deleted' || (actor.role !== 'admin' && workStatus !== 'published')) expected = { allowed: false, safeMetadataOnly: rating === 'restricted' && workStatus === 'published', errorCode: 'NOT_FOUND' };
      else if (actor.role === 'admin') expected = { allowed: true, safeMetadataOnly: false, errorCode: null };
      else if (rating === 'restricted' && consent !== 'current') expected = { allowed: false, safeMetadataOnly: true, errorCode: 'AGE_CONSENT_REQUIRED' };
      else expected = { allowed: true, safeMetadataOnly: false, errorCode: null };
      expect(actual, JSON.stringify({ actor, workStatus, rating, consent })).toEqual(expected);
    }
    expect(cases).toBe(300);
  });
  it.each([
    ['anonymous restricted metadata only', { actor: null, workStatus: 'published', rating: 'restricted', consent: 'missing' }, false, true, 'AUTH_REQUIRED'],
    ['active member current consent', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'restricted', consent: 'current' }, true, false, null],
    ['active member missing consent', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'restricted', consent: 'missing' }, false, true, 'AGE_CONSENT_REQUIRED'],
    ['active member revoked consent', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'restricted', consent: 'revoked' }, false, true, 'AGE_CONSENT_REQUIRED'],
    ['active member stale consent', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'restricted', consent: 'stale' }, false, true, 'AGE_CONSENT_REQUIRED'],
    ['suspended member', { actor: { role: 'member', status: 'suspended' }, workStatus: 'published', rating: 'restricted', consent: 'current' }, false, true, 'ACCESS_DENIED'],
    ['member draft', { actor: { role: 'member', status: 'active' }, workStatus: 'draft', rating: 'general', consent: 'current' }, false, false, 'NOT_FOUND'],
    ['member review', { actor: { role: 'member', status: 'active' }, workStatus: 'review', rating: 'mature', consent: 'current' }, false, false, 'NOT_FOUND'],
    ['member archived', { actor: { role: 'member', status: 'active' }, workStatus: 'archived', rating: 'restricted', consent: 'current' }, false, false, 'NOT_FOUND'],
    ['admin previews draft', { actor: { role: 'admin', status: 'active' }, workStatus: 'draft', rating: 'restricted', consent: 'missing' }, true, false, null],
    ['admin previews review', { actor: { role: 'admin', status: 'active' }, workStatus: 'review', rating: 'restricted', consent: 'revoked' }, true, false, null],
    ['admin previews archived', { actor: { role: 'admin', status: 'active' }, workStatus: 'archived', rating: 'restricted', consent: 'stale' }, true, false, null],
    ['admin cannot preview deleted', { actor: { role: 'admin', status: 'active' }, workStatus: 'deleted', rating: 'restricted', consent: 'current' }, false, false, 'NOT_FOUND'],
    ['suspended admin', { actor: { role: 'admin', status: 'suspended' }, workStatus: 'published', rating: 'general', consent: 'current' }, false, false, 'ACCESS_DENIED'],
    ['member general published', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'general', consent: 'missing' }, true, false, null],
    ['member mature published', { actor: { role: 'member', status: 'active' }, workStatus: 'published', rating: 'mature', consent: 'missing' }, true, false, null],
  ])('%s', (_name, input, allowed, safeMetadataOnly, errorCode) => {
    expect(decideAccess(input)).toEqual({ allowed, safeMetadataOnly, errorCode });
  });
});

describe('age consent and signed access service', () => {
  const ctx = (overrides = {}) => ({ actorId: userId, actorRole: 'member', actorSessionId: sessionId, requestId: 'req-1', body: {}, params: {}, ...overrides });

  it('serves the current warning without collecting identity attributes', async () => {
    const repository = { getAgePolicy: vi.fn().mockResolvedValue({ version: '2026-09', warning: '成人内容警告' }) };
    const service = createAccessService({ repository, objectStore: {} });
    await expect(service.getAgePolicy()).resolves.toEqual({ policyVersion: '2026-09', warning: '成人内容警告', assurance: 'self_declaration_only' });
  });

  it('accepts only the server current self-declaration version using server time', async () => {
    const repository = { getAgePolicy: vi.fn().mockResolvedValue({ version: '2026-09', warning: '成人内容警告' }), setAgeConsent: vi.fn().mockResolvedValue({ acceptedAt: '2030-01-01T00:00:00.000Z' }) };
    const service = createAccessService({ repository, objectStore: {} });
    await expect(service.acceptAgeConsent(ctx({ body: { isAdult: true, policyVersion: 'old' } }))).rejects.toMatchObject({ status: 409, errorCode: 'STATE_CONFLICT' });
    expect(repository.setAgeConsent).not.toHaveBeenCalled();
    await expect(service.acceptAgeConsent(ctx({ body: { isAdult: true, policyVersion: '2026-09', birthDate: '2000-01-01' } }))).rejects.toMatchObject({ status: 400 });
    await expect(service.acceptAgeConsent(ctx({ body: { isAdult: true, policyVersion: '2026-09' } }))).resolves.toEqual({ policyVersion: '2026-09', acceptedAt: '2030-01-01T00:00:00.000Z' });
    expect(repository.setAgeConsent).toHaveBeenCalledWith({ userId, policyVersion: '2026-09', requestId: 'req-1' });
  });

  it('revokes consent with an audit write', async () => {
    const repository = { revokeAgeConsent: vi.fn().mockResolvedValue({ revoked: true }) };
    const service = createAccessService({ repository, objectStore: {} });
    await expect(service.revokeAgeConsent(ctx())).resolves.toEqual({ revoked: true });
    expect(repository.revokeAgeConsent).toHaveBeenCalledWith({ userId, requestId: 'req-1' });
  });

  it('uses one authorization snapshot and signs only returned private protected objects for five minutes', async () => {
    const authorizationId = '550e8400-e29b-41d4-a716-446655440004';
    const repository = { authorizeWorkAccess: vi.fn().mockResolvedValue({
      authorizationId,
      decision: { allowed: true }, work: { id: workId, type: 'comic', title: 'Restricted', rating: 'restricted' },
      assets: [{ id: '550e8400-e29b-41d4-a716-446655440003', kind: 'page', objectKey: `protected/works/${workId}/p1.webp`, mimeType: 'image/webp', pageNo: 1, chapterPosition: 1 }],
    }), finalizeWorkAccess: vi.fn().mockResolvedValue({ allowed: true }) };
    const objectStore = { signGet: vi.fn().mockResolvedValue({ url: 'https://private.cos.ap-test.myqcloud.com/protected/x?sign=redacted', expiresAt: '2030-01-01T00:05:00.000Z' }) };
    const service = createAccessService({ repository, objectStore });
    const result = await service.getWorkAccess(ctx({ params: { id: workId } }));
    expect(repository.authorizeWorkAccess).toHaveBeenCalledWith({ userId, sessionId, workId });
    expect(objectStore.signGet).toHaveBeenCalledWith({ objectKey: `protected/works/${workId}/p1.webp`, expiresInSeconds: 300 });
    expect(repository.finalizeWorkAccess).toHaveBeenCalledWith({ authorizationId, userId, sessionId, workId });
    expect(result.body.assets[0]).toEqual({ id: '550e8400-e29b-41d4-a716-446655440003', kind: 'page', mimeType: 'image/webp', pageNo: 1, chapterPosition: 1, url: 'https://private.cos.ap-test.myqcloud.com/protected/x?sign=redacted', expiresAt: '2030-01-01T00:05:00.000Z' });
    expect(JSON.stringify(result.body)).not.toContain('objectKey');
    expect(result.headers).toMatchObject({ 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', 'referrer-policy': 'no-referrer' });
  });

  it('discards pre-signed URLs when consent or publication is revoked before final issuance', async () => {
    const repository = {
      authorizeWorkAccess: vi.fn().mockResolvedValue({ authorizationId: userId, decision: { allowed: true }, work: { id: workId }, assets: [{ id: userId, kind: 'body', objectKey: `protected/works/${workId}/body.txt`, mimeType: 'text/plain' }] }),
      finalizeWorkAccess: vi.fn().mockResolvedValue({ allowed: false, errorCode: 'AGE_CONSENT_REQUIRED' }),
    };
    const objectStore = { signGet: vi.fn().mockResolvedValue({ url: 'https://private.cos.test/protected?signature=secret', expiresAt: '2030-01-01T00:05:00.000Z' }) };
    const service = createAccessService({ repository, objectStore });
    await expect(service.getWorkAccess(ctx({ params: { id: workId } }))).rejects.toMatchObject({ status: 403, errorCode: 'AGE_CONSENT_REQUIRED' });
  });

  it.each(['SESSION_EXPIRED', 'ASSET_SET_CHANGED'])('discards signed URLs when final session/asset validation returns %s', async (errorCode) => {
    const repository = {
      authorizeWorkAccess: vi.fn().mockResolvedValue({ authorizationId: userId, decision: { allowed: true }, work: { id: workId }, assets: [{ id: userId, kind: 'body', objectKey: `protected/works/${workId}/body.txt`, mimeType: 'text/plain' }] }),
      finalizeWorkAccess: vi.fn().mockResolvedValue({ allowed: false, errorCode }),
    };
    const service = createAccessService({ repository, objectStore: { signGet: vi.fn().mockResolvedValue({ url: 'https://private.test/signed', expiresAt: '2030-01-01T00:05:00Z' }) } });
    await expect(service.getWorkAccess(ctx({ params: { id: workId } }))).rejects.toMatchObject({ status: errorCode === 'SESSION_EXPIRED' ? 401 : 409, errorCode });
  });

  it.each([['revoke', 'blocked'], ['restore', 'allowed']])('lets active admins %s persistent restricted access', async (action, status) => {
    const repository = { setRestrictedAccess: vi.fn().mockResolvedValue({ id: userId, status }) };
    const service = createAccessService({ repository, objectStore: {} });
    await expect(service.setRestrictedAccess(ctx({ actorRole: 'admin', params: { id: userId }, body: { reason: 'moderation decision' } }), action)).resolves.toEqual({ id: userId, status });
    expect(repository.setRestrictedAccess).toHaveBeenCalledWith({ adminId: userId, userId, action, reason: 'moderation decision', requestId: 'req-1' });
  });

  it.each([
    [{ allowed: false, errorCode: 'AGE_CONSENT_REQUIRED' }, 403],
    [{ allowed: false, errorCode: 'ACCESS_DENIED' }, 403],
    [{ allowed: false, errorCode: 'NOT_FOUND' }, 404],
  ])('refuses signing when the database snapshot denies access', async (decision, status) => {
    const objectStore = { signGet: vi.fn() };
    const service = createAccessService({ repository: { authorizeWorkAccess: vi.fn().mockResolvedValue({ decision, assets: [] }) }, objectStore });
    await expect(service.getWorkAccess(ctx({ params: { id: workId } }))).rejects.toMatchObject({ status, errorCode: decision.errorCode });
    expect(objectStore.signGet).not.toHaveBeenCalled();
  });
});

describe('access routes and repository boundary', () => {
  it('requires session and CSRF while keeping signed access non-replayable', () => {
    const router = createRouter();
    registerAccessRoutes(router, new Proxy({}, { get: () => vi.fn() }));
    expect(router.resolve('GET', '/content/access-policy').metadata.sessionRequired).not.toBe(true);
    expect(router.resolve('PUT', '/me/age-consent').metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'none' } });
    expect(router.resolve('DELETE', '/me/age-consent').metadata).toMatchObject({ sessionRequired: true });
    expect(router.resolve('POST', `/works/${workId}/access`).metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'none' } });
    expect(router.resolve('POST', `/admin/users/${userId}/restricted-access/revoke`).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required' } });
    expect(router.resolve('POST', `/admin/users/${userId}/restricted-access/restore`).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'required' } });
  });

  it('maps atomic authorization RPC output without client-supplied keys', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: true, work_id: workId, work_type: 'comic', title: 'X', rating: 'restricted', assets: [{ id: userId, kind: 'body', object_key: `protected/works/${workId}/body.txt`, mime_type: 'text/plain' }] }], error: null });
    const repository = createAccessRepository({ rdb: { rpc } });
    const result = await repository.authorizeWorkAccess({ userId, sessionId, workId });
    expect(rpc).toHaveBeenCalledWith('authorize_work_access', { p_user_id: userId, p_session_id: sessionId, p_work_id: workId });
    expect(result.assets[0].objectKey).toMatch(/^protected\/works\//);
  });

  it('binds finalization to the same concrete session and never maps it into output', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, error_code: 'SESSION_EXPIRED' }], error: null });
    const repository = createAccessRepository({ rdb: { rpc } });
    await expect(repository.finalizeWorkAccess({ authorizationId: userId, userId, sessionId, workId })).resolves.toEqual({ allowed: false, errorCode: 'SESSION_EXPIRED' });
    expect(rpc).toHaveBeenCalledWith('finalize_work_access', { p_authorization_id: userId, p_user_id: userId, p_session_id: sessionId, p_work_id: workId });
    expect(JSON.stringify(await repository.finalizeWorkAccess({ authorizationId: userId, userId, sessionId, workId }))).not.toContain(sessionId);
  });

  it('maps a concurrent policy rotation to a retryable state conflict', async () => {
    const repository = createAccessRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'policy_stale' } }) } });
    await expect(repository.setAgeConsent({ userId, policyVersion: 'old', requestId: 'req' })).rejects.toMatchObject({ status: 409, errorCode: 'STATE_CONFLICT' });
  });

  it.each([
    ['not_found', 404, 'NOT_FOUND'],
    ['invalid_access_control', 400, 'VALIDATION_FAILED'],
  ])('maps admin restriction storage error %s safely', async (message, status, errorCode) => {
    const repository = createAccessRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) } });
    await expect(repository.setRestrictedAccess({ adminId: userId, userId: workId, action: 'revoke', reason: 'policy', requestId: 'req' }))
      .rejects.toMatchObject({ status, errorCode });
  });
});
