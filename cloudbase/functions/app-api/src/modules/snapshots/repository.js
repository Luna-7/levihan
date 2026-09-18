'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }
function unwrap(result) {
  if (result && result.error) {
    const message = String(result.error.message || '');
    if (message.includes('snapshot_busy') || message.includes('snapshot_conflict')) throw new ApiError(409, message.includes('busy') ? 'SNAPSHOT_BUSY' : 'SNAPSHOT_CONFLICT', 'Snapshot operation conflicts with another worker');
  }
  if (!result || result.error) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
  return first(result.data);
}

function createSnapshotRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for snapshots');
  return {
    async beginSnapshot(input) {
      const row = unwrap(await rdb.rpc('begin_snapshot_build', { p_snapshot_type: input.snapshotType, p_actor_id: input.actorId, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey || null }));
      if (!row || typeof row.job_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
      return { jobId: row.job_id, version: Number(row.version), state: row.state || 'running', objectKey: row.object_key || null, checksum: row.checksum || null, leaseToken: row.lease_token, leaseEpoch: Number(row.lease_epoch || 0) };
    },
    async listPublicCatalog() {
      const row = unwrap(await rdb.rpc('list_public_catalog', {}));
      return Array.isArray(row) ? row : row && Array.isArray(row.items) ? row.items : [];
    },
    async prepareSnapshot(input) {
      const value = unwrap(await rdb.rpc('prepare_snapshot_version', { p_job_id: input.jobId, p_lease_token: input.leaseToken, p_snapshot_type: input.snapshotType, p_version: input.version, p_object_key: input.objectKey, p_checksum: input.checksum }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
    },
    async authorizeManifest(input) {
      const value = unwrap(await rdb.rpc('authorize_snapshot_manifest', { p_job_id: input.jobId, p_lease_token: input.leaseToken }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Snapshot lease is stale');
    },
    async completeSnapshot(input) {
      const value = unwrap(await rdb.rpc('complete_snapshot_build', { p_job_id: input.jobId, p_lease_token: input.leaseToken, p_actor_id: input.actorId, p_request_id: input.requestId }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
    },
    async failSnapshot(jobId, leaseToken, message) {
      const value = unwrap(await rdb.rpc('fail_snapshot_build', { p_job_id: jobId, p_lease_token: leaseToken, p_error: message }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
    },
  };
}

module.exports = { createSnapshotRepository };
