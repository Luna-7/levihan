const { createApi } = require('../src/http');
const { parseConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { serializeCookie, setSessionCookies, clearSessionCookies } = require('../src/security');
const { createRateLimitRepository } = require('../src/repositories/db');
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
});
