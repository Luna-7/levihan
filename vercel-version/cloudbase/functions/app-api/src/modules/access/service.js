'use strict';

const { ApiError } = require('../../errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_HEADERS = Object.freeze({ 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', 'referrer-policy': 'no-referrer' });

function exactObject(value, fields) {
  return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every((key) => fields.includes(key));
}

function denied(decision) {
  const code = decision.errorCode || 'ACCESS_DENIED';
  const status = code === 'NOT_FOUND' ? 404 : code === 'SESSION_EXPIRED' ? 401 : code === 'ASSET_SET_CHANGED' ? 409 : 403;
  return new ApiError(status, code, code === 'AGE_CONSENT_REQUIRED' ? 'Current adult-content consent is required' : code === 'ASSET_SET_CHANGED' ? 'Content changed; request access again' : 'Access denied');
}

function createAccessService({ repository, objectStore }) {
  if (!repository || !objectStore) throw new Error('Access repository and object store are required');
  return {
    async getAgePolicy() {
      const policy = await repository.getAgePolicy();
      return { policyVersion: policy.version, warning: policy.warning, assurance: 'self_declaration_only' };
    },
    async acceptAgeConsent(ctx) {
      if (!exactObject(ctx.body, ['isAdult', 'policyVersion']) || ctx.body.isAdult !== true || typeof ctx.body.policyVersion !== 'string' || !ctx.body.policyVersion) throw new ApiError(400, 'VALIDATION_FAILED', 'Explicit adult self-declaration and policy version are required');
      const policy = await repository.getAgePolicy();
      if (ctx.body.policyVersion !== policy.version) throw new ApiError(409, 'STATE_CONFLICT', 'Age policy has changed');
      const result = await repository.setAgeConsent({ userId: ctx.actorId, policyVersion: policy.version, requestId: ctx.requestId });
      return { policyVersion: policy.version, acceptedAt: result.acceptedAt };
    },
    async revokeAgeConsent(ctx) {
      if (ctx.body !== undefined && !exactObject(ctx.body, [])) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be empty');
      return repository.revokeAgeConsent({ userId: ctx.actorId, requestId: ctx.requestId });
    },
    async getWorkAccess(ctx) {
      if (!UUID.test(ctx.params.id)) throw new ApiError(400, 'VALIDATION_FAILED', 'Work id is invalid');
      if (ctx.body !== undefined && !exactObject(ctx.body, [])) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be empty');
      if (!UUID.test(ctx.actorSessionId || '')) throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
      const authorized = await repository.authorizeWorkAccess({ userId: ctx.actorId, sessionId: ctx.actorSessionId, workId: ctx.params.id });
      if (!authorized.decision.allowed) throw denied(authorized.decision);
      const assets = await Promise.all(authorized.assets.map(async (asset) => {
        if (!asset.objectKey.startsWith(`protected/works/${ctx.params.id}/`)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Authorized asset boundary is invalid');
        const signed = await objectStore.signGet({ objectKey: asset.objectKey, expiresInSeconds: 300 });
        const { objectKey: _objectKey, ...safe } = asset;
        return { ...safe, url: signed.url, expiresAt: signed.expiresAt };
      }));
      // URLs are held only in this request's memory. The second database check
      // defines issuance; a concurrent revoke/archive before it discards them.
      const final = await repository.finalizeWorkAccess({ authorizationId: authorized.authorizationId, userId: ctx.actorId, sessionId: ctx.actorSessionId, workId: ctx.params.id });
      if (!final.allowed) throw denied(final);
      return { statusCode: 200, headers: ACCESS_HEADERS, body: { work: authorized.work, assets } };
    },
    async setRestrictedAccess(ctx, action) {
      if (ctx.actorRole !== 'admin') throw new ApiError(403, 'ACCESS_DENIED', 'Administrator access required');
      if (!UUID.test(ctx.params.id || '') || !['revoke', 'restore'].includes(action) || !exactObject(ctx.body, ['reason']) || typeof ctx.body.reason !== 'string' || ctx.body.reason.trim().length < 3 || ctx.body.reason.trim().length > 500) throw new ApiError(400, 'VALIDATION_FAILED', 'A valid user and reason are required');
      return repository.setRestrictedAccess({ adminId: ctx.actorId, userId: ctx.params.id, action, reason: ctx.body.reason.trim(), requestId: ctx.requestId });
    },
  };
}

module.exports = { ACCESS_HEADERS, createAccessService };
