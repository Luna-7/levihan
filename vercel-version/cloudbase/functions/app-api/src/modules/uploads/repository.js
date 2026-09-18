'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }
function unwrap(result) {
  if (result && result.error) {
    const message = String(result.error.message || '');
    if (message.includes('idempotency_conflict')) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request');
    if (/upload_unavailable|upload_state_conflict|state_conflict|slot_conflict/.test(message)) throw new ApiError(409, 'STATE_CONFLICT', 'Upload state conflicts with this operation');
    if (/upload_not_verified|asset_policy_invalid|storage_zone_invalid|restricted_storage_invalid|page_sequence_invalid|body_cardinality_invalid/.test(message)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object violates content policy');
  }
  if (!result || result.error) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
  return first(result.data);
}
function unwrapRows(result) {
  if (result && result.error) unwrap(result);
  if (!result) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
  if (result.data == null) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
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
        p_expires_at: input.expiresAt, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash,
      }));
      if (!row || typeof row.upload_id !== 'string' || typeof row.file_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
      return { uploadId: row.upload_id, fileId: row.file_id,
        ...(row.object_key ? { objectKey: row.object_key } : {}), ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
        state: row.state || 'declared', ...(row.asset_id ? { assetId: row.asset_id } : {}) };
    },
    async getUploadForCompletion({ uploadId, ownerId }) {
      const row = unwrap(await rdb.rpc('get_work_upload_for_completion', { p_upload_id: uploadId, p_owner_id: ownerId }));
      if (!row) return null;
      return {
        uploadId: row.upload_id, fileId: row.file_id, ownerId: row.owner_id, purpose: row.purpose,
        workId: row.work_id, chapterId: row.chapter_id, objectKey: row.object_key, expectedSize: Number(row.expected_size),
        mimeType: row.mime_type, checksum: row.expected_checksum, kind: row.kind, pageNo: row.page_no,
        accessLevel: row.access_level, expiresAt: row.expires_at, status: row.status, assetId: row.asset_id,
        finalObjectKey: row.final_object_key, storageZone: row.storage_zone, promotionToken: row.promotion_token,
      };
    },
    async beginPromotion(input) {
      const row = unwrap(await rdb.rpc('begin_work_upload_promotion', {
        p_upload_id: input.uploadId, p_file_id: input.fileId, p_actor_id: input.actorId, p_promotion_token: input.promotionToken,
        p_object_key: input.objectKey, p_storage_zone: input.storageZone, p_actual_size: input.sizeBytes,
        p_mime_type: input.mimeType, p_checksum: input.checksum, p_etag: input.etag,
        p_content_disposition: input.contentDisposition,
      }));
      if (!row || typeof row.promotion_token !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
      return { promotionToken: row.promotion_token, objectKey: row.object_key, storageZone: row.storage_zone, state: row.state };
    },
    async completeAndBind(input) {
      const row = unwrap(await rdb.rpc('complete_work_upload', {
        p_upload_id: input.uploadId, p_file_id: input.fileId, p_actor_id: input.actorId,
        p_work_id: input.workId, p_chapter_id: input.chapterId || null, p_promotion_token: input.promotionToken, p_object_key: input.objectKey, p_storage_zone: input.storageZone,
        p_actual_size: input.sizeBytes, p_mime_type: input.mimeType, p_checksum: input.checksum,
        p_etag: input.etag, p_kind: input.kind, p_page_no: input.pageNo || null,
        p_access_level: input.accessLevel, p_request_id: input.requestId,
      }));
      if (!row || typeof row.asset_id !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Upload storage unavailable');
      return { assetId: row.asset_id, status: row.status };
    },
    async claimStalePromotions({ actorId, limit }) {
      const rows = unwrapRows(await rdb.rpc('claim_stale_upload_promotions', { p_actor_id: actorId, p_limit: limit }));
      return rows.map((row) => ({ uploadId: row.upload_id, fileId: row.file_id, stagingKey: row.staging_key, finalKey: row.final_key, storageZone: row.storage_zone, cleanupToken: row.cleanup_token }));
    },
    async finalizePromotionCleanup({ fileId, cleanupToken, actorId }) {
      const value = unwrap(await rdb.rpc('finalize_upload_promotion_cleanup', { p_file_id: fileId, p_cleanup_token: cleanupToken, p_actor_id: actorId }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(409, 'STATE_CONFLICT', 'Promotion cleanup lease is stale');
    },
    async failPromotionCleanup({ fileId, cleanupToken, actorId, errorCode }) {
      const value = unwrap(await rdb.rpc('fail_upload_promotion_cleanup', { p_file_id: fileId, p_cleanup_token: cleanupToken, p_actor_id: actorId, p_error_code: errorCode }));
      if (value !== true && !(value && Object.values(value)[0] === true)) throw new ApiError(409, 'STATE_CONFLICT', 'Promotion cleanup lease is stale');
    },
  };
}

module.exports = { createUploadsRepository };
