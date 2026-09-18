const { createApi } = require('../src/http');
const { ApiError } = require('../src/errors');

const config = {
  environment: 'test',
  allowedOrigins: ['https://app.example.test'],
  sessionCookieName: 'lv_session',
  csrfCookieName: 'lv_csrf',
  sessionCookieDomain: undefined,
  bodyLimitBytes: 1024,
  csrfRequired: true,
  sessionHashPepper: 'test-pepper',
  rateLimitPepper: 'test-rate-pepper',
};

function request(overrides = {}) {
  return {
    httpMethod: 'GET',
    path: '/api/v1/ping',
    headers: { origin: 'https://app.example.test' },
    requestContext: { identity: { sourceIp: '203.0.113.8' } },
    ...overrides,
  };
}

function api(overrides = {}) {
  return createApi({
    config,
    requestId: () => 'req-test-123',
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  });
}

describe('HTTP API kernel', () => {
  it('parses JSON and serializes a success response with a request ID', async () => {
    const server = api();
    server.router.post('/echo', (ctx) => ({ received: ctx.body }), { csrfExempt: true });

    const response = await server.handle(request({
      httpMethod: 'POST', path: '/api/v1/echo', body: '{"ok":true}', headers: { 'content-type': 'application/json' },
    }));

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-test-123');
    expect(JSON.parse(response.body)).toEqual({ received: { ok: true } });
  });

  it('rejects malformed JSON with the public error envelope', async () => {
    const response = await api().handle(request({
      httpMethod: 'POST', path: '/api/v1/none', body: '{bad', headers: { 'content-type': 'application/json' },
    }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ errorCode: 'VALIDATION_FAILED', message: 'Invalid JSON body', requestId: 'req-test-123' });
  });

  it('rejects a body that exceeds the configured limit', async () => {
    const response = await api().handle(request({
      httpMethod: 'POST', path: '/api/v1/none', body: 'x'.repeat(1025), headers: { 'content-type': 'text/plain' },
    }));

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).errorCode).toBe('PAYLOAD_TOO_LARGE');
  });

  it('allows CORS only for an explicit origin', async () => {
    const response = await api().handle(request());
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(response.headers.vary).toContain('Origin');
  });

  it('does not return ACAO for an unknown origin', async () => {
    const response = await api().handle(request({ headers: { origin: 'https://evil.example' } }));
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts an allowed CORS preflight without invoking a route', async () => {
    const server = api();
    server.router.post('/ping', () => ({ ok: true }), { csrfExempt: true });
    const response = await server.handle(request({ httpMethod: 'OPTIONS', headers: {
      origin: 'https://app.example.test', 'access-control-request-method': 'POST',
    } }));
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('rejects an unknown-origin preflight without ACAO', async () => {
    const response = await api().handle(request({ httpMethod: 'OPTIONS', headers: {
      origin: 'https://evil.example', 'access-control-request-method': 'POST',
    } }));
    expect(response.statusCode).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets all security response headers', async () => {
    const response = await api().handle(request());
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
  });

  it('maps known API errors and redacts unknown failures', async () => {
    const server = api();
    server.router.get('/known', () => { throw new ApiError(409, 'VERSION_CONFLICT', 'Conflict', { version: 4 }); });
    server.router.get('/unknown', () => { throw new Error('SELECT password FROM users at /private/stack'); });

    const known = await server.handle(request({ path: '/api/v1/known' }));
    const unknown = await server.handle(request({ path: '/api/v1/unknown' }));

    expect(JSON.parse(known.body)).toEqual({ errorCode: 'VERSION_CONFLICT', message: 'Conflict', requestId: 'req-test-123', details: { version: 4 } });
    expect(JSON.parse(unknown.body)).toEqual({ errorCode: 'INTERNAL_ERROR', message: 'Service temporarily unavailable', requestId: 'req-test-123' });
    expect(unknown.body).not.toContain('SELECT');
    expect(unknown.body).not.toContain('/private');
  });

  it('enforces rate limiting and returns Retry-After', async () => {
    const consume = vi.fn().mockResolvedValue({ accepted: false, retryAfterSeconds: 17 });
    const server = api({ rateLimiter: { consume } });
    server.router.post('/login', () => ({ ok: true }), { csrfExempt: true, rateLimit: { bucket: 'login-ip', limit: 5, windowSeconds: 60 } });

    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/login', headers: {} }));
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(JSON.parse(response.body).errorCode).toBe('RATE_LIMITED');
  });

  it('uses independent IP and normalized username buckets for login', async () => {
    const consume = vi.fn().mockResolvedValue({ accepted: true, retryAfterSeconds: 0 });
    const server = api({ rateLimiter: { consume } });
    server.router.post('/auth/login', () => ({ ok: true }), { csrfExempt: true });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/auth/login', body: '{"username":"  Alice "}', headers: { 'content-type': 'application/json' } }));
    expect(response.statusCode).toBe(200);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume.mock.calls.map(([value]) => value.bucket)).toEqual(['login-ip', 'login-username']);
    expect(consume.mock.calls[0][0].subjectHash).not.toBe(consume.mock.calls[1][0].subjectHash);
  });

  it('rejects a limited route without a trusted CloudBase source IP', async () => {
    const server = api({ rateLimiter: { consume: vi.fn() } });
    server.router.post('/submissions', () => ({ ok: true }), { csrfExempt: true });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/submissions', requestContext: {} }));
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ errorCode: 'DEPENDENCY_UNAVAILABLE', message: 'Service temporarily unavailable', requestId: 'req-test-123' });
  });

  it('passes query values, client trace and custom response status to handlers', async () => {
    const server = api();
    server.router.get('/created', (ctx) => ({ statusCode: 201, headers: { 'x-result': 'yes' }, body: { query: ctx.query, clientTraceId: ctx.clientTraceId } }));
    const response = await server.handle(request({ path: '/api/v1/created', headers: { 'x-request-id': 'client-trace-9' }, queryStringParameters: { cursor: 'one' }, multiValueQueryStringParameters: { tag: ['a', 'b'] } }));
    expect(response.statusCode).toBe(201);
    expect(response.headers['x-request-id']).toBe('req-test-123');
    expect(response.headers['x-result']).toBe('yes');
    expect(JSON.parse(response.body)).toEqual({ query: { cursor: 'one', tag: ['a', 'b'] }, clientTraceId: 'client-trace-9' });
  });

  it('executes a required idempotent operation once through the injected store', async () => {
    const cached = new Map();
    const execute = vi.fn(async ({ key, operation }) => {
      if (!cached.has(key)) cached.set(key, await operation());
      return cached.get(key);
    });
    const server = api({ idempotencyStore: { execute } });
    const operation = vi.fn(() => ({ created: true }));
    server.router.post('/write', (ctx) => { expect(ctx.idempotencyKey).toBe('test-idempotency-key'); return operation(); }, { csrfExempt: true, idempotency: 'required' });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-idempotency-key' } }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-idempotency-key' } }));
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('returns validation failure rather than 500 for malformed route encoding', async () => {
    const server = api();
    server.router.get('/works/{id}', () => ({ ok: true }));
    const response = await server.handle(request({ path: '/api/v1/works/%E0%A4' }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).errorCode).toBe('VALIDATION_FAILED');
  });

  it('continues a request when the rate bucket accepts it', async () => {
    const server = api({ rateLimiter: { consume: vi.fn().mockResolvedValue({ accepted: true, retryAfterSeconds: 0 }) } });
    server.router.post('/submission', () => ({ ok: true }), { csrfExempt: true, rateLimit: { bucket: 'submission-ip', limit: 2, windowSeconds: 60 } });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/submission', headers: {} }));
    expect(response.statusCode).toBe(200);
  });
});
