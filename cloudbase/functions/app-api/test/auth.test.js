/* eslint-env node */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createRuntime } = require('../index');
const { createAuthService } = require('../src/modules/auth/service');
const { createAuthRepository } = require('../src/modules/auth/repository');
const { createPasswordHasher, ARGON2ID_OPTIONS } = require('../src/modules/auth/passwords');

const env = {
  NODE_ENV: 'test',
  API_ALLOWED_ORIGINS: 'https://app.example.test',
  SESSION_HASH_PEPPER: 's'.repeat(32),
  AUTH_HASH_PEPPER: 'a'.repeat(32),
  RATE_LIMIT_PEPPER: 'r'.repeat(32),
  CLOUDBASE_APIKEY: 'test-api-key',
  COS_BUCKET: 'bucket',
  COS_REGION: 'region',
  DATABASE_SCHEMA: 'public',
};

function request(path, body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    path: `/api/v1${path}`,
    headers: { 'content-type': 'application/json', origin: 'https://app.example.test', ...headers },
    body: JSON.stringify(body),
    requestContext: { http: { sourceIp: '203.0.113.10' } },
  };
}

function runtime() {
  const rpc = vi.fn(async (name) => {
    if (name === 'consume_rate_limit_bucket') return { data: [{ accepted: true, retry_after_seconds: 0 }], error: null };
    if (name === 'resolve_content_user_session') return { data: [], error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  const rdb = { rpc, from: vi.fn() };
  const cloudbase = { SYMBOL_CURRENT_ENV: 'current', init: vi.fn(() => ({ rdb: vi.fn(() => rdb) })) };
  return { api: createRuntime({ env, cloudbase, logger: { info() {}, error() {} } }), rdb, rpc };
}

describe('quiz-only authentication routes', () => {
  it('exposes the formal challenge route as an anonymous non-idempotent write', async () => {
    const { api } = runtime();
    const response = await api.handle(request('/auth/challenges'));
    expect(response.statusCode).not.toBe(404);
    const route = api.router.resolve('POST', '/auth/challenges');
    expect(route.metadata).toMatchObject({ csrfExempt: true, idempotency: { mode: 'none' } });
  });

  it('exposes all formal auth paths with the required CSRF and session metadata', () => {
    const { api } = runtime();
    for (const path of ['/auth/challenges', '/auth/challenges/{id}/answer', '/auth/register', '/auth/login', '/auth/recover']) {
      expect(api.router.resolve('POST', path).metadata).toMatchObject({ csrfExempt: true, idempotency: { mode: 'none' } });
    }
    expect(api.router.resolve('POST', '/auth/register').metadata.rateLimit).toEqual([
      { bucket: 'registration-attempt-ip', limit: 5, windowSeconds: 60 },
    ]);
    expect(api.router.resolve('POST', '/auth/recovery-confirm').metadata).toMatchObject({ idempotency: { mode: 'none' } });
    expect(api.router.resolve('POST', '/auth/recovery-confirm').metadata.csrfExempt).not.toBe(true);
    expect(api.router.resolve('POST', '/auth/recovery-confirm').metadata.sessionRequired).not.toBe(true);
    expect(api.router.resolve('POST', '/auth/logout').metadata).toMatchObject({ sessionRequired: true, idempotency: { mode: 'none' } });
    expect(api.router.resolve('GET', '/me').metadata).toMatchObject({ sessionRequired: true });
  });
});

describe('registration attempt throttling', () => {
  it('rejects a limited registration before invoking the Argon-backed handler', async () => {
    const register = vi.fn();
    const rpc = vi.fn(async (name) => {
      if (name === 'resolve_content_user_session') return { data: [], error: null };
      if (name === 'consume_rate_limit_bucket') return { data: [{ accepted: false, retry_after_seconds: 30 }], error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const rdb = { rpc, from: vi.fn() };
    const cloudbase = { SYMBOL_CURRENT_ENV: 'current', init: vi.fn(() => ({ rdb: vi.fn(() => rdb) })) };
    const api = createRuntime({ env, cloudbase, authService: { register }, logger: { info() {}, error() {} } });
    const response = await api.handle(request('/auth/register', {
      registrationTicket: 'R'.repeat(43), username: 'reader_01', password: 'a-secure-password',
    }));
    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.body).errorCode).toBe('RATE_LIMITED');
    expect(register).not.toHaveBeenCalled();
  });
});

function context(overrides = {}) {
  const cookies = [];
  return {
    body: {}, params: {}, cookies: {}, actorId: undefined, clientIp: '203.0.113.10',
    config: { ...env, environment: 'test', sessionCookieName: 'lv_session', csrfCookieName: 'lv_csrf', authHashPepper: env.AUTH_HASH_PEPPER },
    setCookie: (cookie) => cookies.push(cookie), cookiesSet: cookies,
    ...overrides,
  };
}

function hmac(domain, value) {
  return crypto.createHmac('sha256', env.AUTH_HASH_PEPPER).update(`${domain}\0${value}`).digest('hex');
}

function service(overrides = {}) {
  const repository = {
    listActiveQuestions: vi.fn(), createChallenge: vi.fn(), getChallengeQuestion: vi.fn(),
    answerChallenge: vi.fn(), validateRegistrationTicket: vi.fn(), consumeRegistrationTicket: vi.fn(), findUserByUsername: vi.fn(),
    createLoginSession: vi.fn(), revokeSession: vi.fn(), consumeRecoveryCode: vi.fn(), confirmRecoveryCode: vi.fn(), getUserProfile: vi.fn(),
    ...overrides.repository,
  };
  const passwordHasher = {
    hash: vi.fn(async (value) => `argon:${value}`), verify: vi.fn(async () => true),
    ...overrides.passwordHasher,
  };
  return {
    repository,
    passwordHasher,
    auth: createAuthService({
      repository, passwordHasher, pepper: env.AUTH_HASH_PEPPER,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
      randomIndex: () => 0,
      opaqueToken: vi.fn().mockReturnValueOnce('T'.repeat(43)).mockReturnValueOnce('S'.repeat(43)).mockReturnValueOnce('C'.repeat(43)),
      recoveryCode: () => 'ABCD-EFGH-JKLM-NPQR',
    }),
  };
}

describe('authentication service', () => {
  it('creates a short-lived random active challenge without returning answer material', async () => {
    const question = { id: '550e8400-e29b-41d4-a716-446655440000', prompt: 'Which one?', options: ['A', 'B'], acceptedAnswerHashes: ['secret'], normalizationRule: 'trim_lowercase', samplingWeight: 1, version: 7 };
    const { auth, repository } = service({ repository: { listActiveQuestions: vi.fn().mockResolvedValue([question]), createChallenge: vi.fn().mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001' }) } });
    const response = await auth.createChallenge(context());
    expect(response).toEqual({ challengeId: '550e8400-e29b-41d4-a716-446655440001', prompt: 'Which one?', options: ['A', 'B'], expiresAt: '2030-01-01T00:05:00.000Z' });
    expect(repository.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ questionIds: [question.id], questionVersions: [7], maxAttempts: 3, ipHash: hmac('ip', '203.0.113.10') }));
    expect(JSON.stringify(response)).not.toMatch(/secret|accepted|normalization|questionIds/i);
  });

  it('normalizes and checks an answer while storing only the ticket hash', async () => {
    const accepted = hmac('question-answer', 'summer');
    const { auth, repository } = service({ repository: {
      getChallengeQuestion: vi.fn().mockResolvedValue({ normalizationRule: 'trim_lowercase', acceptedAnswerHashes: [accepted] }),
      answerChallenge: vi.fn().mockResolvedValue({ passed: true }),
    } });
    const response = await auth.answerChallenge(context({ params: { id: '550e8400-e29b-41d4-a716-446655440000' }, body: { answer: '  SUMMER  ' } }));
    expect(response).toEqual({ registrationTicket: 'T'.repeat(43), expiresAt: '2030-01-01T00:10:00.000Z' });
    expect(repository.answerChallenge).toHaveBeenCalledWith(expect.objectContaining({ isCorrect: true, ticketTokenHash: hmac('registration-ticket', 'T'.repeat(43)) }));
    expect(JSON.stringify(repository.answerChallenge.mock.calls)).not.toContain('SUMMER');
  });

  it('registers a canonical member atomically and returns recovery code but no session token', async () => {
    const { auth, repository, passwordHasher } = service({ repository: {
      validateRegistrationTicket: vi.fn().mockResolvedValue(true),
      consumeRegistrationTicket: vi.fn().mockResolvedValue({ userId: '550e8400-e29b-41d4-a716-446655440010' }),
    } });
    const ctx = context({ body: { registrationTicket: 'R'.repeat(43), username: '  Reader_01 ', password: 'a-secure-password' } });
    const response = await auth.register(ctx);
    expect(passwordHasher.hash).toHaveBeenCalledWith('a-secure-password');
    expect(repository.validateRegistrationTicket).toHaveBeenCalledWith(hmac('registration-ticket', 'R'.repeat(43)));
    expect(repository.consumeRegistrationTicket).toHaveBeenCalledWith(expect.objectContaining({
      ticketTokenHash: hmac('registration-ticket', 'R'.repeat(43)), username: 'reader_01', passwordHash: 'argon:a-secure-password',
      recoveryCodeHash: hmac('recovery-code', 'ABCD-EFGH-JKLM-NPQR'), sessionTokenHash: hmac('session', 'T'.repeat(43)), ipHash: hmac('ip', '203.0.113.10'),
    }));
    expect(response).toEqual({ userId: '550e8400-e29b-41d4-a716-446655440010', username: 'reader_01', recoveryCode: 'ABCD-EFGH-JKLM-NPQR' });
    expect(JSON.stringify(response)).not.toContain('T'.repeat(43));
    expect(ctx.cookiesSet.join('\n')).toMatch(/lv_session=.*HttpOnly.*Secure.*SameSite=Lax/);
    expect(ctx.cookiesSet.join('\n')).toMatch(/lv_csrf=.*Secure.*SameSite=Lax/);
  });

  it('rejects an invalid registration ticket before invoking Argon', async () => {
    const { auth, repository, passwordHasher } = service({ repository: {
      validateRegistrationTicket: vi.fn().mockResolvedValue(false),
    } });
    await expect(auth.register(context({ body: {
      registrationTicket: 'R'.repeat(43), username: 'reader_01', password: 'a-secure-password',
    } }))).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED', message: 'Registration could not be completed' });
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(repository.consumeRegistrationTicket).not.toHaveBeenCalled();
  });

  it('does not distinguish malformed registration tickets from unknown tickets', async () => {
    const { auth, repository, passwordHasher } = service();
    await expect(auth.register(context({ body: {
      registrationTicket: 'not-an-opaque-ticket', username: 'reader_01', password: 'a-secure-password',
    } }))).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED', message: 'Registration could not be completed' });
    expect(repository.validateRegistrationTicket).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
  });

  it('uses the same safe login failure for missing users and wrong passwords', async () => {
    const missing = service({ repository: { findUserByUsername: vi.fn().mockResolvedValue(null) } });
    const wrong = service({ repository: { findUserByUsername: vi.fn().mockResolvedValue({ id: 'u', passwordHash: 'hash', status: 'active' }) }, passwordHasher: { verify: vi.fn().mockResolvedValue(false) } });
    const ctx = context({ body: { username: ' Reader_01 ', password: 'wrong-password' } });
    const errors = [];
    for (const auth of [missing.auth, wrong.auth]) {
      try { await auth.login(ctx); } catch (error) { errors.push({ status: error.status, errorCode: error.errorCode, message: error.message }); }
    }
    expect(errors).toEqual([
      { status: 401, errorCode: 'AUTH_REQUIRED', message: 'Invalid username or password' },
      { status: 401, errorCode: 'AUTH_REQUIRED', message: 'Invalid username or password' },
    ]);
  });

  it('never treats a migrated account without installed credentials as a normal login', async () => {
    const migrated = service({ repository: { findUserByUsername: vi.fn().mockResolvedValue({ id: 'u', passwordHash: 'migration-required', credentialState: 'migration_required', status: 'active' }) }, passwordHasher: { verify: vi.fn().mockResolvedValue(true) } });
    await expect(migrated.auth.login(context({ body: { username: 'reader_01', password: 'a-secure-password' } }))).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_REQUIRED' });
    expect(migrated.passwordHasher.verify).not.toHaveBeenCalled();
  });

  it('creates a login session and returns only safe profile metadata', async () => {
    const profile = { id: '550e8400-e29b-41d4-a716-446655440020', username: 'reader_01', passwordHash: 'argon-hash', role: 'member', status: 'active', ageConsent: null };
    const { auth, repository, passwordHasher } = service({ repository: { findUserByUsername: vi.fn().mockResolvedValue(profile), createLoginSession: vi.fn().mockResolvedValue({ sessionId: 's' }), getUserProfile: vi.fn().mockResolvedValue(profile) } });
    const ctx = context({ body: { username: 'READER_01', password: 'a-secure-password' }, cookies: { lv_session: 'Q'.repeat(43) } });
    const response = await auth.login(ctx);
    expect(passwordHasher.verify).toHaveBeenCalledWith('argon-hash', 'a-secure-password');
    expect(repository.createLoginSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: profile.id,
      sessionTokenHash: hmac('session', 'T'.repeat(43)),
      currentSessionTokenHash: hmac('session', 'Q'.repeat(43)),
    }));
    expect(response.user).toEqual({ id: profile.id, username: 'reader_01', role: 'member', capabilities: ['comment', 'favorite', 'submit'], ageConsent: null });
    expect(response.session).toEqual({ expiresAt: '2030-01-31T00:00:00.000Z' });
  });

  it('revokes only the current authenticated session and clears both cookies', async () => {
    const { auth, repository } = service({ repository: { revokeSession: vi.fn().mockResolvedValue(true) } });
    const ctx = context({ actorId: '550e8400-e29b-41d4-a716-446655440020', cookies: { lv_session: 'Q'.repeat(43) } });
    expect(await auth.logout(ctx)).toEqual({ ok: true });
    expect(repository.revokeSession).toHaveBeenCalledWith(hmac('session', 'Q'.repeat(43)));
    expect(ctx.cookiesSet).toHaveLength(2);
    expect(ctx.cookiesSet.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
  });

  it('consumes a recovery code, rotates recovery and session secrets, and returns the new code once', async () => {
    const profile = { id: '550e8400-e29b-41d4-a716-446655440030', username: 'reader_01', role: 'member', status: 'active', ageConsent: null };
    const { auth, repository } = service({ repository: { consumeRecoveryCode: vi.fn().mockResolvedValue({ userId: profile.id }), getUserProfile: vi.fn().mockResolvedValue(profile) } });
    const ctx = context({ body: { recoveryCode: 'WXYZ-2345-6789-ABCD', newPassword: 'a-new-secure-password' } });
    const response = await auth.recover(ctx);
    expect(repository.consumeRecoveryCode).toHaveBeenCalledWith(expect.objectContaining({
      recoveryCodeHash: hmac('recovery-code', 'WXYZ-2345-6789-ABCD'), newRecoveryCodeHash: hmac('recovery-code', 'ABCD-EFGH-JKLM-NPQR'),
    }));
    expect(response.recoveryCode).toBe('ABCD-EFGH-JKLM-NPQR');
    expect(response.user.username).toBe('reader_01');
  });

  it('confirms recovery storage against the unconfirmed session cookie without requiring an actor', async () => {
    const profile = { id: '550e8400-e29b-41d4-a716-446655440030', username: 'reader_01', role: 'member', status: 'active', ageConsent: null };
    const { auth, repository } = service({ repository: {
      confirmRecoveryCode: vi.fn().mockResolvedValue({ profile }),
      getUserProfile: vi.fn().mockRejectedValue(new Error('must not query after confirmation commits')),
    } });
    const ctx = context({
      body: { recoveryCode: 'ABCD-EFGH-JKLM-NPQR' },
      cookies: { lv_session: 'Q'.repeat(43) },
      actorId: undefined,
    });
    await expect(auth.confirmRecovery(ctx)).resolves.toEqual({ confirmed: true, user: {
      id: profile.id, username: 'reader_01', role: 'member', capabilities: ['comment', 'favorite', 'submit'], ageConsent: null,
    } });
    expect(repository.confirmRecoveryCode).toHaveBeenCalledWith({
      sessionTokenHash: hmac('session', 'Q'.repeat(43)),
      recoveryCodeHash: hmac('recovery-code', 'ABCD-EFGH-JKLM-NPQR'),
    });
  });

  it('returns /me data without password or credential hashes and rejects missing sessions', async () => {
    const profile = { id: '550e8400-e29b-41d4-a716-446655440040', username: 'reader_01', role: 'admin', status: 'active', passwordHash: 'never-return', ageConsent: null };
    const { auth } = service({ repository: { getUserProfile: vi.fn().mockResolvedValue(profile) } });
    const response = await auth.me(context({ actorId: profile.id }));
    expect(response).toEqual({ user: { id: profile.id, username: 'reader_01' }, role: 'admin', capabilities: ['comment', 'favorite', 'submit', 'admin'], ageConsent: null });
    expect(JSON.stringify(response)).not.toMatch(/password|hash|token|recovery/i);
    await expect(auth.me(context())).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_REQUIRED' });
  });

  it('rejects unknown auth input fields instead of trusting browser payloads', async () => {
    const { auth } = service();
    await expect(auth.register(context({ body: { registrationTicket: 'R'.repeat(43), username: 'reader_01', password: 'a-secure-password', role: 'admin' } })))
      .rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    await expect(auth.answerChallenge(context({ params: { id: '550e8400-e29b-41d4-a716-446655440000' }, body: { answer: 'summer', questionId: 'leak' } })))
      .rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
  });
});

describe('authentication infrastructure adapters', () => {
  it('uses Argon2id with the bounded function-memory parameters through an injectable adapter', async () => {
    const adapter = { Algorithm: { Argon2id: 2 }, hash: vi.fn().mockResolvedValue('encoded'), verify: vi.fn().mockResolvedValue(true) };
    const hasher = createPasswordHasher(adapter);
    expect(await hasher.hash('a-secure-password')).toBe('encoded');
    expect(adapter.hash).toHaveBeenCalledWith('a-secure-password', { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    expect(await hasher.verify('encoded', 'a-secure-password')).toBe(true);
    expect(ARGON2ID_OPTIONS.memoryCost).toBe(19456);
  });

  it('maps auth RPC rows and never sends raw credentials to the database', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ user_id: '550e8400-e29b-41d4-a716-446655440010', session_id: '550e8400-e29b-41d4-a716-446655440011' }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createAuthRepository({ rdb: { rpc, from: vi.fn() } });
    expect(await repository.consumeRegistrationTicket({ ticketTokenHash: 'a'.repeat(64), username: 'reader_01', passwordHash: 'argon-hash', sessionTokenHash: 'b'.repeat(64), sessionExpiresAt: '2030-02-01T00:00:00.000Z', recoveryCodeHash: 'c'.repeat(64), ipHash: 'd'.repeat(64) }))
      .toEqual({ userId: '550e8400-e29b-41d4-a716-446655440010', sessionId: '550e8400-e29b-41d4-a716-446655440011' });
    expect(await repository.revokeSession('b'.repeat(64))).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, 'consume_registration_ticket', {
      p_ticket_token_hash: 'a'.repeat(64), p_username: 'reader_01', p_password_hash: 'argon-hash', p_session_token_hash: 'b'.repeat(64),
      p_session_expires_at: '2030-02-01T00:00:00.000Z', p_recovery_code_hash: 'c'.repeat(64), p_ip_hash: 'd'.repeat(64),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'revoke_user_session', { p_token_hash: 'b'.repeat(64) });
  });

  it('maps duplicate usernames to a safe 409 without exposing database errors', async () => {
    const repository = createAuthRepository({ rdb: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'app_users_username_lower_key reader_01' } }) } });
    await expect(repository.consumeRegistrationTicket({})).rejects.toMatchObject({ status: 409, errorCode: 'STATE_CONFLICT', message: 'Username is unavailable' });
  });

  it('maps only the registration-success quota error to a safe 429', async () => {
    const repository = createAuthRepository({ rdb: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'registration_success_rate_limited' } }) } });
    await expect(repository.consumeRegistrationTicket({})).rejects.toMatchObject({ status: 429, errorCode: 'RATE_LIMITED', message: 'Too many successful registrations' });
  });

  it('preflights only hashed registration tickets and maps unconfirmed login rejection safely', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'login user is missing, inactive, or recovery-unconfirmed' } });
    const repository = createAuthRepository({ rdb: { from: vi.fn(), rpc } });
    await expect(repository.validateRegistrationTicket('a'.repeat(64))).resolves.toBe(true);
    await expect(repository.createLoginSession({
      userId: '550e8400-e29b-41d4-a716-446655440010', sessionTokenHash: 'b'.repeat(64),
      currentSessionTokenHash: null, sessionExpiresAt: '2030-02-01T00:00:00.000Z', ipHash: 'c'.repeat(64),
    })).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_REQUIRED', message: 'Invalid username or password' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'validate_registration_ticket', { p_ticket_token_hash: 'a'.repeat(64) });
  });

  it('passes login rotation and recovery confirmation hashes only through controlled RPCs', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: '550e8400-e29b-41d4-a716-446655440011', error: null })
      .mockResolvedValueOnce({ data: [{
        user_id: '550e8400-e29b-41d4-a716-446655440012', username: 'reader_01', role: 'member',
        status: 'active', policy_version: null, accepted_at: null,
      }], error: null });
    const repository = createAuthRepository({ rdb: { from: vi.fn(), rpc } });
    await repository.createLoginSession({
      userId: '550e8400-e29b-41d4-a716-446655440010', sessionTokenHash: 'a'.repeat(64),
      currentSessionTokenHash: 'b'.repeat(64), sessionExpiresAt: '2030-02-01T00:00:00.000Z', ipHash: 'c'.repeat(64),
    });
    await expect(repository.confirmRecoveryCode({ sessionTokenHash: 'd'.repeat(64), recoveryCodeHash: 'e'.repeat(64) })).resolves.toEqual({ profile: {
      id: '550e8400-e29b-41d4-a716-446655440012', username: 'reader_01', role: 'member', status: 'active', ageConsent: null,
    } });
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_login_session', {
      p_user_id: '550e8400-e29b-41d4-a716-446655440010', p_token_hash: 'a'.repeat(64),
      p_expires_at: '2030-02-01T00:00:00.000Z', p_ip_hash: 'c'.repeat(64), p_current_token_hash: 'b'.repeat(64),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'confirm_recovery_session', {
      p_session_token_hash: 'd'.repeat(64), p_recovery_code_hash: 'e'.repeat(64),
    });
  });

  it('invalidates a challenge when the current question version differs from its snapshot', async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce({ data: [{
        question_ids: ['550e8400-e29b-41d4-a716-446655440000'], question_versions: [3], status: 'pending',
        expires_at: '2099-01-01T00:00:00.000Z', attempt_count: 0, max_attempts: 3,
      }], error: null })
      .mockResolvedValueOnce({ data: [{
        id: '550e8400-e29b-41d4-a716-446655440000', prompt: 'changed', options: ['A', 'B'],
        accepted_answer_hashes: ['hash'], normalization_rule: 'trim', sampling_weight: 1, version: 4,
      }], error: null });
    const rdb = { rpc: vi.fn(), from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ limit })) })) })) };
    const repository = createAuthRepository({ rdb });
    await expect(repository.getChallengeQuestion('550e8400-e29b-41d4-a716-446655440001')).resolves.toBeNull();
  });
});
