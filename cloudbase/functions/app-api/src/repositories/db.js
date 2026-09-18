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

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository };
