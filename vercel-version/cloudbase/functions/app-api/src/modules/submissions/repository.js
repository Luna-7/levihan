'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }
function unwrap(result) {
  if (result && result.error) {
    const message = String(result.error.message || '');
    if (/idempotency_conflict/.test(message)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request');
    if (/version_conflict/.test(message)) throw new ApiError(409, 'VERSION_CONFLICT', 'Submission changed; reload before retrying');
    if (/daily_quota_exceeded/.test(message)) throw new ApiError(429, 'RATE_LIMITED', 'Daily submission quota reached');
    if (/assets_incomplete|upload_not_verified/.test(message)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Required submission assets are unavailable');
    if (/state_conflict|upload_unavailable/.test(message)) throw new ApiError(409, 'STATE_CONFLICT', 'Submission state conflicts with this operation');
    if (/not_found/.test(message)) throw new ApiError(404, 'NOT_FOUND', 'Submission not found');
    if (/access_denied/.test(message) || result.error.code === '42501') throw new ApiError(403, 'ACCESS_DENIED', 'Submission access denied');
  }
  if (!result || result.error) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Submission storage unavailable');
  return first(result.data);
}

function mapAsset(row) {
  return { fileId: row.file_id, kind: row.kind, pageNo: row.page_no == null ? null : Number(row.page_no), status: row.status, mimeType: row.mime_type, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes) };
}

function mapSubmission(row, { admin = false } = {}) {
  if (!row) return null;
  const result = {
    id: row.id, type: row.type, title: row.title, summary: row.summary || '', status: row.status,
    version: Number(row.version), assetCount: Number(row.asset_count || 0),
    payload: row.payload && Object.getPrototypeOf(row.payload) === Object.prototype ? { description: String(row.payload.description || ''), rating: row.payload.rating } : { description: '', rating: 'general' },
    assets: Array.isArray(row.assets) ? row.assets.map(mapAsset) : [],
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
    acceptedWorkId: row.accepted_work_id || null,
    ...(row.created_at ? { createdAt: new Date(row.created_at).toISOString() } : {}),
    ...(row.updated_at ? { updatedAt: new Date(row.updated_at).toISOString() } : {}),
  };
  if (admin) { result.userId = row.user_id; result.internalNote = row.internal_note || null; }
  return result;
}

function createSubmissionsRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for submissions');
  const call = async (name, params) => mapSubmission(unwrap(await rdb.rpc(name, params)));
  const getMine = async (input) => mapSubmission(unwrap(await rdb.rpc('get_my_submission_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId })));
  return {
    async createDraft(input) { const created = await call('create_submission_draft_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_type: input.type, p_title: input.title, p_summary: input.summary, p_payload: input.payload, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId }); return getMine({ ...input, submissionId: created.id }); },
    async updateDraft(input) { await call('update_submission_draft_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_expected_version: input.expectedVersion, p_title: input.title, p_summary: input.summary, p_payload: input.payload, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId }); return getMine(input); },
    transition(input) { return call('transition_submission_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_expected_version: input.expectedVersion, p_action: input.action, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId }); },
    review(input) { return call('review_submission_v2', { p_admin_id: input.adminId, p_admin_session_id: input.adminSessionId, p_submission_id: input.submissionId, p_expected_version: input.expectedVersion, p_action: input.action, p_rejection_reason: input.rejectionReason || null, p_internal_note: input.internalNote || null, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId }); },
    async listMine(input) { const row = unwrap(await rdb.rpc('list_my_submissions_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_limit: input.limit, p_before_at: input.beforeAt, p_before_id: input.beforeId })); return { items: (row?.items || []).map(mapSubmission), nextCursor: row?.next_cursor || null }; },
    getMine,
    async listAdmin(input) { const row = unwrap(await rdb.rpc('list_admin_submissions_v2', { p_admin_id: input.adminId, p_admin_session_id: input.adminSessionId, p_status: input.status, p_limit: input.limit, p_before_at: input.beforeAt, p_before_id: input.beforeId })); return { items: (row?.items || []).map((item) => mapSubmission(item, { admin: true })), nextCursor: row?.next_cursor || null }; },
    async createUpload(input) { const row = unwrap(await rdb.rpc('create_submission_upload_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_submission_type: input.submissionType, p_upload_id: input.uploadId, p_file_id: input.fileId, p_object_key: input.objectKey, p_expected_size: input.expectedSize, p_mime_type: input.mimeType, p_checksum: input.checksum, p_kind: input.kind, p_page_no: input.pageNo, p_expires_at: input.expiresAt, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId })); return { uploadId: row.upload_id, fileId: row.file_id, state: row.state, objectKey: row.object_key, expiresAt: row.expires_at }; },
    async getUpload(input) { const row = unwrap(await rdb.rpc('get_submission_upload_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_upload_id: input.uploadId })); return row && { uploadId: row.upload_id, fileId: row.file_id, submissionId: row.submission_id, ownerId: row.owner_id, purpose: row.purpose, objectKey: row.object_key, expectedSize: Number(row.expected_size), mimeType: row.mime_type, checksum: row.expected_checksum, kind: row.submission_kind, pageNo: row.submission_page_no, expiresAt: row.expires_at, status: row.status, promotionToken: row.promotion_token, finalObjectKey: row.final_object_key, storageZone: row.storage_zone }; },
    async beginPromotion(input) { const row = unwrap(await rdb.rpc('begin_submission_upload_promotion_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_upload_id: input.uploadId, p_file_id: input.fileId, p_promotion_token: input.promotionToken, p_object_key: input.objectKey, p_actual_size: input.sizeBytes, p_checksum: input.checksum, p_etag: input.etag || null })); return { promotionToken: row.promotion_token, objectKey: row.object_key, storageZone: row.storage_zone }; },
    async completeUpload(input) { const row = unwrap(await rdb.rpc('complete_submission_upload_v2', { p_user_id: input.userId, p_session_id: input.sessionId, p_submission_id: input.submissionId, p_upload_id: input.uploadId, p_file_id: input.fileId, p_promotion_token: input.promotionToken, p_object_key: input.objectKey, p_actual_size: input.sizeBytes, p_checksum: input.checksum, p_etag: input.etag || null, p_request_id: input.requestId })); return { fileId: row.file_id, status: row.status }; },
  };
}

module.exports = { createSubmissionsRepository, mapSubmission };
