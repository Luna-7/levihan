'use strict';

const { ApiError } = require('../../errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORK_REF = /^(?:[0-9a-f-]{36}|[a-z0-9][a-z0-9-]{0,127})$/;
const REPORT_REASONS = new Set(['illegal', 'copyright', 'harassment', 'spam', 'other']);
function plain(value) { return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value, required, optional = []) { return plain(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)); }
function normalizedText(value, max, allowEmpty = false) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max && (allowEmpty || text.length > 0) ? text : null;
}
function requireActor(ctx) {
  if (!UUID.test(ctx.actorId || '') || !UUID.test(ctx.actorSessionId || '')) throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
}
function workRef(ctx) {
  const value = ctx.params && ctx.params.id;
  if (!WORK_REF.test(value || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Work reference is invalid');
  return value;
}
function validPosition(value) {
  if (!plain(value)) return false;
  if (value.kind === 'comic') return exact(value, ['kind', 'page']) && Number.isSafeInteger(value.page) && value.page >= 1 && value.page <= 100000;
  return value.kind === 'novel' && exact(value, ['kind', 'chapter', 'offset']) && Number.isSafeInteger(value.chapter) && value.chapter >= 1 && value.chapter <= 100000 && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 10000000;
}

function createInteractionsService({ repository }) {
  return {
    async setReaction(ctx, type, active) {
      requireActor(ctx);
      if (!['like', 'favorite'].includes(type) || typeof active !== 'boolean' || (ctx.body !== undefined && !exact(ctx.body, []))) throw new ApiError(400, 'VALIDATION_FAILED', 'Reaction input is invalid');
      return repository.setReaction({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workRef: workRef(ctx), type, active });
    },
    async listComments(ctx) {
      const limit = ctx.query.limit === undefined ? 20 : Number(ctx.query.limit);
      const cursor = ctx.query.cursor;
      const cursorParts = typeof cursor === 'string' ? cursor.split('|') : [];
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && (cursorParts.length !== 2 || Number.isNaN(Date.parse(cursorParts[0])) || !UUID.test(cursorParts[1])))) throw new ApiError(400, 'VALIDATION_FAILED', 'Comment cursor is invalid');
      return repository.listComments({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workRef: workRef(ctx), limit, beforeAt: cursorParts[0], beforeId: cursorParts[1] });
    },
    async createComment(ctx) {
      requireActor(ctx);
      if (!exact(ctx.body, ['body'], ['parentId'])) throw new ApiError(400, 'VALIDATION_FAILED', 'Comment input is invalid');
      const body = normalizedText(ctx.body.body, 500);
      if (!body || (ctx.body.parentId !== undefined && !UUID.test(ctx.body.parentId))) throw new ApiError(400, 'VALIDATION_FAILED', 'Comment input is invalid');
      return repository.createComment({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workRef: workRef(ctx), body, parentId: ctx.body.parentId, requestId: ctx.requestId });
    },
    async deleteComment(ctx) {
      requireActor(ctx);
      if (!UUID.test(ctx.params.id || '') || (ctx.body !== undefined && !exact(ctx.body, []))) throw new ApiError(400, 'VALIDATION_FAILED', 'Comment id is invalid');
      return repository.deleteComment({ userId: ctx.actorId, sessionId: ctx.actorSessionId, commentId: ctx.params.id, requestId: ctx.requestId });
    },
    async moderateComment(ctx, routeAction) {
      if (ctx.actorRole !== 'admin' || !UUID.test(ctx.params.id || '') || !exact(ctx.body, ['reason'])) throw new ApiError(400, 'VALIDATION_FAILED', 'Moderation input is invalid');
      const reason = normalizedText(ctx.body.reason, 500);
      if (!reason || !['hide', 'restore'].includes(routeAction)) throw new ApiError(400, 'VALIDATION_FAILED', 'Moderation input is invalid');
      return repository.moderateComment({ adminId: ctx.actorId, sessionId: ctx.actorSessionId, commentId: ctx.params.id, action: routeAction, reason, requestId: ctx.requestId });
    },
    async getProgress(ctx) {
      requireActor(ctx);
      return { progress: await repository.getProgress({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workRef: workRef(ctx) }) };
    },
    async putProgress(ctx) {
      requireActor(ctx);
      if (!exact(ctx.body, ['position', 'percent', 'logicVersion', 'clientVersion', 'baseVersion', 'mutationId']) || !validPosition(ctx.body.position)
        || typeof ctx.body.percent !== 'number' || !Number.isFinite(ctx.body.percent) || ctx.body.percent < 0 || ctx.body.percent > 100
        || !Number.isSafeInteger(ctx.body.logicVersion) || ctx.body.logicVersion < 1 || !Number.isSafeInteger(ctx.body.clientVersion) || ctx.body.clientVersion < 1
        || !Number.isSafeInteger(ctx.body.baseVersion) || ctx.body.baseVersion < 0
        || !UUID.test(ctx.body.mutationId) || ctx.idempotencyKey !== ctx.body.mutationId) throw new ApiError(400, 'VALIDATION_FAILED', 'Progress input is invalid');
      return repository.putProgress({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workRef: workRef(ctx), ...ctx.body });
    },
    async createReport(ctx) {
      requireActor(ctx);
      if (!exact(ctx.body, ['targetType', 'targetId', 'reason'], ['note']) || !['work', 'comment'].includes(ctx.body.targetType) || !UUID.test(ctx.body.targetId || '') || !REPORT_REASONS.has(ctx.body.reason)) throw new ApiError(400, 'VALIDATION_FAILED', 'Report input is invalid');
      const note = normalizedText(ctx.body.note || '', 500, true);
      if (note === null) throw new ApiError(400, 'VALIDATION_FAILED', 'Report input is invalid');
      return repository.createReport({ reporterId: ctx.actorId, sessionId: ctx.actorSessionId, targetType: ctx.body.targetType, targetId: ctx.body.targetId, reason: ctx.body.reason, note, requestId: ctx.requestId });
    },
    async moderateReport(ctx) {
      if (ctx.actorRole !== 'admin' || !UUID.test(ctx.params.id || '') || !exact(ctx.body, ['status', 'reason']) || !['reviewing', 'resolved', 'rejected'].includes(ctx.body.status)) throw new ApiError(400, 'VALIDATION_FAILED', 'Report moderation input is invalid');
      const reason = normalizedText(ctx.body.reason, 500);
      if (!reason) throw new ApiError(400, 'VALIDATION_FAILED', 'Report moderation input is invalid');
      return repository.moderateReport({ adminId: ctx.actorId, sessionId: ctx.actorSessionId, reportId: ctx.params.id, status: ctx.body.status, reason, requestId: ctx.requestId });
    },
  };
}

module.exports = { createInteractionsService };
