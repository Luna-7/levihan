'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }
function unwrap(result) {
  if (!result || result.error) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
  return first(result.data);
}

function createSnapshotRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for snapshots');
  return {
    async beginSnapshot(input) {
      const row = unwrap(await rdb.rpc('begin_snapshot_build', { p_snapshot_type: input.snapshotType, p_actor_id: input.actorId, p_request_id: input.requestId }));
      if (!row || typeof row.job_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
      return { jobId: row.job_id, version: Number(row.version) };
    },
    async listPublicCatalog() {
      const row = unwrap(await rdb.rpc('list_public_catalog', {}));
      return Array.isArray(row) ? row : row && Array.isArray(row.items) ? row.items : [];
    },
    async prepareSnapshot(input) {
      const value = unwrap(await rdb.rpc('prepare_snapshot_version', { p_job_id: input.jobId, p_snapshot_type: input.snapshotType, p_version: input.version, p_object_key: input.objectKey, p_checksum: input.checksum }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
    },
    async completeSnapshot(input) {
      const value = unwrap(await rdb.rpc('complete_snapshot_build', { p_job_id: input.jobId, p_actor_id: input.actorId, p_request_id: input.requestId }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot storage unavailable');
    },
    async failSnapshot(jobId, message) {
      await rdb.rpc('fail_snapshot_build', { p_job_id: jobId, p_error: message });
    },
  };
}

module.exports = { createSnapshotRepository };
