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

function idempotent(mode = 'supported', bodyFields = ['ok']) {
  return { mode, responsePolicy: { statuses: [200, 201], bodyFields, headers: [] } };
}

function fakeIdempotencyStore() {
  const records = new Map();
  return {
    async execute({ scope, key, requestHash, actorScopeHash, operation }) {
      const recordKey = `${actorScopeHash}:${scope}:${key}`;
      const existing = records.get(recordKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, 'STATE_CONFLICT', 'Idempotency key conflicts with another request');
        if (existing.status === 'completed') return existing.response;
        throw new ApiError(409, 'STATE_CONFLICT', 'Idempotent request is already in progress');
      }
      records.set(recordKey, { status: 'processing', requestHash });
      try {
        const response = await operation();
        records.set(recordKey, { status: 'completed', requestHash, response });
        return response;
      } catch (error) {
        records.delete(recordKey);
        throw error;
      }
    },
  };
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
    server.router.post('/write', (ctx) => { expect(ctx.idempotencyKey).toBe('test-idempotency-key'); return operation(); }, { csrfExempt: true, idempotency: idempotent('required', ['created']) });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-idempotency-key' } }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-idempotency-key' } }));
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit positive response policy to replay a supported write once', async () => {
    const operation = vi.fn(() => ({ created: true }));
    const actorResolver = vi.fn(async () => 'member-42');
    const server = api({ idempotencyStore: fakeIdempotencyStore(), actorResolver });
    server.router.post('/write', operation, { csrfExempt: true, idempotency: idempotent('supported', ['created']) });
    const keyedRequest = request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers: { 'content-type': 'application/json', 'idempotency-key': 'default-key-01' } });

    const first = await server.handle(keyedRequest);
    const replay = await server.handle(keyedRequest);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(actorResolver).toHaveBeenCalledTimes(2);
  });

  it('does not collide across actors, actual route parameters, or sorted query values', async () => {
    const operation = vi.fn((ctx) => ({ actor: ctx.actorId, id: ctx.params.id, query: ctx.query }));
    let actor = 'member-a';
    const server = api({ idempotencyStore: fakeIdempotencyStore(), actorResolver: async () => actor });
    server.router.post('/works/{id}', operation, { csrfExempt: true, idempotency: idempotent('supported', ['actor', 'id', 'query']) });
    const keyed = { 'idempotency-key': 'shared-key-01' };

    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/works/work-a', headers: keyed, queryStringParameters: { page: '1' } }));
    actor = 'member-b';
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/works/work-a', headers: keyed, queryStringParameters: { page: '1' } }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/works/work-b', headers: keyed, queryStringParameters: { page: '1' } }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/works/work-b', headers: keyed, queryStringParameters: { page: '2' } }));

    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('canonicalizes query ordering for replay and passes only HMAC actor scopes to storage', async () => {
    const stored = fakeIdempotencyStore();
    const execute = vi.spyOn(stored, 'execute');
    const operation = vi.fn(() => ({ ok: true }));
    const server = api({ idempotencyStore: stored, actorResolver: async () => 'member-42' });
    server.router.post('/search', operation, { csrfExempt: true, idempotency: idempotent('supported', ['ok']) });
    const headers = { 'idempotency-key': 'query-key-01' };

    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/search', headers, multiValueQueryStringParameters: { tag: ['b', 'a'] }, queryStringParameters: { page: '1' } }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/search', headers, queryStringParameters: { page: '1' }, multiValueQueryStringParameters: { tag: ['a', 'b'] } }));

    expect(operation).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      actorScopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      scope: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(execute.mock.calls[0][0])).not.toContain('member-42');
  });

  it('returns 409 when the same actor, scope, and key are reused with a different body', async () => {
    const operation = vi.fn(() => ({ created: true }));
    const server = api({ idempotencyStore: fakeIdempotencyStore(), actorResolver: async () => 'member-42' });
    server.router.post('/write', operation, { csrfExempt: true, idempotency: idempotent('supported', ['created']) });
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'body-key-001' };

    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":1}', headers }));
    const conflict = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', body: '{"x":2}', headers }));

    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body).errorCode).toBe('STATE_CONFLICT');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('releases a failed operation so the same request can retry', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'STATE_CONFLICT', 'Try again'))
      .mockResolvedValueOnce({ created: true });
    const server = api({ idempotencyStore: fakeIdempotencyStore(), actorResolver: async () => 'member-42' });
    server.router.post('/write', operation, { csrfExempt: true, idempotency: idempotent('required', ['created']) });
    const keyedRequest = request({ httpMethod: 'POST', path: '/api/v1/write', headers: { 'idempotency-key': 'retry-key-01' } });

    expect((await server.handle(keyedRequest)).statusCode).toBe(409);
    expect((await server.handle(keyedRequest)).statusCode).toBe(200);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('requires a valid key, a store, and a trusted actor or client IP when idempotency is used', async () => {
    const server = api({ actorResolver: async () => null });
    server.router.post('/write', () => ({ ok: true }), { csrfExempt: true, idempotency: idempotent() });
    expect((await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', headers: { 'idempotency-key': 'short' } }))).statusCode).toBe(400);
    expect((await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', headers: { 'idempotency-key': 'valid-key-01' } }))).statusCode).toBe(503);

    const noIp = api({ idempotencyStore: fakeIdempotencyStore(), actorResolver: async () => null });
    noIp.router.post('/write', () => ({ ok: true }), { csrfExempt: true, idempotency: idempotent() });
    const missingIp = await noIp.handle(request({ httpMethod: 'POST', path: '/api/v1/write', requestContext: {}, headers: { 'idempotency-key': 'valid-key-01' } }));
    expect(missingIp.statusCode).toBe(503);
    expect(JSON.parse(missingIp.body).message).toBe('Service temporarily unavailable');
  });

  it('ignores idempotency keys only for routes explicitly marked none', async () => {
    const operation = vi.fn(() => ({ ok: true }));
    const server = api({ actorResolver: async () => null });
    server.router.post('/write', operation, { csrfExempt: true, idempotency: { mode: 'none' } });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', requestContext: {}, headers: { 'idempotency-key': 'ignored-key-01' } }));
    expect(response.statusCode).toBe(200);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('returns a safe 503 and safe diagnostics for an idempotency dependency failure', async () => {
    const secretMarker = ['test', 'sensitive', 'value'].join('-');
    const logger = { info: vi.fn(), error: vi.fn() };
    const dependencyError = new ApiError(503, 'DEPENDENCY_UNAVAILABLE', secretMarker);
    dependencyError.name = 'DependencyUnavailableError';
    const server = createApi({ config, requestId: () => 'dependency-request', logger, actorResolver: async () => 'member-42', idempotencyStore: { execute: async () => { throw dependencyError; } } });
    server.router.post('/write', () => ({ ok: true }), { csrfExempt: true, idempotency: idempotent() });

    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/write', headers: { 'idempotency-key': 'failure-key-01' } }));

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ errorCode: 'DEPENDENCY_UNAVAILABLE', message: 'Service temporarily unavailable', requestId: 'dependency-request' });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'DEPENDENCY_UNAVAILABLE', errorType: 'DependencyUnavailableError' }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretMarker);
  });

  it('documents auth registration/login/recovery and signed-access routes as non-replayable', async () => {
    const operation = vi.fn(() => ({ recoveryCode: 'test-sensitive-value' }));
    const execute = vi.fn();
    const server = api({ idempotencyStore: { execute }, actorResolver: async () => 'member-42' });
    for (const path of ['/auth/register', '/auth/login', '/auth/recovery', '/signed-access']) {
      server.router.post(path, operation, { csrfExempt: true, idempotency: { mode: 'none' } });
    }

    const responses = await Promise.all(['/auth/register', '/auth/login', '/auth/recovery', '/signed-access'].map((path) => (
      server.handle(request({ httpMethod: 'POST', path: `/api/v1${path}`, headers: { 'idempotency-key': 'ignored-key-02' } }))
    )));

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(operation).toHaveBeenCalledTimes(4);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns validation failure rather than 500 for malformed route encoding', async () => {
    const server = api();
    server.router.get('/works/{id}', () => ({ ok: true }));
    const response = await server.handle(request({ path: '/api/v1/works/%E0%A4' }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).errorCode).toBe('VALIDATION_FAILED');
  });

  it('rejects a keyed route with no response policy before its operation runs', async () => {
    const operation = vi.fn(() => ({ ok: true }));
    const execute = vi.fn();
    const server = api({ idempotencyStore: { execute }, actorResolver: async () => 'member-42' });
    // Legacy string metadata is readable, but cannot activate a keyed operation
    // unless it is migrated to the object form with a responsePolicy.
    server.router.post('/unconfigured', operation, { csrfExempt: true, idempotency: 'supported' });

    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/unconfigured', headers: { 'idempotency-key': 'no-policy-key-01' } }));

    expect(response.statusCode).toBe(500);
    expect(operation).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['recoveryCode', 'signedUrl', 'value.url', 'location', 'token'])('rejects unsafe idempotency allowlist field %s at route registration', (field) => {
    const server = api();
    expect(() => server.router.post('/invalid-policy', () => ({ id: '1' }), {
      csrfExempt: true,
      idempotency: { mode: 'required', responsePolicy: { statuses: [200], bodyFields: [field], headers: [] } },
    })).toThrow(/idempotency response policy/i);
  });

  it('rejects callback-like response policy configuration at route registration', () => {
    const server = api();
    expect(() => server.router.post('/invalid-policy', () => ({ id: '1' }), {
      csrfExempt: true,
      idempotency: { mode: 'required', responsePolicy: { statuses: [200], bodyFields: ['id'], project: () => ({}) } },
    })).toThrow(/idempotency response policy/i);
  });

  it('rejects Location even when a policy tries to allow it as a header', () => {
    const server = api();
    expect(() => server.router.post('/invalid-header-policy', () => ({ id: '1' }), {
      csrfExempt: true,
      idempotency: { mode: 'required', responsePolicy: { statuses: [200], bodyFields: ['id'], headers: ['location'] } },
    })).toThrow(/idempotency response policy/i);
  });

  it('continues a request when the rate bucket accepts it', async () => {
    const server = api({ rateLimiter: { consume: vi.fn().mockResolvedValue({ accepted: true, retryAfterSeconds: 0 }) } });
    server.router.post('/submission', () => ({ ok: true }), { csrfExempt: true, rateLimit: { bucket: 'submission-ip', limit: 2, windowSeconds: 60 } });
    const response = await server.handle(request({ httpMethod: 'POST', path: '/api/v1/submission', headers: {} }));
    expect(response.statusCode).toBe(200);
  });

  it('does not apply write default rate limits to GET routes or explicit false metadata', async () => {
    const consume = vi.fn().mockResolvedValue({ accepted: true });
    const server = api({ rateLimiter: { consume } });
    server.router.get('/submissions', () => ({ ok: true }));
    server.router.post('/submissions', () => ({ ok: true }), { csrfExempt: true, rateLimit: false });
    await server.handle(request({ path: '/api/v1/submissions' }));
    await server.handle(request({ httpMethod: 'POST', path: '/api/v1/submissions' }));
    expect(consume).not.toHaveBeenCalled();
  });
});
