/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createLegacyUsersService, registerLegacyUsersRoute } = require('../src/compat/legacy-users');
const { createRouter } = require('../src/router');

const migrationProof = 'a'.repeat(43);

describe('one-time legacy credential setup', () => {
  it('exposes only the claim bootstrap as CSRF-exempt and protects password installation', () => {
    const router = createRouter(); registerLegacyUsersRoute(router, { beginClaim() {}, setCredentials() {} });
    expect(router.resolve('POST', '/auth/legacy-credentials/session').metadata).toMatchObject({ csrfExempt: true, idempotency: { mode: 'none' } });
    expect(router.resolve('POST', '/auth/legacy-credentials').metadata.csrfExempt).not.toBe(true);
    expect(router.resolve('POST', '/auth/legacy-credentials').metadata.rateLimit[0].bucket).toBe('legacy-credential-install-ip');
  });
  it('binds a valid migration credential to a short-lived browser claim session', async () => {
    const repository = { beginClaim: vi.fn().mockResolvedValue({ expiresAt: '2030-01-01T00:10:00.000Z' }) };
    const service = createLegacyUsersService({ repository, passwordHasher: {}, pepper: 'p'.repeat(32), opaqueToken: () => 'c'.repeat(43), now: () => new Date('2030-01-01T00:00:00.000Z') });
    const ctx = { body: { migrationCredential: migrationProof }, clientIp: '203.0.113.1', config: { migrationCookieName: 'lv_migrate', csrfCookieName: 'lv_csrf' }, setCookie: vi.fn() };
    await expect(service.beginClaim(ctx)).resolves.toEqual({ ready: true, expiresAt: '2030-01-01T00:10:00.000Z' });
    expect(repository.beginClaim).toHaveBeenCalledWith(expect.objectContaining({ credentialHash: expect.stringMatching(/^[a-f0-9]{64}$/), claimSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/), ipHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(ctx.setCookie.mock.calls.join('\n')).toMatch(/lv_migrate=.*HttpOnly.*Secure.*SameSite=Lax/);
  });

  it('atomically installs the already-saved recovery secret and returns no irreplaceable response secret', async () => {
    const repository = { consumeCredential: vi.fn().mockResolvedValue({ userId: '550e8400-e29b-41d4-a716-446655440001', sessionId: '550e8400-e29b-41d4-a716-446655440002' }) };
    const passwordHasher = { hash: vi.fn().mockResolvedValue('$argon2id$v=19$secure') };
    const service = createLegacyUsersService({ repository, passwordHasher, pepper: 'p'.repeat(32), opaqueToken: () => 'b'.repeat(43), recoveryCode: () => 'ABCD-EFGH-JKLM-NPQR', now: () => new Date('2030-01-01T00:00:00.000Z') });
    const ctx = { body: { newPassword: 'a secure password', recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'd'.repeat(43) }, clientIp: '203.0.113.1', cookies: { lv_migrate: 'c'.repeat(43) }, config: { sessionCookieName: 'lv_session', csrfCookieName: 'lv_csrf', migrationCookieName: 'lv_migrate' }, setCookie: vi.fn() };
    const result = await service.setCredentials(ctx);
    expect(result).toMatchObject({ userId: expect.any(String), installed: true });
    expect(result).not.toHaveProperty('recoveryCode');
    expect(repository.consumeCredential).toHaveBeenCalledWith(expect.objectContaining({ claimSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/), prepareNonceHash: expect.stringMatching(/^[a-f0-9]{64}$/), newPasswordHash: '$argon2id$v=19$secure', recoveryCodeHash: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: '2030-01-31T00:00:00.000Z' }));
  });

  it('returns the one-time recovery secret before consuming the account credential', async () => {
    const repository = { prepareCredential: vi.fn().mockResolvedValue({ expiresAt: '2030-01-01T00:10:00.000Z' }), consumeCredential: vi.fn() };
    const service = createLegacyUsersService({ repository, passwordHasher: {}, pepper: 'p'.repeat(32), opaqueToken: () => 'd'.repeat(43), recoveryCode: () => 'ABCD-EFGH-JKLM-NPQR' });
    const result = await service.prepareCredentials({ body: {}, cookies: { lv_migrate: 'c'.repeat(43) }, config: { migrationCookieName: 'lv_migrate' } });
    expect(result).toEqual({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'd'.repeat(43), expiresAt: '2030-01-01T00:10:00.000Z' });
    expect(repository.prepareCredential).toHaveBeenCalledWith(expect.objectContaining({ recoveryCodeHash: expect.stringMatching(/^[a-f0-9]{64}$/), prepareNonceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(repository.consumeCredential).not.toHaveBeenCalled();
  });

  it.each([
    [{ newPassword: 'short' }],
    [{ newPassword: 'a secure password', recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'd'.repeat(43), username: 'bypass' }],
  ])('rejects malformed or registration-like input', async (body) => {
    const service = createLegacyUsersService({ repository: {}, passwordHasher: { hash: vi.fn() }, pepper: 'p'.repeat(32) });
    await expect(service.setCredentials({ body, clientIp: '203.0.113.1', cookies: { lv_migrate: 'c'.repeat(43) }, config: { migrationCookieName: 'lv_migrate' } })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects credential installation without the bound migration session', async () => {
    const service = createLegacyUsersService({ repository: {}, passwordHasher: { hash: vi.fn() }, pepper: 'p'.repeat(32) });
    await expect(service.setCredentials({ body: { newPassword: 'a secure password', recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'd'.repeat(43) }, cookies: {}, config: { migrationCookieName: 'lv_migrate' }, clientIp: '203.0.113.1' })).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed when the compatibility feature is disabled', async () => {
    const service = createLegacyUsersService({ repository: {}, passwordHasher: { hash: vi.fn() }, pepper: 'p'.repeat(32), enabled: false });
    await expect(service.setCredentials({ body: { newPassword: 'a secure password' }, clientIp: '203.0.113.1' })).rejects.toMatchObject({ status: 404 });
  });
});
