const { createApi } = require('../src/http');
const { parseConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { serializeCookie } = require('../src/security');
const { createRateLimitRepository } = require('../src/repositories/db');

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

  it('accepts a matching CSRF cookie and header for writes', async () => {
    const server = createApi({ config, requestId: () => 'csrf-pass', logger: { info: vi.fn(), error: vi.fn() } });
    server.router.post('/write', () => ({ ok: true }));
    const csrfToken = 'test-csrf-pass';
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
    expect(() => parseConfig({ NODE_ENV: 'production', API_ALLOWED_ORIGINS: 'https://app.example.test', SESSION_HASH_PEPPER: 'pepper', CLOUDBASE_APIKEY: apiKey }))
      .toThrow(/SESSION_COOKIE_DOMAIN/);
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

  it('uses the rdb adapter for one atomic PostgreSQL rate-limit statement', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ hit_count: 1, expires_at: '2030-01-01T00:01:00.000Z' }] });
    const repository = createRateLimitRepository({ query });
    const result = await repository.consume({ subjectHash: 'hash', bucket: 'login-ip', windowSeconds: 60, limit: 2, now: new Date('2030-01-01T00:00:10.000Z') });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO rate_limit_buckets');
    expect(result).toEqual({ accepted: true, retryAfterSeconds: 0 });
  });
});
