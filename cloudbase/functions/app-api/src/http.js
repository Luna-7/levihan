'use strict';

const crypto = require('crypto');
const { ApiError, errorResponse } = require('./errors');
const { createRouter } = require('./router');
const { parseCookies, requireCsrf, securityHeaders } = require('./security');
const { hashSubject, defaultRateLimitForRoute } = require('./rate-limit');

const BASE_PATH = '/api/v1';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(',') : String(value)]));
}

function corsHeaders(origin, config) {
  if (!origin || !config.allowedOrigins.includes(origin)) return { vary: 'Origin' };
  return {
    vary: 'Origin',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Idempotency-Key, X-CSRF-Token, X-Request-Id',
    'access-control-max-age': '600',
  };
}

function requestPath(event, gatewayPath) {
  const raw = event.path || event.rawPath || '/';
  return String(raw).split('?')[0];
}

function queryFromEvent(event) {
  const query = { ...(event.queryStringParameters || {}) };
  for (const [key, values] of Object.entries(event.multiValueQueryStringParameters || {})) query[key] = values;
  return query;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalQuery(query) {
  return Object.fromEntries(Object.keys(query).sort().map((key) => {
    const value = query[key];
    return [key, Array.isArray(value) ? value.map(String).sort() : String(value)];
  }));
}

function normalizedActualPath(path) {
  return path.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function actorScopeHash(actorId, ip, pepper) {
  const subject = actorId == null ? `ip:${ip}` : `actor:${actorId}`;
  return crypto.createHmac('sha256', pepper).update(subject).digest('hex');
}

function parseBody(event, headers, limit) {
  if (event.body === undefined || event.body === null || event.body === '') return undefined;
  if (typeof event.body === 'object' && !Buffer.isBuffer(event.body)) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be encoded text');
  const body = Buffer.isBuffer(event.body) ? event.body : Buffer.from(String(event.body), event.isBase64Encoded ? 'base64' : 'utf8');
  if (body.length > limit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  const text = body.toString('utf8');
  if (headers['content-type'] && headers['content-type'].toLowerCase().includes('application/json')) {
    try { return JSON.parse(text); } catch { throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid JSON body'); }
  }
  return text;
}

function validRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function serialize(statusCode, headers, data, cookies = []) {
  return { statusCode, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, ...(cookies.length ? { multiValueHeaders: { 'set-cookie': cookies } } : {}), body: statusCode === 204 ? '' : JSON.stringify(data) };
}

function trustedIp(event, headers, config) {
  const context = event.requestContext || {};
  const ip = context.identity && context.identity.sourceIp || context.http && context.http.sourceIp;
  if (ip) return ip;
  if (config.trustedProxyHeaders) return (headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim();
  return '';
}
function createApi({ config, router = createRouter(), requestId = crypto.randomUUID, logger = { info() {}, error() {} }, rateLimiter, idempotencyStore, actorResolver = async () => null } = {}) {
  if (!config) throw new Error('API configuration is required');
  async function handle(event = {}) {
    const startedAt = Date.now();
    const headers = normalizeHeaders(event.headers);
    const origin = headers.origin;
    const clientTraceId = validRequestId(headers['x-request-id']) || undefined;
    const id = requestId();
    const method = String(event.httpMethod || event.method || 'GET').toUpperCase();
    const gatewayPath = config.gatewayPath || BASE_PATH;
    const path = requestPath(event, gatewayPath);
    const responseHeaders = { ...securityHeaders(), ...corsHeaders(origin, config), 'x-request-id': id };
    let routePath = path;
    let status = 500;
    let errorCode;
    let actorId;
    let errorType;
    try {
      if (method === 'OPTIONS' && headers['access-control-request-method']) {
        if (!origin || !config.allowedOrigins.includes(origin)) throw new ApiError(403, 'ACCESS_DENIED', 'Origin is not allowed');
        if (!path.startsWith(`${gatewayPath}/`) && path !== gatewayPath) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
        const preflightPath = path.slice(gatewayPath.length) || '/';
        if (!router.resolve(headers['access-control-request-method'], preflightPath)) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
        const allowed = new Set(['content-type', 'idempotency-key', 'x-csrf-token', 'x-request-id']);
        if ((headers['access-control-request-headers'] || '').split(',').filter(Boolean).some((name) => !allowed.has(name.trim().toLowerCase()))) throw new ApiError(403, 'ACCESS_DENIED', 'Requested header is not allowed');
        status = 204;
        return { statusCode: 204, headers: responseHeaders, body: '' };
      }
      if (!path.startsWith(`${gatewayPath}/`) && path !== gatewayPath) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
      const relativePath = path.slice(gatewayPath.length) || '/';
      routePath = relativePath;
      const body = parseBody(event, headers, config.bodyLimitBytes);
      const route = router.resolve(method, relativePath);
      if (!route) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
      routePath = route.path;
      const cookies = parseCookies(headers.cookie);
      if (WRITE_METHODS.has(method) && config.csrfRequired && !route.metadata.csrfExempt) requireCsrf(headers, cookies, config);
      const setCookies = [];
      const query = queryFromEvent(event);
      const clientIp = trustedIp(event, headers, config);
      const context = {
        method, path: relativePath, params: route.params, headers, cookies, body, query, requestId: id,
        clientTraceId, idempotencyKey: headers['idempotency-key'], config, clientIp,
        setCookie: (cookie) => setCookies.push(cookie),
        setActor: (value) => { actorId = value == null ? undefined : String(value); context.actorId = actorId; },
      };
      const resolvedActor = await actorResolver(context);
      if (resolvedActor != null) {
        actorId = String(typeof resolvedActor === 'object' ? resolvedActor.actorId : resolvedActor);
        context.actorId = actorId;
        if (typeof resolvedActor === 'object' && resolvedActor.role !== undefined) context.actorRole = resolvedActor.role;
      }
      if (route.metadata.sessionRequired && actorId == null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
      if (route.metadata.role !== undefined && context.actorRole !== route.metadata.role) throw new ApiError(403, 'ACCESS_DENIED', 'Insufficient permissions');
      const rateLimit = route.metadata.rateLimit ?? defaultRateLimitForRoute(method, route.path);
      if (rateLimit && rateLimiter) {
        const ip = clientIp;
        if (!ip) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Trusted client IP is unavailable');
        const policies = Array.isArray(rateLimit) ? rateLimit : [rateLimit];
        for (const policy of policies) {
          const subject = policy.subject === 'username' ? String(body && body.username || '').trim().toLowerCase() : ip;
          if (!subject) throw new ApiError(400, 'VALIDATION_FAILED', 'Username is required for login');
          const limited = await rateLimiter.consume({ ...policy, subjectHash: hashSubject(subject, config.rateLimitPepper), requestId: id });
          if (!limited.accepted) {
            responseHeaders['retry-after'] = String(limited.retryAfterSeconds);
            throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
          }
        }
      }
      const operation = () => route.handler(context);
      let data;
      // Auth recovery/login/register and signed-access routes return non-replayable
      // credentials and must register `{ idempotency: { mode: 'none' } }`.
      const idempotency = route.metadata.idempotency;
      context.idempotencyPolicy = idempotency;
      const key = headers['idempotency-key'];
      const useIdempotency = idempotency.mode === 'required' || (idempotency.mode === 'supported' && key !== undefined);
      if (useIdempotency) {
        if (!idempotency.responsePolicy) throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotency response policy is required');
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(key || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid Idempotency-Key');
        if (!idempotencyStore) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Idempotency storage unavailable');
        const ip = clientIp;
        if (actorId == null && !ip) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Trusted client identity is unavailable');
        const scopeActorHash = actorScopeHash(actorId, ip, config.sessionHashPepper);
        const requestIdentity = {
          method,
          actualPath: normalizedActualPath(relativePath),
          params: canonicalValue(route.params),
          query: canonicalQuery(query),
          routeTemplate: route.path,
          actorScopeHash: scopeActorHash,
        };
        data = await idempotencyStore.execute({
          scope: digest(requestIdentity),
          key,
          requestHash: digest({ ...requestIdentity, body: body === undefined ? null : body }),
          actorScopeHash: scopeActorHash,
          responsePolicy: idempotency.responsePolicy,
          cookieQueue: setCookies,
          operation,
        });
      } else data = await operation();
      const custom = data && typeof data === 'object' && Object.hasOwn(data, 'statusCode') && Object.hasOwn(data, 'body');
      status = custom ? data.statusCode : 200;
      return serialize(status, { ...responseHeaders, ...(custom ? data.headers : {}) }, custom ? data.body : (data === undefined ? null : data), setCookies);
    } catch (error) {
      errorType = error && error.name || 'Error';
      const mapped = errorResponse(error, id);
      status = mapped.status;
      errorCode = mapped.body.errorCode;
      return serialize(status, responseHeaders, mapped.body);
    } finally {
      const entry = { requestId: id, method, route: routePath, status, durationMs: Date.now() - startedAt, environment: config.environment, timestamp: new Date().toISOString(), ...(actorId ? { actorId } : {}), ...(errorCode ? { errorCode } : {}), ...(status >= 500 ? { errorType: errorType || 'Error' } : {}) };
      (status >= 500 ? logger.error : logger.info)(entry);
    }
  }
  return { router, handle };
}

module.exports = { BASE_PATH, createApi, normalizeHeaders, parseBody };
