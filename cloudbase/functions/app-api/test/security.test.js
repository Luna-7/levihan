const { createApi } = require('../src/http');
const { parseConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { serializeCookie, setSessionCookies, clearSessionCookies } = require('../src/security');
const { createRateLimitRepository, createCloudBaseIdempotencyStore, createCloudBaseActorResolver } = require('../src/repositories/db');
const { createRuntime } = require('../index');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const config = {
  environment: 'test', allowedOrigins: [], sessionCookieName: 'lv_session', csrfCookieName: 'lv_csrf',
  bodyLimitBytes: 1024, csrfRequired: true, sessionHashPepper: 'test-pepper', rateLimitPepper: 'test-rate-pepper',
};

function request(overrides = {}) {
  return { httpMethod: 'POST', path: '/api/v1/write', headers: {}, ...overrides };
}

describe('security boundaries', () => {
  it('serializes session and CSRF cookies with their distinct security flags', () => {
    expect(serializeCookie('lv_session', 'abc', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' }))
      .toBe('lv_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(serializeCookie('lv_csrf', 'def', { httpOnly: false, secure: true, sameSite: 'Lax', path: '/' }))
      .toBe('lv_csrf=def; Path=/; Secure; SameSite=Lax');
  });

  it('emits and clears both session cookies through multi-value headers', async () => {
    const server = createApi({ config, requestId: () => 'cookies', logger: { info: vi.fn(), error: vi.fn() } });
    server.router.post('/cookies', (ctx) => { setSessionCookies(ctx, 'test-session', 'test-csrf'); clearSessionCookies(ctx); return { ok: true }; }, { csrfExempt: true });
    const response = await server.handle(request({ path: '/api/v1/cookies' }));
    expect(response.multiValueHeaders['set-cookie']).toHaveLength(4);
    expect(response.multiValueHeaders['set-cookie'][0]).toContain('HttpOnly');
    expect(response.multiValueHeaders['set-cookie'][1]).not.toContain('HttpOnly');
    expect(response.multiValueHeaders['set-cookie'][2]).toContain('Max-Age=0');
  });

  it('accepts a matching CSRF cookie and header for writes', async () => {
    const server = createApi({ config, requestId: () => 'csrf-pass', logger: { info: vi.fn(), error: vi.fn() } });
    server.router.post('/write', () => ({ ok: true }));
    const csrfToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const response = await server.handle(request({ headers: { cookie: `lv_csrf=${csrfToken}`, 'x-csrf-token': csrfToken } }));
    expect(response.statusCode).toBe(200);
  });

  it('rejects missing or mismatched CSRF double-submit tokens', async () => {
    const server = createApi({ config, requestId: () => 'csrf-fail', logger: { info: vi.fn(), error: vi.fn() } });
    server.router.post('/write', () => ({ ok: true }));
    const response = await server.handle(request({ headers: { cookie: 'lv_csrf=test-cookie', 'x-csrf-token': 'test-header' } }));
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).errorCode).toBe('ACCESS_DENIED');
  });

  it('allows a route explicitly marked as CSRF-exempt', async () => {
    const server = createApi({ config, requestId: () => 'csrf-exempt', logger: { info: vi.fn(), error: vi.fn() } });
    server.router.post('/auth/login', () => ({ ok: true }), { csrfExempt: true });
    const response = await server.handle(request({ path: '/api/v1/auth/login' }));
    expect(response.statusCode).toBe(200);
  });

  it('rejects missing required configuration', () => {
    const apiKey = 'test-api-key';
    expect(() => parseConfig({ NODE_ENV: 'production', API_ALLOWED_ORIGINS: '', SESSION_HASH_PEPPER: '', CLOUDBASE_APIKEY: apiKey }))
      .toThrow(/API_ALLOWED_ORIGINS/);
    expect(() => parseConfig({ NODE_ENV: 'production', API_ALLOWED_ORIGINS: 'https://app.example.test', SESSION_HASH_PEPPER: 'a'.repeat(32), CLOUDBASE_APIKEY: apiKey, COS_BUCKET: 'test-bucket', COS_REGION: 'ap-test-1', DATABASE_SCHEMA: 'public' }))
      .toThrow(/SESSION_COOKIE_DOMAIN/);
  });

  it('rejects short peppers and disabled production CSRF', () => {
    const base = { NODE_ENV: 'production', API_ALLOWED_ORIGINS: 'https://app.example.test', CLOUDBASE_APIKEY: 'test-api-key', COS_BUCKET: 'test-bucket', COS_REGION: 'ap-test-1', DATABASE_SCHEMA: 'public', SESSION_COOKIE_DOMAIN: 'example.test' };
    expect(() => parseConfig({ ...base, SESSION_HASH_PEPPER: 'short' })).toThrow(/SESSION_HASH_PEPPER/);
    expect(() => parseConfig({ ...base, SESSION_HASH_PEPPER: 'a'.repeat(32), CSRF_REQUIRED: 'false' })).toThrow(/CSRF_REQUIRED/);
  });

  it('does not log request bodies, cookies, tokens, answers, or passwords', () => {
    const write = vi.fn();
    const logger = createLogger({ write, actorPepper: 'pepper' });
    const sensitive = 'test-sensitive-value';
    logger.info({ requestId: 'request-1', method: 'POST', route: '/auth/login', status: 200, durationMs: 3, actorId: 'user-1',
      body: { password: sensitive, answer: sensitive }, cookie: `lv_session=${sensitive}`, token: sensitive });
    const record = write.mock.calls[0][0];
    expect(record).toMatchObject({ requestId: 'request-1', method: 'POST', route: '/auth/login', status: 200, durationMs: 3 });
    expect(record.actorIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(sensitive);
    expect(record.body).toBeUndefined();
  });

  it('logs a handler actor only as a hash and preserves safe 5xx diagnostics', async () => {
    const write = vi.fn();
    const server = createApi({ config, requestId: () => 'log-request', logger: createLogger({ write, actorPepper: 'pepper' }) });
    server.router.get('/actor', (ctx) => { ctx.setActor('member-42'); throw new Error('SELECT test-sensitive-value'); });
    await server.handle({ httpMethod: 'GET', path: '/api/v1/actor' });
    expect(write.mock.calls[0][0]).toMatchObject({ requestId: 'log-request', errorCode: 'INTERNAL_ERROR', errorType: 'Error', environment: 'test' });
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain('member-42');
  });

  it('resolves an actor before idempotency and logs the resolved actor only as a hash', async () => {
    const write = vi.fn();
    const execute = vi.fn(async ({ operation }) => operation());
    const actorResolver = vi.fn(async () => 'member-84');
    const server = createApi({ config, idempotencyStore: { execute }, actorResolver, requestId: () => 'resolved-actor', logger: createLogger({ write, actorPepper: 'pepper' }) });
    server.router.post('/write', (ctx) => ({ actor: ctx.actorId }), { csrfExempt: true });

    const response = await server.handle(request({ headers: { 'idempotency-key': 'actor-key-01' }, requestContext: { identity: { sourceIp: '203.0.113.8' } } }));

    expect(response.statusCode).toBe(200);
    expect(actorResolver).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].actorIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain('member-84');
  });

  it('registers a public versioned CloudBase HTTP gateway', () => {
    const cloudbase = JSON.parse(readFileSync(resolve(__dirname, '../../../cloudbaserc.json'), 'utf8'));
    const apiFunction = cloudbase.functions.find((item) => item.name === 'app-api');
    expect(apiFunction).toMatchObject({ type: 'HTTP', public: true, gatewayPath: '/api/v1' });
    expect(apiFunction.envVariables).toMatchObject({ COS_BUCKET: '{{env.COS_BUCKET}}', COS_REGION: '{{env.COS_REGION}}', DATABASE_SCHEMA: '{{env.DATABASE_SCHEMA}}', CSRF_REQUIRED: '{{env.CSRF_REQUIRED}}', TRUST_PROXY_HEADERS: '{{env.TRUST_PROXY_HEADERS}}' });
    expect(cloudbase.functions.find((item) => item.name === 'admin-upload').envVariables.DATABASE_SCHEMA).toBeUndefined();
  });

  it('uses the CloudBase RPC adapter for atomic rate limiting', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ accepted: true, retry_after_seconds: 0 }], error: null });
    const repository = createRateLimitRepository({ rpc });
    const result = await repository.consume({ subjectHash: 'hash', bucket: 'login-ip', windowSeconds: 60, limit: 2, now: new Date('2030-01-01T00:00:10.000Z') });
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit_bucket', expect.objectContaining({ p_subject_hash: 'hash', p_bucket: 'login-ip' }));
    expect(result).toEqual({ accepted: true, retryAfterSeconds: 0 });
  });

  it('persists only the safe idempotent response header allowlist', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ state: 'acquired', response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const store = createCloudBaseIdempotencyStore({ rdb: { rpc } });
    const response = {
      statusCode: 201,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=30',
        etag: 'safe-etag',
        location: '/api/v1/works/1',
        'x-unsafe': 'discard-me',
      },
      body: { work: { id: '1', title: 'safe' } },
    };

    expect(await store.execute({ scope: 'scope-hash', key: 'key-12345', requestHash: 'request-hash', actorScopeHash: 'actor-hash', operation: async () => response })).toBe(response);
    expect(rpc).toHaveBeenNthCalledWith(1, 'begin_idempotent_request', {
      p_scope: 'scope-hash', p_actor_scope_hash: 'actor-hash', p_idempotency_key: 'key-12345', p_request_hash: 'request-hash',
    });
    const persisted = rpc.mock.calls[1][1].p_response;
    expect(persisted).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=30', etag: 'safe-etag' },
      body: { work: { id: '1', title: 'safe' } },
    });
    expect(JSON.stringify(persisted).toLowerCase()).not.toMatch(/location|x-unsafe/);
  });

  it.each([
    ['nested recovery code', { body: { account: { recoveryCode: 'test-sensitive-value' } } }],
    ['array token', { body: { items: [{ access_token: 'test-sensitive-value' }] } }],
    ['password', { body: { password: 'test-sensitive-value' } }],
    ['secret', { body: { clientSecret: 'test-sensitive-value' } }],
    ['signed URL field', { body: { signedUrl: 'https://example.test/file' } }],
    ['signed query string', { body: { url: 'https://example.test/file?X-Amz-Signature=test-sensitive-value' } }],
    ['COS signed query string', { body: { url: 'https://example.test/file?q-sign-algorithm=sha1&q-ak=test-sensitive-value' } }],
    ['bearer string', { body: { value: `Bearer ${'test-sensitive-value'}` } }],
    ['authorization header', { headers: { authorization: `Bearer ${'test-sensitive-value'}` }, body: { ok: true } }],
    ['set-cookie header', { headers: { 'set-cookie': 'lv_session=test-sensitive-value' }, body: { ok: true } }],
    ['primitive string response', 'test-sensitive-value'],
  ])('releases rather than persists a sensitive %s response', async (_name, response) => {
    const reportSecurityEvent = vi.fn();
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ state: 'acquired', response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const store = createCloudBaseIdempotencyStore({ rdb: { rpc }, reportSecurityEvent });

    expect(await store.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: async () => response })).toBe(response);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_idempotent_request', 'fail_idempotent_request']);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('test-sensitive-value');
    expect(reportSecurityEvent).toHaveBeenCalledWith({ errorCode: 'IDEMPOTENCY_RESPONSE_REJECTED', errorType: 'SensitiveIdempotencyResponseError' });
    expect(JSON.stringify(reportSecurityEvent.mock.calls)).not.toContain('test-sensitive-value');
  });

  it('replays completed responses and releases only failed operations', async () => {
    const completed = { statusCode: 200, headers: {}, body: { ok: true } };
    const replayRpc = vi.fn().mockResolvedValue({ data: [{ state: 'completed', response: completed }], error: null });
    const replayOperation = vi.fn();
    const replayStore = createCloudBaseIdempotencyStore({ rdb: { rpc: replayRpc } });
    expect(await replayStore.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: replayOperation })).toEqual(completed);
    expect(replayOperation).not.toHaveBeenCalled();

    const failedRpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ state: 'acquired', response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const failedStore = createCloudBaseIdempotencyStore({ rdb: { rpc: failedRpc } });
    const failure = new Error('operation failed');
    await expect(failedStore.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: async () => { throw failure; } })).rejects.toBe(failure);
    expect(failedRpc).toHaveBeenNthCalledWith(2, 'fail_idempotent_request', expect.objectContaining({ p_actor_scope_hash: 'actor', p_request_hash: 'hash' }));
  });

  it('maps in-progress and request-hash conflicts to safe 409 errors', async () => {
    for (const state of ['in_progress', 'request_hash_conflict']) {
      const store = createCloudBaseIdempotencyStore({ rdb: { rpc: vi.fn().mockResolvedValue({ data: [{ state, response: null }], error: null }) } });
      await expect(store.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: vi.fn() }))
        .rejects.toMatchObject({ status: 409, errorCode: 'STATE_CONFLICT' });
    }
  });

  it('resolves an active session actor using only an HMAC token hash', async () => {
    const sessionValue = `test-${'s'.repeat(59)}`;
    const expectedHash = crypto.createHmac('sha256', config.sessionHashPepper).update(sessionValue).digest('hex');
    const rpc = vi.fn().mockResolvedValue({ data: [{ user_id: '00000000-0000-4000-8000-000000000084', role: 'member' }], error: null });
    const resolveActor = createCloudBaseActorResolver({ rdb: { rpc }, config });

    const actor = await resolveActor({ cookies: { [config.sessionCookieName]: sessionValue } });

    expect(actor).toEqual({ actorId: '00000000-0000-4000-8000-000000000084', role: 'member' });
    expect(rpc).toHaveBeenCalledWith('resolve_user_session', { p_token_hash: expectedHash });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(sessionValue);
  });

  it('returns null without RPC for absent or low-entropy session cookies and for unknown sessions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const resolveActor = createCloudBaseActorResolver({ rdb: { rpc }, config });

    expect(await resolveActor({ cookies: {} })).toBeNull();
    expect(await resolveActor({ cookies: { [config.sessionCookieName]: 'short-token' } })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await resolveActor({ cookies: { [config.sessionCookieName]: 'u'.repeat(64) } })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['false result', { data: false, error: null }],
    ['RPC error', { data: null, error: { name: 'DatabaseError', message: 'test-sensitive-value' } }],
  ])('raises a safe dependency error when fail release returns a %s', async (_name, failResult) => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ state: 'acquired', response: null }], error: null })
      .mockResolvedValueOnce(failResult);
    const store = createCloudBaseIdempotencyStore({ rdb: { rpc } });

    let caught;
    try {
      await store.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: async () => { throw new Error('test-sensitive-value'); } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: 'DependencyUnavailableError', status: 503, errorCode: 'DEPENDENCY_UNAVAILABLE', cause: { name: expect.stringMatching(/^[A-Za-z]+Error$/) } });
    expect(JSON.stringify(caught)).not.toContain('test-sensitive-value');
  });

  it.each([
    ['missing row', { data: null, error: null }],
    ['unknown state', { data: [{ state: 'unexpected', response: null }], error: null }],
  ])('maps a %s from begin RPC to a safe dependency error', async (_name, beginResult) => {
    const store = createCloudBaseIdempotencyStore({ rdb: { rpc: vi.fn().mockResolvedValue(beginResult) } });

    await expect(store.execute({ scope: 'scope', key: 'key-12345', requestHash: 'hash', actorScopeHash: 'actor', operation: vi.fn() }))
      .rejects.toMatchObject({ name: 'DependencyUnavailableError', status: 503, errorCode: 'DEPENDENCY_UNAVAILABLE', cause: { name: 'InvalidRpcResultError' } });
  });

  it('injects the CloudBase idempotency store and production session actor resolver in the runtime', async () => {
    const sessionValue = `test-${'r'.repeat(59)}`;
    const write = vi.fn();
    const runtimeLogger = createLogger({ write, actorPepper: 'a'.repeat(32) });
    const rpc = vi.fn(async (name) => {
      if (name === 'resolve_user_session') return { data: [{ user_id: '00000000-0000-4000-8000-000000000084', role: 'admin' }], error: null };
      if (name === 'begin_idempotent_request') return { data: [{ state: 'acquired', response: null }], error: null };
      return { data: true, error: null };
    });
    const rdb = { rpc };
    const cloudbase = { SYMBOL_CURRENT_ENV: 'current', init: vi.fn(() => ({ rdb: vi.fn(() => rdb) })) };
    const runtime = createRuntime({
      cloudbase,
      logger: runtimeLogger,
      env: {
        NODE_ENV: 'test', API_ALLOWED_ORIGINS: 'https://app.example.test',
        SESSION_HASH_PEPPER: 'a'.repeat(32), RATE_LIMIT_PEPPER: 'b'.repeat(32),
        CLOUDBASE_APIKEY: 'test-api-key', COS_BUCKET: 'bucket', COS_REGION: 'region', DATABASE_SCHEMA: 'public',
      },
    });
    runtime.router.post('/runtime-write', (ctx) => ({ actorId: ctx.actorId, role: ctx.actorRole }), { csrfExempt: true });
    runtime.router.post('/runtime-sensitive', () => ({ recoveryCode: 'test-sensitive-value' }), { csrfExempt: true });

    const response = await runtime.handle({ httpMethod: 'POST', path: '/api/v1/runtime-write', headers: { cookie: `lv_session=${sessionValue}`, 'idempotency-key': 'runtime-key-01' }, requestContext: {} });
    const sensitiveResponse = await runtime.handle({ httpMethod: 'POST', path: '/api/v1/runtime-sensitive', headers: { cookie: `lv_session=${sessionValue}`, 'idempotency-key': 'runtime-key-02' }, requestContext: {} });

    expect(response.statusCode).toBe(200);
    expect(sensitiveResponse.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ actorId: '00000000-0000-4000-8000-000000000084', role: 'admin' });
    expect(rpc).toHaveBeenCalledWith('resolve_user_session', { p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(rpc).toHaveBeenCalledWith('begin_idempotent_request', expect.objectContaining({ p_actor_scope_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(sessionValue);
    expect(JSON.stringify(write.mock.calls)).not.toContain(sessionValue);
    expect(rpc.mock.calls.map(([name]) => name)).toContain('fail_idempotent_request');
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'IDEMPOTENCY_RESPONSE_REJECTED', errorType: 'SensitiveIdempotencyResponseError' }));
    expect(JSON.stringify(write.mock.calls)).not.toContain('test-sensitive-value');
  });
});
