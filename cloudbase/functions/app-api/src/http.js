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

function requestPath(event) {
  const raw = event.path || event.rawPath || '/';
  return String(raw).split('?')[0];
}

function parseBody(event, headers, limit) {
  if (event.body === undefined || event.body === null || event.body === '') return undefined;
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

function serialize(statusCode, headers, data) {
  return { statusCode, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
}

function createApi({ config, router = createRouter(), requestId = crypto.randomUUID, logger = { info() {}, error() {} }, rateLimiter } = {}) {
  if (!config) throw new Error('API configuration is required');
  async function handle(event = {}) {
    const startedAt = Date.now();
    const headers = normalizeHeaders(event.headers);
    const origin = headers.origin;
    const id = validRequestId(headers['x-request-id']) || requestId();
    const method = String(event.httpMethod || event.method || 'GET').toUpperCase();
    const path = requestPath(event);
    const responseHeaders = { ...securityHeaders(), ...corsHeaders(origin, config), 'x-request-id': id };
    let routePath = path;
    let status = 500;
    let errorCode;
    try {
      if (method === 'OPTIONS' && headers['access-control-request-method']) {
        if (!origin || !config.allowedOrigins.includes(origin)) throw new ApiError(403, 'ACCESS_DENIED', 'Origin is not allowed');
        status = 204;
        return { statusCode: 204, headers: responseHeaders, body: '' };
      }
      if (!path.startsWith(`${BASE_PATH}/`) && path !== BASE_PATH) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
      const relativePath = path.slice(BASE_PATH.length) || '/';
      routePath = relativePath;
      const body = parseBody(event, headers, config.bodyLimitBytes);
      const route = router.resolve(method, relativePath);
      if (!route) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
      routePath = route.path;
      const cookies = parseCookies(headers.cookie);
      if (WRITE_METHODS.has(method) && config.csrfRequired && !route.metadata.csrfExempt) requireCsrf(headers, cookies, config);
      const rateLimit = route.metadata.rateLimit || defaultRateLimitForRoute(route.path);
      if (rateLimit && rateLimiter) {
        const subject = (headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown').split(',')[0].trim();
        const limited = await rateLimiter.consume({ ...rateLimit, subjectHash: hashSubject(subject, config.rateLimitPepper) });
        if (!limited.accepted) {
          responseHeaders['retry-after'] = String(limited.retryAfterSeconds);
          throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
        }
      }
      const data = await route.handler({ method, path: relativePath, params: route.params, headers, cookies, body, requestId: id, setCookie() {} });
      status = 200;
      return serialize(status, responseHeaders, data === undefined ? null : data);
    } catch (error) {
      const mapped = errorResponse(error, id);
      status = mapped.status;
      errorCode = mapped.body.errorCode;
      return serialize(status, responseHeaders, mapped.body);
    } finally {
      const entry = { requestId: id, method, route: routePath, status, durationMs: Date.now() - startedAt, ...(errorCode ? { errorCode } : {}) };
      (status >= 500 ? logger.error : logger.info)(entry);
    }
  }
  return { router, handle };
}

module.exports = { BASE_PATH, createApi, normalizeHeaders, parseBody };
