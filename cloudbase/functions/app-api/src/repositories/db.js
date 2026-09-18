'use strict';

function rows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result && result.data)) return result.data;
  return [];
}

function createRateLimitRepository({ query }) {
  if (typeof query !== 'function') throw new Error('A database query adapter is required');
  return {
    async consume({ subjectHash, bucket, windowSeconds, limit, now = new Date() }) {
      const sql = `WITH hit AS (
        INSERT INTO rate_limit_buckets (subject_hash, bucket, window_started_at, expires_at, hit_count)
        VALUES ($1, $2,
          to_timestamp(floor(extract(epoch FROM $3::timestamptz) / $4) * $4),
          to_timestamp(floor(extract(epoch FROM $3::timestamptz) / $4) * $4) + ($4 * interval '1 second'), 1)
        ON CONFLICT (subject_hash, bucket, window_started_at)
        DO UPDATE SET hit_count = rate_limit_buckets.hit_count + 1, updated_at = now()
        RETURNING hit_count, expires_at
      ) SELECT hit_count, expires_at FROM hit`;
      const result = await query(sql, [subjectHash, bucket, now.toISOString(), windowSeconds]);
      const row = rows(result)[0];
      if (!row) throw new Error('Rate-limit query returned no row');
      const accepted = Number(row.hit_count) <= limit;
      const retryAfterSeconds = accepted ? 0 : Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - now.getTime()) / 1000));
      return { accepted, retryAfterSeconds };
    },
  };
}

function createCloudBaseRateLimitRepository({ rdb }) {
  if (!rdb || typeof rdb.query !== 'function') {
    throw new Error('CloudBase rdb().query(sql, params) is required for rate limiting');
  }
  return createRateLimitRepository({ query: (sql, params) => rdb.query(sql, params) });
}

module.exports = { createRateLimitRepository, createCloudBaseRateLimitRepository };
