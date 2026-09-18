'use strict';

const { ApiError } = require('../../errors');

function rows(result) {
  if (result && result.error) {
    const message = String(result.error.message || '').toLowerCase();
    if (message.includes('age_consent_required')) throw new ApiError(403, 'AGE_CONSENT_REQUIRED', 'Current adult-content consent is required');
    if (message.includes('session_expired')) throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
    if (message.includes('access_denied')) throw new ApiError(403, 'ACCESS_DENIED', 'Access denied');
    if (message.includes('not_found')) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    if (message.includes('rate_limited')) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    if (message.includes('state_conflict')) throw new ApiError(409, 'STATE_CONFLICT', 'State has changed');
    if (message.includes('validation_failed')) throw new ApiError(400, 'VALIDATION_FAILED', 'Input is invalid');
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Interaction storage unavailable');
  }
  if (!result) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Interaction storage unavailable');
  if (result.data == null) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}
const first = (result) => rows(result)[0];
const iso = (value) => new Date(value).toISOString();

function createInteractionsRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for interactions');
  return {
    async setReaction({ userId, sessionId, workRef, type, active }) {
      const value = first(await rdb.rpc('set_work_reaction_v2', { p_user_id: userId, p_session_id: sessionId, p_work_ref: workRef, p_reaction_type: type, p_active: active }));
      if (!value || typeof value.active !== 'boolean') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Interaction storage unavailable');
      return { active: value.active, count: Number(value.reaction_count) };
    },
    async listComments({ userId, sessionId, workRef, limit, beforeAt, beforeId }) {
      const values = rows(await rdb.rpc('list_work_comments_v2', { p_user_id: userId || null, p_session_id: sessionId || null, p_work_ref: workRef, p_limit: limit, p_before_at: beforeAt || null, p_before_id: beforeId || null }));
      return {
        items: values.map((value) => ({ id: value.id, authorName: value.author_name, body: value.body, createdAt: iso(value.created_at) })),
        count: values.length ? Number(values[0].published_count) : 0,
        nextCursor: values.length === limit ? `${iso(values[values.length - 1].created_at)}|${values[values.length - 1].id}` : null,
      };
    },
    async createComment({ userId, sessionId, workRef, body, parentId, requestId }) {
      const value = first(await rdb.rpc('create_work_comment_v2', { p_user_id: userId, p_session_id: sessionId, p_work_ref: workRef, p_body: body, p_parent_id: parentId || null, p_request_id: requestId }));
      return { id: value.id, status: value.status, createdAt: iso(value.created_at) };
    },
    async deleteComment({ userId, sessionId, commentId, requestId }) {
      const value = first(await rdb.rpc('delete_work_comment_v2', { p_user_id: userId, p_session_id: sessionId, p_comment_id: commentId, p_request_id: requestId }));
      return { id: value.id, status: value.status };
    },
    async moderateComment({ adminId, sessionId, commentId, action, reason, requestId }) {
      const value = first(await rdb.rpc('moderate_work_comment_v2', { p_admin_id: adminId, p_session_id: sessionId, p_comment_id: commentId, p_action: action, p_reason: reason, p_request_id: requestId }));
      return { id: value.id, status: value.status };
    },
    async getProgress({ userId, sessionId, workRef }) {
      const value = first(await rdb.rpc('get_reading_progress_v2', { p_user_id: userId, p_session_id: sessionId, p_work_ref: workRef }));
      return value ? { position: value.position_data, percent: Number(value.percent), logicVersion: Number(value.logic_version), clientVersion: Number(value.client_version), mutationId: value.client_mutation_id, version: Number(value.server_version), updatedAt: iso(value.updated_at) } : null;
    },
    async putProgress({ userId, sessionId, workRef, position, percent, logicVersion, clientVersion, baseVersion, mutationId }) {
      const value = first(await rdb.rpc('sync_reading_progress_v2', { p_user_id: userId, p_session_id: sessionId, p_work_ref: workRef, p_position: position, p_percent: percent, p_logic_version: logicVersion, p_client_version: clientVersion, p_base_server_version: baseVersion, p_mutation_id: mutationId }));
      return { accepted: value.accepted, position: value.position_data, percent: Number(value.percent), logicVersion: Number(value.logic_version), clientVersion: Number(value.client_version), mutationId: value.client_mutation_id, version: Number(value.server_version), updatedAt: iso(value.updated_at) };
    },
    async createReport({ reporterId, sessionId, targetType, targetId, reason, note, requestId }) {
      const value = first(await rdb.rpc('create_interaction_report_v2', { p_reporter_id: reporterId, p_session_id: sessionId, p_target_type: targetType, p_target_id: targetId, p_reason: reason, p_note: note || '', p_request_id: requestId }));
      return { id: value.id, status: value.status, duplicate: value.duplicate };
    },
    async moderateReport({ adminId, sessionId, reportId, status, reason, requestId }) {
      const value = first(await rdb.rpc('moderate_interaction_report_v2', { p_admin_id: adminId, p_session_id: sessionId, p_report_id: reportId, p_status: status, p_reason: reason, p_request_id: requestId }));
      return { id: value.id, status: value.status };
    },
  };
}

module.exports = { createInteractionsRepository };
