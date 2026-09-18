'use strict';

const crypto = require('crypto');
const { ApiError } = require('../errors');
const { validateResponsePolicy } = require('../router');


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

function isPlainObject(value) {
  return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
}

function matchesDescriptor(value, descriptor) {
  if (descriptor.enum) return descriptor.enum.includes(value);
  if (descriptor.type === 'boolean') return typeof value === 'boolean';
  if (descriptor.type === 'integer') return Number.isSafeInteger(value);
  if (descriptor.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (descriptor.type === 'uuid') return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  return validIsoDate(value);
}

// This is a positive projector, not a response scrubber: all response keys and
// headers must be declared by the route policy before an idempotency record exists.
function projectIdempotencyResponse(response, responsePolicy) {
  const policy = validateResponsePolicy(responsePolicy);
  const custom = isPlainObject(response) && Object.hasOwn(response, 'statusCode') && Object.hasOwn(response, 'body');
  const statusCode = custom ? response.statusCode : 200;
  const body = custom ? response.body : response;
  const responseHeaders = custom && response.headers !== undefined ? response.headers : {};
  if (!policy.statuses.includes(statusCode) || !isPlainObject(body) || !isPlainObject(responseHeaders)) return null;
  const headerEntries = Object.entries(responseHeaders).map(([key, value]) => [key.toLowerCase(), value]);
  if (new Set(headerEntries.map(([key]) => key)).size !== headerEntries.length
    || headerEntries.some(([key, value]) => !policy.headers.includes(key) || typeof value !== 'string' || value.length > 256)) return null;
  const bodyEntries = Object.entries(body);
  if (bodyEntries.some(([key, value]) => !Object.hasOwn(policy.body, key) || !matchesDescriptor(value, policy.body[key]))) return null;
  return {
    statusCode,
    headers: Object.fromEntries(headerEntries.filter(([key]) => policy.headers.includes(key))),
    body: Object.fromEntries(Object.keys(policy.body).filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])),
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
  return { async execute({ scope, key, requestHash, actorScopeHash, responsePolicy, cookieQueue, operation }) {
    // Validate before begin so a misconfigured caller can never acquire a lease or run a handler.
    const policy = validateResponsePolicy(responsePolicy);
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
    const projectedResponse = projectIdempotencyResponse(response, policy);
    if (!projectedResponse || (Array.isArray(cookieQueue) && cookieQueue.length > 0)) {
      let failed;
      try { failed = await rdb.rpc('fail_idempotent_request', params); } catch (cause) { throw dependencyError(cause); }
      rpcBoolean(failed, 'Idempotency fail');
      try { reportSecurityEvent({ errorCode: 'IDEMPOTENCY_RESPONSE_REJECTED', errorType: 'IdempotencyResponsePolicyError' }); } catch {}
      return response;
    }
    let complete;
    try { complete = await rdb.rpc('complete_idempotent_request', { ...params, p_response: projectedResponse }); } catch (error) { throw dependencyError(error); }
    rpcBoolean(complete, 'Idempotency complete');
    return response;
  } };
}

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository, createCloudBaseActorResolver, createCloudBaseIdempotencyStore, projectIdempotencyResponse, DependencyUnavailableError };
