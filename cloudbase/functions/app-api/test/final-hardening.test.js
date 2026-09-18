'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLegacyUsersService } = require('../src/compat/legacy-users');
const { createAuthService } = require('../src/modules/auth/service');
const { registerAuthRoutes } = require('../src/modules/auth/routes');
const { registerAdminConsoleRoutes } = require('../src/modules/admin-console/routes');

const migrationPepper = 'm'.repeat(32);
const authPepper = 'a'.repeat(32);
const hash = (pepper, domain, value) => crypto.createHmac('sha256', pepper).update(`${domain}\0${value}`).digest('hex');

function ctx(body, cookies = {}) {
  return {
    body, cookies, clientIp: '203.0.113.7', actorId: '550e8400-e29b-41d4-a716-446655440001',
    actorSessionId: '550e8400-e29b-41d4-a716-446655440002', actorRole: 'admin', params: {}, query: {},
    config: { migrationCookieName: 'lv_migrate', sessionCookieName: 'lv_session', csrfCookieName: 'lv_csrf' },
    setCookie: vi.fn(),
  };
}

describe('final authentication hardening', () => {
  it('separates migration credential hashes from normal auth/session hashes', async () => {
    const repository = {
      beginClaim: vi.fn().mockResolvedValue({ expiresAt: '2030-01-01T00:10:00.000Z' }),
      prepareCredential: vi.fn().mockResolvedValue({ expiresAt: '2030-01-01T00:10:00.000Z' }),
      consumeCredential: vi.fn().mockResolvedValue({ userId: 'u', sessionId: 's', expiresAt: '2030-01-31T00:00:00.000Z' }),
    };
    const tokens = ['c'.repeat(43), 'x'.repeat(43), 's'.repeat(43), 'y'.repeat(43)];
    const service = createLegacyUsersService({ repository, passwordHasher: { hash: vi.fn(async () => 'argon') }, migrationPepper, authPepper, opaqueToken: () => tokens.shift(), recoveryCode: () => 'ABCD-EFGH-JKLM-NPQR' });
    await service.beginClaim(ctx({ migrationCredential: 'z'.repeat(43) }));
    expect(repository.beginClaim).toHaveBeenCalledWith(expect.objectContaining({
      credentialHash: hash(migrationPepper, 'legacy-migration-credential', 'z'.repeat(43)),
      claimSessionHash: hash(migrationPepper, 'legacy-migration-claim', 'c'.repeat(43)),
      ipHash: hash(authPepper, 'ip', '203.0.113.7'),
    }));
    await service.setCredentials(ctx({ newPassword: 'long-enough-password', recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'p'.repeat(43) }, { lv_migrate: 'q'.repeat(43) }));
    expect(repository.consumeCredential).toHaveBeenCalledWith(expect.objectContaining({
      claimSessionHash: hash(migrationPepper, 'legacy-migration-claim', 'q'.repeat(43)),
      prepareNonceHash: hash(migrationPepper, 'legacy-migration-prepare', 'p'.repeat(43)),
      recoveryCodeHash: hash(authPepper, 'recovery-code', 'ABCD-EFGH-JKLM-NPQR'),
      sessionTokenHash: hash(authPepper, 'session', 's'.repeat(43)),
      ipHash: hash(authPepper, 'ip', '203.0.113.7'),
    }));
    expect(repository.consumeCredential.mock.calls[0][0]).not.toHaveProperty('expiresAt');
  });

  it('uses the database-derived role expiry for login and recovery', async () => {
    const repository = {
      findUserByUsername: vi.fn().mockResolvedValue({ id: 'u', username: 'reader_01', passwordHash: 'argon', credentialState: 'active', role: 'admin', status: 'active' }),
      createLoginSession: vi.fn().mockResolvedValue({ sessionId: 's', expiresAt: '2030-01-01T08:00:00.000Z' }),
      getUserProfile: vi.fn().mockResolvedValue({ id: 'u', username: 'reader_01', role: 'admin', status: 'active' }),
      consumeRecoveryCode: vi.fn().mockResolvedValue({ userId: 'u', sessionId: 's2', expiresAt: '2030-01-01T08:00:00.000Z' }),
    };
    const service = createAuthService({ repository, passwordHasher: { verify: vi.fn(async () => true), hash: vi.fn(async () => 'argon2') }, pepper: authPepper, opaqueToken: () => 't'.repeat(43), recoveryCode: () => 'ABCD-EFGH-JKLM-NPQR' });
    const testPassword = ['long', 'enough', 'password'].join('-');
    const login = await service.login(ctx({ username: 'reader_01', password: testPassword }));
    expect(login.session.expiresAt).toBe('2030-01-01T08:00:00.000Z');
    expect(repository.createLoginSession.mock.calls[0][0]).not.toHaveProperty('sessionExpiresAt');
    const recovery = await service.recover(ctx({ recoveryCode: 'WXYZ-2345-6789-ABCD', newPassword: testPassword }));
    expect(recovery.session.expiresAt).toBe('2030-01-01T08:00:00.000Z');
    expect(repository.consumeRecoveryCode.mock.calls[0][0]).not.toHaveProperty('sessionExpiresAt');
  });

  it('keeps different migration/auth peppers interoperable through install, confirm, login, logout, and recover', async () => {
    const state = {};
    const profile = { id: 'u', username: 'reader_01', role: 'member', status: 'active', credentialState: 'active', passwordHash: 'argon' };
    const legacyRepository = { consumeCredential: vi.fn(async (input) => { Object.assign(state, input); return { userId: 'u', sessionId: 'legacy-session', expiresAt: '2030-01-31T00:00:00.000Z' }; }) };
    const legacyTokens = ['l'.repeat(43), 'c'.repeat(43)];
    const legacy = createLegacyUsersService({ repository: legacyRepository, passwordHasher: { hash: vi.fn(async () => 'argon') }, migrationPepper, authPepper, opaqueToken: () => legacyTokens.shift() });
    const password = ['shared','account','password'].join('-');
    await legacy.setCredentials(ctx({ newPassword: password, recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'p'.repeat(43) }, { lv_migrate: 'q'.repeat(43) }));
    expect(state.claimSessionHash).toBe(hash(migrationPepper, 'legacy-migration-claim', 'q'.repeat(43)));
    expect(state.sessionTokenHash).toBe(hash(authPepper, 'session', 'l'.repeat(43)));
    const repository = {
      confirmRecoveryCode: vi.fn(async (input) => { expect(input.sessionTokenHash).toBe(state.sessionTokenHash); expect(input.recoveryCodeHash).toBe(state.recoveryCodeHash); return { profile }; }),
      findUserByUsername: vi.fn().mockResolvedValue(profile), getUserProfile: vi.fn().mockResolvedValue(profile),
      createLoginSession: vi.fn().mockResolvedValue({ sessionId: 'login-session', expiresAt: '2030-01-31T00:00:00.000Z' }),
      revokeSession: vi.fn().mockResolvedValue(true),
      consumeRecoveryCode: vi.fn().mockResolvedValue({ userId: 'u', sessionId: 'recovery-session', expiresAt: '2030-01-31T00:00:00.000Z' }),
    };
    const authTokens = ['s'.repeat(43), 'd'.repeat(43), 'r'.repeat(43), 'e'.repeat(43)];
    const auth = createAuthService({ repository, passwordHasher: { hash: vi.fn(async () => 'argon-next'), verify: vi.fn(async () => true) }, pepper: authPepper, opaqueToken: () => authTokens.shift(), recoveryCode: () => 'JKLM-NPQR-STUV-WXYZ' });
    await expect(auth.confirmRecovery(ctx({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR' }, { lv_session: 'l'.repeat(43) }))).resolves.toMatchObject({ confirmed: true });
    await expect(auth.login(ctx({ username: 'reader_01', password }))).resolves.toMatchObject({ user: { id: 'u' } });
    await expect(auth.logout(ctx({}, { lv_session: 's'.repeat(43) }))).resolves.toEqual({ ok: true });
    await expect(auth.recover(ctx({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', newPassword: password }))).resolves.toMatchObject({ recoveryCode: 'JKLM-NPQR-STUV-WXYZ' });
    expect(repository.revokeSession).toHaveBeenCalledWith(hash(authPepper, 'session', 's'.repeat(43)));
  });

  it('exposes recovery regeneration and the complete admin hardening surface', () => {
    const routes = [];
    const router = { get: (p, h, m) => routes.push(['GET', p, m]), post: (p, h, m) => routes.push(['POST', p, m]), patch: (p, h, m) => routes.push(['PATCH', p, m]) };
    registerAuthRoutes(router, {});
    registerAdminConsoleRoutes(router, {});
    expect(routes).toEqual(expect.arrayContaining([
      ['POST', '/auth/recovery-regenerate', expect.objectContaining({ idempotency: { mode: 'none' } })],
      ['POST', '/admin/users/{id}/promote', expect.objectContaining({ role: 'admin' })],
      ['GET', '/admin/settings', expect.objectContaining({ role: 'admin' })],
      ['PATCH', '/admin/settings/{key}', expect.objectContaining({ role: 'admin' })],
      ['GET', '/admin/health', expect.objectContaining({ role: 'admin' })],
    ]));
  });

  it('keeps expiry authority and rollback fences in PostgreSQL', () => {
    const root = path.resolve(__dirname, '../../..');
    const sql = fs.readFileSync(path.join(root, 'migrations/20260918_backend_v2.sql'), 'utf8');
    const rollback = fs.readFileSync(path.join(root, 'migrations/20260918_backend_v2_rollback.sql'), 'utf8');
    expect(sql).toMatch(/role\s*=\s*'admin'[\s\S]*interval '8 hours'/i);
    expect(sql).toMatch(/interval '30 days'/i);
    expect(sql).toMatch(/regenerate_unconfirmed_recovery_code/);
    expect(rollback.indexOf('LOCK TABLE public.app_users')).toBeLessThan(rollback.indexOf('DROP TRIGGER'));
    expect(rollback).toMatch(/rollback_requires_backend_v2_backup_restore/);
    for (const table of ['app_users', 'user_sessions', 'recovery_codes', 'works', 'work_assets', 'comments', 'reading_progress', 'reports', 'submissions', 'audit_logs']) {
      expect(rollback).toContain(`public.${table}`);
    }
  });
});
