'use strict';

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
  return { async execute({ scope, key, requestHash, actorId, operation }) {
    const begin = await rdb.rpc('begin_idempotent_request', { p_scope: scope, p_actor_scope_hash: actorId || 'anonymous', p_idempotency_key: key, p_request_hash: requestHash });
    const row = Array.isArray(begin.data) ? begin.data[0] : begin.data;
    if (begin.error) throw new Error('Idempotency RPC failed');
    if (row.state === 'completed') return row.response;
    if (row.state === 'in_progress' || row.state === 'request_hash_conflict') { const error = new Error('Idempotency conflict'); error.status = 409; throw error; }
    try { const response = await operation(); await rdb.rpc('complete_idempotent_request', { p_scope: scope, p_actor_scope_hash: actorId || 'anonymous', p_idempotency_key: key, p_request_hash: requestHash, p_response: response }); return response; }
    catch (error) { await rdb.rpc('fail_idempotent_request', { p_scope: scope, p_actor_scope_hash: actorId || 'anonymous', p_idempotency_key: key, p_request_hash: requestHash }); throw error; }
  } };
}

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository, createCloudBaseIdempotencyStore };
