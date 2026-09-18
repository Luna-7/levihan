'use strict';

const { ApiError } = require('../errors');
const { serializeCookie, setSessionCookies } = require('../security');
const { domainHash, generateOpaqueToken, generateRecoveryCode } = require('../modules/auth/session');

const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;
const RECOVERY = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/;

function strictBody(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential request is invalid');
  return value;
}

function createLegacyUsersService({ repository, passwordHasher, pepper, enabled = true, now = () => new Date(), opaqueToken = generateOpaqueToken, recoveryCode = generateRecoveryCode } = {}) {
  return {
    async beginClaim(ctx) {
      if (!enabled) throw new ApiError(404, 'NOT_FOUND', 'Migration credential setup is unavailable');
      const body = strictBody(ctx.body, ['migrationCredential']);
      if (!OPAQUE.test(body.migrationCredential || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential request is invalid');
      if (!ctx.clientIp || !repository || typeof repository.beginClaim !== 'function') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Migration credential setup is unavailable');
      const claimToken = opaqueToken(); const csrfToken = opaqueToken();
      const result = await repository.beginClaim({
        credentialHash: domainHash(pepper, 'legacy-migration-credential', body.migrationCredential),
        claimSessionHash: domainHash(pepper, 'legacy-migration-claim', claimToken),
        ipHash: domainHash(pepper, 'ip', ctx.clientIp),
      });
      const shared = { secure: true, sameSite: 'Lax', path: '/', domain: ctx.config.sessionCookieDomain, maxAge: 600 };
      ctx.setCookie(serializeCookie(ctx.config.migrationCookieName || 'lv_migrate', claimToken, { ...shared, httpOnly: true }));
      ctx.setCookie(serializeCookie(ctx.config.csrfCookieName, csrfToken, shared));
      return { ready: true, expiresAt: result.expiresAt };
    },
    async setCredentials(ctx) {
      if (!enabled) throw new ApiError(404, 'NOT_FOUND', 'Migration credential setup is unavailable');
      const body = strictBody(ctx.body, ['newPassword','recoveryCode','prepareNonce']);
      if (typeof body.newPassword !== 'string' || body.newPassword.length < 12 || body.newPassword.length > 128) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential request is invalid');
      if (!RECOVERY.test(body.recoveryCode || '') || !OPAQUE.test(body.prepareNonce || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential preparation is invalid');
      const claimToken = ctx.cookies && ctx.cookies[ctx.config.migrationCookieName || 'lv_migrate'];
      if (!OPAQUE.test(claimToken || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Migration claim session is required');
      if (!ctx.clientIp) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Trusted client IP is unavailable');
      if (!repository || typeof repository.consumeCredential !== 'function' || !passwordHasher) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Migration credential setup is unavailable');
      const sessionToken = opaqueToken(); const csrfToken = opaqueToken();
      const expiresAt = new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await repository.consumeCredential({
        claimSessionHash: domainHash(pepper, 'legacy-migration-claim', claimToken),
        newPasswordHash: await passwordHasher.hash(body.newPassword),
        recoveryCodeHash: domainHash(pepper, 'recovery-code', body.recoveryCode),
        prepareNonceHash: domainHash(pepper, 'legacy-migration-prepare', body.prepareNonce),
        sessionTokenHash: domainHash(pepper, 'session', sessionToken), ipHash: domainHash(pepper, 'ip', ctx.clientIp), expiresAt,
      });
      setSessionCookies(ctx, sessionToken, csrfToken);
      ctx.setCookie(serializeCookie(ctx.config.migrationCookieName || 'lv_migrate', '', { secure: true, sameSite: 'Lax', path: '/', domain: ctx.config.sessionCookieDomain, httpOnly: true, maxAge: 0 }));
      return { userId: result.userId, installed: true };
    },
    async prepareCredentials(ctx) {
      if (!enabled) throw new ApiError(404, 'NOT_FOUND', 'Migration credential setup is unavailable');
      strictBody(ctx.body || {}, []);
      const claimToken = ctx.cookies && ctx.cookies[ctx.config.migrationCookieName || 'lv_migrate'];
      if (!OPAQUE.test(claimToken || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Migration claim session is required');
      if (!repository || typeof repository.prepareCredential !== 'function') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Migration credential setup is unavailable');
      const replacement = recoveryCode(); const prepareNonce = opaqueToken();
      const result = await repository.prepareCredential({ claimSessionHash: domainHash(pepper, 'legacy-migration-claim', claimToken), recoveryCodeHash: domainHash(pepper, 'recovery-code', replacement), prepareNonceHash: domainHash(pepper, 'legacy-migration-prepare', prepareNonce) });
      return { recoveryCode: replacement, prepareNonce, expiresAt: result.expiresAt };
    },
  };
}

function createLegacyUsersRepository({ rdb }) {
  return {
    async beginClaim(input) {
      const result = await rdb.rpc('begin_legacy_migration_claim', { p_credential_hash: input.credentialHash, p_claim_session_hash: input.claimSessionHash, p_ip_hash: input.ipHash });
      const row = result && !result.error && (Array.isArray(result.data) ? result.data[0] : result.data);
      if (!row || !row.expires_at) {
        if (result?.error && String(result.error.message).includes('migration_credential_invalid')) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential request is invalid');
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Migration credential setup is unavailable');
      }
      return { expiresAt: new Date(row.expires_at).toISOString() };
    },
    async consumeCredential(input) {
      const result = await rdb.rpc('consume_legacy_migration_credential', {
        p_claim_session_hash: input.claimSessionHash, p_new_password_hash: input.newPasswordHash,
        p_prepare_nonce_hash: input.prepareNonceHash,
        p_recovery_code_hash: input.recoveryCodeHash, p_session_token_hash: input.sessionTokenHash,
        p_session_expires_at: input.expiresAt, p_ip_hash: input.ipHash,
      });
      const row = result && !result.error && (Array.isArray(result.data) ? result.data[0] : result.data);
      if (!row || typeof row.user_id !== 'string' || typeof row.session_id !== 'string') {
        if (result?.error && String(result.error.message).includes('migration_credential_invalid')) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential request is invalid');
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Migration credential setup is unavailable');
      }
      return { userId: row.user_id, sessionId: row.session_id };
    },
    async prepareCredential(input) {
      const result = await rdb.rpc('prepare_legacy_migration_credential', { p_claim_session_hash: input.claimSessionHash, p_recovery_code_hash: input.recoveryCodeHash, p_prepare_nonce_hash: input.prepareNonceHash });
      const row = result && !result.error && (Array.isArray(result.data) ? result.data[0] : result.data);
      if (!row?.expires_at) throw new ApiError(400, 'VALIDATION_FAILED', 'Migration credential preparation is invalid');
      return { expiresAt: new Date(row.expires_at).toISOString() };
    },
  };
}

function registerLegacyUsersRoute(router, service) {
  router.post('/auth/legacy-credentials/session', (ctx) => service.beginClaim(ctx), {
    csrfExempt: true, idempotency: { mode: 'none' },
    rateLimit: [{ bucket: 'legacy-credential-ip', limit: 5, windowSeconds: 3600 }],
  });
  router.post('/auth/legacy-credentials', (ctx) => service.setCredentials(ctx), {
    idempotency: { mode: 'none' }, rateLimit: [{ bucket: 'legacy-credential-install-ip', limit: 5, windowSeconds: 3600 }],
  });
  router.post('/auth/legacy-credentials/prepare', (ctx) => service.prepareCredentials(ctx), {
    idempotency: { mode: 'none' }, rateLimit: [{ bucket: 'legacy-credential-prepare-ip', limit: 5, windowSeconds: 3600 }],
  });
}

module.exports = { createLegacyUsersService, createLegacyUsersRepository, registerLegacyUsersRoute };
