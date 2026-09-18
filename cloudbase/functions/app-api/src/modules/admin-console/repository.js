'use strict';
const { ApiError } = require('../../errors');
function first(data) { return Array.isArray(data) ? data[0] : data; }
function row(result) { if (!result || result.error) { const message = String(result && result.error && result.error.message || ''); if (message.includes('version_conflict')) throw new ApiError(409, 'VERSION_CONFLICT', 'Data changed; refresh and retry'); if (message.includes('normalization_conflict') || message.includes('invalid_')) throw new ApiError(400, 'VALIDATION_FAILED', 'Admin input is invalid'); if (message.includes('state_conflict') || message.includes('last_active_admin')) throw new ApiError(409, 'STATE_CONFLICT', message.includes('last_active_admin') ? 'At least one active administrator is required' : 'Operation is unavailable'); throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Admin storage unavailable'); } const value = first(result.data); if (!value) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Admin storage unavailable'); return value; }
const common = (item) => ({ id: item.id, status: item.status, version: Number(item.version || 1), createdAt: item.created_at, updatedAt: item.updated_at });
const user = (item) => ({ id: item.id, username: item.username, role: item.role, status: item.status, version: Number(item.version), createdAt: item.created_at, lastLoginAt: item.last_login_at || null, activeSessions: Number(item.active_sessions || 0) });
const question = (item) => ({ id: item.id, prompt: item.prompt, options: item.options, normalizationRule: item.normalization_rule, status: item.status, version: Number(item.version), samplingWeight: Number(item.sampling_weight), createdAt: item.created_at, updatedAt: item.updated_at });
function listing(result, mapper = common) { const value = row(result); return { items: (value.items || []).map(mapper), nextCursor: value.next_cursor || null }; }
function createAdminConsoleRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for admin console');
  const args = (input) => ({ p_admin_id: input.adminId, p_admin_session_id: input.adminSessionId, p_status: input.status, p_search: input.search, p_action: input.action, p_limit: input.limit, p_before_at: input.beforeAt, p_before_id: input.beforeId });
  const mutate = async (rpc, input, extra, mapper) => mapper(row(await rdb.rpc(rpc, { p_admin_id: input.adminId, p_admin_session_id: input.adminSessionId, ...extra, p_idempotency_key: input.idempotencyKey, p_request_hash: input.requestHash, p_request_id: input.requestId })));
  return {
    async dashboard(input) { const value = row(await rdb.rpc('admin_dashboard_v2', { p_admin_id: input.adminId, p_admin_session_id: input.adminSessionId })); return { counts: value.counts || {}, todos: value.todos || [], system: value.system || {}, recentAdminActions: value.recent_admin_actions || [] }; },
    async listUsers(input) { return listing(await rdb.rpc('admin_list_users_v2', args(input)), user); },
    async listQuestions(input) { return listing(await rdb.rpc('admin_list_questions_v2', args(input)), question); },
    async listComments(input) { return listing(await rdb.rpc('admin_list_comments_v2', args(input)), (x) => ({ ...common(x), body: x.body, workId: x.work_id, userId: x.user_id })); },
    async listReports(input) { return listing(await rdb.rpc('admin_list_reports_v2', args(input)), (x) => ({ ...common(x), reason: x.reason, targetType: x.target_type, targetId: x.target_id })); },
    async listJobs(input) { return listing(await rdb.rpc('admin_list_jobs_v2', args(input)), (x) => ({ id: x.id, kind: x.kind, status: x.status, attempts: Number(x.attempts), version: Number(x.version), updatedAt: x.updated_at, error: x.error || null })); },
    async listAudit(input) { return listing(await rdb.rpc('admin_list_audit_v2', args(input)), (x) => ({ id: x.id, actorId: x.actor_id || null, action: x.action, targetType: x.target_type, targetId: x.target_id || null, summary: x.summary || {}, createdAt: x.created_at })); },
    setUserStatus(input) { return mutate('admin_set_user_status_v2', input, { p_target_id: input.targetId, p_expected_version: input.expectedVersion, p_status: input.status, p_reason: input.reason }, user); },
    createQuestion(input) { return mutate('admin_create_question_v2', input, { p_prompt: input.prompt, p_options: input.options, p_answer_hashes: input.acceptedAnswerHashes, p_normalization_rule: input.normalizationRule, p_sampling_weight: input.samplingWeight }, question); },
    updateQuestion(input) { return mutate('admin_update_question_v2', input, { p_question_id: input.questionId, p_expected_version: input.expectedVersion, p_changes: input.changes }, question); },
    setQuestionStatus(input) { return mutate('admin_set_question_status_v2', input, { p_question_id: input.questionId, p_expected_version: input.expectedVersion, p_status: input.status }, question); },
    retryJob(input) { return mutate('admin_retry_job_v2', input, { p_job_id: input.jobId, p_expected_version: input.expectedVersion }, (x) => ({ id: x.id, kind: x.kind, status: x.status, attempts: Number(x.attempts), version: Number(x.version), updatedAt: x.updated_at, error: x.error || null })); },
  };
}
module.exports = { createAdminConsoleRepository };
