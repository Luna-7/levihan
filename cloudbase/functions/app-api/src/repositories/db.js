'use strict';

const { ApiError } = require('../errors');

const SAFE_RESPONSE_HEADERS = new Set(['cache-control', 'content-language', 'etag', 'last-modified', 'location', 'retry-after']);
const SENSITIVE_FIELD = /token|cookie|authorization/i;

function sanitizeBody(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SENSITIVE_FIELD.test(key)) result[key] = sanitizeBody(item, seen);
  }
  seen.delete(value);
  return result;
}

function persistedResponse(response) {
  const custom = response && typeof response === 'object' && Object.hasOwn(response, 'statusCode') && Object.hasOwn(response, 'body');
  const headers = custom && response.headers && typeof response.headers === 'object'
    ? Object.fromEntries(Object.entries(response.headers)
      .map(([key, value]) => [key.toLowerCase(), value])
      .filter(([key]) => SAFE_RESPONSE_HEADERS.has(key)))
    : {};
  return {
    statusCode: custom && Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : 200,
    headers,
    body: sanitizeBody(custom ? response.body : (response === undefined ? null : response)),
  };
}

function rpcBoolean(result, operation) {
  if (!result || result.error) throw new Error(`${operation} RPC failed`);
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  const value = data && typeof data === 'object' ? Object.values(data)[0] : data;
  if (value !== true) throw new Error(`${operation} RPC did not update the idempotency record`);
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

function createCloudBaseIdempotencyStore({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc(name, params) is required for idempotency');
  return { async execute({ scope, key, requestHash, actorScopeHash, operation }) {
    const params = { p_scope: scope, p_actor_scope_hash: actorScopeHash, p_idempotency_key: key, p_request_hash: requestHash };
    const begin = await rdb.rpc('begin_idempotent_request', params);
    if (!begin || begin.error) throw new Error('Idempotency begin RPC failed');
    const row = Array.isArray(begin.data) ? begin.data[0] : begin.data;
    if (!row || typeof row.state !== 'string') throw new Error('Idempotency begin RPC returned no state');
    if (row.state === 'completed') return row.response;
    if (row.state === 'in_progress' || row.state === 'request_hash_conflict') throw new ApiError(409, 'STATE_CONFLICT', 'Idempotency key is already in use');
    if (row.state !== 'acquired') throw new Error('Idempotency begin RPC returned an invalid state');
    let response;
    try {
      response = await operation();
    } catch (error) {
      await rdb.rpc('fail_idempotent_request', params);
      throw error;
    }
    const complete = await rdb.rpc('complete_idempotent_request', { ...params, p_response: persistedResponse(response) });
    rpcBoolean(complete, 'Idempotency complete');
    return response;
  } };
}

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository, createCloudBaseIdempotencyStore, persistedResponse };
