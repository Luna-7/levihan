'use strict';

const crypto = require('crypto');
const { ApiError } = require('../errors');

const SAFE_RESPONSE_HEADERS = new Set(['cache-control', 'content-type', 'etag']);
const SENSITIVE_FIELD = /recoverycode|signedurl|token|cookie|authorization|password|secret/i;
const SENSITIVE_STRING = /\bbearer\s+[A-Za-z0-9._~+/=-]+|[?&](?:x-amz-(?:signature|credential|security-token)|x-cos-(?:signature|security-token)|q-(?:signature|sign-algorithm|ak|key-time|sign-time)|signature|sig|sign|token)=/i;

class DependencyUnavailableError extends ApiError {
  constructor(cause) {
    super(503, 'DEPENDENCY_UNAVAILABLE', 'Idempotency storage unavailable');
    this.name = 'DependencyUnavailableError';
    const candidate = cause && typeof cause.name === 'string' ? cause.name : 'InvalidRpcResultError';
    this.cause = { name: /^[A-Za-z]+Error$/.test(candidate) ? candidate : 'DependencyError' };
  }
}

function dependencyError(cause) {
  return cause instanceof DependencyUnavailableError ? cause : new DependencyUnavailableError(cause);
}

function sensitiveFieldName(key) {
  return SENSITIVE_FIELD.test(String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase());
}

function containsSensitiveValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return SENSITIVE_STRING.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const sensitive = Array.isArray(value)
    ? value.some((item) => containsSensitiveValue(item, seen))
    : Object.entries(value).some(([key, item]) => sensitiveFieldName(key) || containsSensitiveValue(item, seen));
  seen.delete(value);
  return sensitive;
}

function sanitizeBody(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = sanitizeBody(item, seen);
  }
  seen.delete(value);
  return result;
}

function persistedResponse(response) {
  const custom = response && typeof response === 'object' && Object.hasOwn(response, 'statusCode') && Object.hasOwn(response, 'body');
  const body = custom ? response.body : (response === undefined ? null : response);
  const responseHeaders = custom && response.headers && typeof response.headers === 'object' ? response.headers : {};
  const unsafeHeader = Object.entries(responseHeaders).some(([key, value]) => sensitiveFieldName(key) || containsSensitiveValue(value));
  if (typeof body === 'string' || unsafeHeader || containsSensitiveValue(body)) return null;
  const headers = custom && response.headers && typeof response.headers === 'object'
    ? Object.fromEntries(Object.entries(response.headers)
      .map(([key, value]) => [key.toLowerCase(), value])
      .filter(([key]) => SAFE_RESPONSE_HEADERS.has(key)))
    : {};
  return {
    statusCode: custom && Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : 200,
    headers,
    body: sanitizeBody(body),
  };
}

function rpcBoolean(result, operation) {
  if (!result || result.error) throw dependencyError(result && result.error);
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  const value = data && typeof data === 'object' ? Object.values(data)[0] : data;
  if (value !== true) throw dependencyError({ name: 'InvalidRpcResultError' });
}

function createRateLimitRepository({ rpc }) {
  if (typeof rpc !== 'function') throw new Error('A database RPC adapter is required');
  return {
    async consume({ subjectHash, bucket, windowSeconds, limit, now = new Date() }) {
      const result = await rpc('consume_rate_limit_bucket', { p_subject_hash: subjectHash, p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit, p_now: now.toISOString() });
      if (result && result.error) throw new Error('Rate-limit RPC failed');
      const row = Array.isArray(result && result.data) ? result.data[0] : result && result.data;
      if (!row) throw new Error('Rate-limit RPC returned no row');
      return { accepted: Boolean(row.accepted), retryAfterSeconds: Number(row.retry_after_seconds || 0) };
    },
  };
}

function createCloudBaseRateLimitRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') {
    throw new Error('CloudBase rdb().rpc(name, params) is required for rate limiting');
  }
  return createRateLimitRepository({ rpc: (name, params) => rdb.rpc(name, params) });
}

function createCloudBaseActorResolver({ rdb, config }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc(name, params) is required for session resolution');
  if (!config || !config.sessionCookieName || !config.sessionHashPepper) throw new Error('Session resolver configuration is required');
  return async function resolveActor(context) {
    const token = context && context.cookies && context.cookies[config.sessionCookieName];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/.test(token)) return null;
    const tokenHash = crypto.createHmac('sha256', config.sessionHashPepper).update(token).digest('hex');
    let result;
    try { result = await rdb.rpc('resolve_user_session', { p_token_hash: tokenHash }); } catch (error) { throw dependencyError(error); }
    if (!result || result.error) throw dependencyError(result && result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return null;
    if (typeof row.user_id !== 'string' || !['member', 'admin'].includes(row.role)) throw dependencyError({ name: 'InvalidRpcResultError' });
    return { actorId: row.user_id, role: row.role };
  };
}

function createCloudBaseIdempotencyStore({ rdb, reportSecurityEvent = () => {} }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc(name, params) is required for idempotency');
  return { async execute({ scope, key, requestHash, actorScopeHash, operation }) {
    const params = { p_scope: scope, p_actor_scope_hash: actorScopeHash, p_idempotency_key: key, p_request_hash: requestHash };
    let begin;
    try { begin = await rdb.rpc('begin_idempotent_request', params); } catch (error) { throw dependencyError(error); }
    if (!begin || begin.error) throw dependencyError(begin && begin.error);
    const row = Array.isArray(begin.data) ? begin.data[0] : begin.data;
    if (!row || typeof row.state !== 'string') throw dependencyError({ name: 'InvalidRpcResultError' });
    if (row.state === 'completed') return row.response;
    if (row.state === 'in_progress' || row.state === 'request_hash_conflict') throw new ApiError(409, 'STATE_CONFLICT', 'Idempotency key is already in use');
    if (row.state !== 'acquired') throw dependencyError({ name: 'InvalidRpcResultError' });
    let response;
    try {
      response = await operation();
    } catch (error) {
      let failed;
      try { failed = await rdb.rpc('fail_idempotent_request', params); } catch (cause) { throw dependencyError(cause); }
      rpcBoolean(failed, 'Idempotency fail');
      throw error;
    }
    const safeResponse = persistedResponse(response);
    if (!safeResponse) {
      let failed;
      try { failed = await rdb.rpc('fail_idempotent_request', params); } catch (cause) { throw dependencyError(cause); }
      rpcBoolean(failed, 'Idempotency fail');
      try { reportSecurityEvent({ errorCode: 'IDEMPOTENCY_RESPONSE_REJECTED', errorType: 'SensitiveIdempotencyResponseError' }); } catch {}
      return response;
    }
    let complete;
    try { complete = await rdb.rpc('complete_idempotent_request', { ...params, p_response: safeResponse }); } catch (error) { throw dependencyError(error); }
    rpcBoolean(complete, 'Idempotency complete');
    return response;
  } };
}

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository, createCloudBaseActorResolver, createCloudBaseIdempotencyStore, persistedResponse, DependencyUnavailableError };
