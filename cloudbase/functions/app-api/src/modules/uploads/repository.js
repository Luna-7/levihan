'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }
function unwrap(result) {
  if (!result || result.error) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
  return first(result.data);
}

function createUploadsRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for uploads');
  return {
    async createUpload(input) {
      const row = unwrap(await rdb.rpc('create_work_upload', {
        p_upload_id: input.uploadId, p_file_id: input.fileId, p_owner_id: input.ownerId,
        p_work_id: input.workId, p_chapter_id: input.chapterId || null, p_object_key: input.objectKey,
        p_expected_size: input.expectedSize, p_mime_type: input.mimeType, p_expected_checksum: input.checksum,
        p_kind: input.kind, p_page_no: input.pageNo || null, p_access_level: input.accessLevel,
        p_expires_at: input.expiresAt, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey,
      }));
      if (!row || typeof row.upload_id !== 'string' || typeof row.file_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
      return { uploadId: row.upload_id, fileId: row.file_id,
        ...(row.object_key ? { objectKey: row.object_key } : {}), ...(row.expires_at ? { expiresAt: row.expires_at } : {}) };
    },
    async getUploadForCompletion({ uploadId, ownerId }) {
      const row = unwrap(await rdb.rpc('get_work_upload_for_completion', { p_upload_id: uploadId, p_owner_id: ownerId }));
      if (!row) return null;
      return {
        uploadId: row.upload_id, fileId: row.file_id, ownerId: row.owner_id, purpose: row.purpose,
        workId: row.work_id, chapterId: row.chapter_id, objectKey: row.object_key, expectedSize: Number(row.expected_size),
        mimeType: row.mime_type, checksum: row.expected_checksum, kind: row.kind, pageNo: row.page_no,
        accessLevel: row.access_level, expiresAt: row.expires_at, status: row.status, assetId: row.asset_id,
        finalObjectKey: row.final_object_key, storageZone: row.storage_zone,
      };
    },
    async completeAndBind(input) {
      const row = unwrap(await rdb.rpc('complete_work_upload', {
        p_upload_id: input.uploadId, p_file_id: input.fileId, p_actor_id: input.actorId,
        p_work_id: input.workId, p_chapter_id: input.chapterId || null, p_staging_object_key: input.stagingObjectKey, p_object_key: input.objectKey, p_storage_zone: input.storageZone,
        p_actual_size: input.sizeBytes, p_mime_type: input.mimeType, p_checksum: input.checksum,
        p_etag: input.etag, p_kind: input.kind, p_page_no: input.pageNo || null,
        p_access_level: input.accessLevel, p_request_id: input.requestId,
      }));
      if (!row || typeof row.asset_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
      return { assetId: row.asset_id, status: row.status };
    },
  };
}

module.exports = { createUploadsRepository };
