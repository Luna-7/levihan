'use strict';

const { ApiError } = require('../../errors');

function row(result) {
  if (result && result.error) {
    const message = String(result.error.message || '');
    if (message.includes('policy_stale')) throw new ApiError(409, 'STATE_CONFLICT', 'Age policy has changed');
    if (message.includes('access_denied')) throw new ApiError(403, 'ACCESS_DENIED', 'Access denied');
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Access storage unavailable');
  }
  if (!result) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Access storage unavailable');
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

function createAccessRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for access');
  return {
    async getAgePolicy() {
      const value = row(await rdb.rpc('get_current_age_policy', {}));
      if (!value || typeof value.policy_version !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Age policy unavailable');
      return { version: value.policy_version, warning: value.warning };
    },
    async setAgeConsent({ userId, policyVersion, requestId }) {
      const value = row(await rdb.rpc('set_age_consent', { p_user_id: userId, p_policy_version: policyVersion, p_request_id: requestId }));
      if (!value || !value.accepted_at) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Age consent storage unavailable');
      return { acceptedAt: new Date(value.accepted_at).toISOString() };
    },
    async revokeAgeConsent({ userId, requestId }) {
      const value = row(await rdb.rpc('revoke_age_consent', { p_user_id: userId, p_request_id: requestId }));
      return { revoked: Boolean(value && (value.revoked ?? value.revoke_age_consent ?? value)) };
    },
    async authorizeWorkAccess({ userId, role, workId }) {
      const value = row(await rdb.rpc('authorize_work_access', { p_user_id: userId, p_work_id: workId, p_role: role }));
      if (!value) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Access authorization unavailable');
      return {
        authorizationId: value.authorization_id || null,
        decision: { allowed: value.allowed === true, errorCode: value.error_code || null },
        work: value.work_id ? { id: value.work_id, type: value.work_type, title: value.title, rating: value.rating } : null,
        assets: (value.assets || []).map((asset) => ({
          id: asset.id, kind: asset.kind, objectKey: asset.object_key, mimeType: asset.mime_type,
          ...(asset.page_no == null ? {} : { pageNo: Number(asset.page_no) }),
          ...(asset.chapter_position == null ? {} : { chapterPosition: Number(asset.chapter_position) }),
        })),
      };
    },
    async finalizeWorkAccess({ authorizationId, userId, workId }) {
      const value = row(await rdb.rpc('finalize_work_access', { p_authorization_id: authorizationId, p_user_id: userId, p_work_id: workId }));
      if (!value) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Access authorization unavailable');
      return { allowed: value.allowed === true, errorCode: value.error_code || null };
    },
  };
}

module.exports = { createAccessRepository };
