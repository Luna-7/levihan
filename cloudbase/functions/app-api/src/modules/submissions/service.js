'use strict';

const crypto = require('crypto');
const { ApiError } = require('../../errors');
const { DECLARATIONS, inspectStream, matchesFormat } = require('../uploads/service');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const TYPES = new Set(['comic', 'novel', 'recommendation', 'other']);
const RATINGS = new Set(['general', 'mature', 'restricted']);
const KINDS = new Set(['cover', 'page', 'body', 'attachment']);
const REVIEW_ACTIONS = new Set(['start_review', 'accept', 'reject']);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const NOVEL_MIMES = new Set(['text/plain', 'application/pdf', 'application/epub+zip']);

function exact(value, required, optional = []) { return value && Object.getPrototypeOf(value) === Object.prototype && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)); }
function text(value, max, empty = false) { if (typeof value !== 'string') return null; const normalized = value.trim().replace(/[\t\r\n ]+/g, ' '); return (empty || normalized) && normalized.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized) ? normalized : null; }
function actor(ctx, admin = false) { if (!ctx.actorId || !UUID.test(ctx.actorSessionId || '')) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required'); if (admin && ctx.actorRole !== 'admin') throw new ApiError(403, 'ACCESS_DENIED', 'Administrator access required'); }
function operation(ctx) { if (!/^[A-Za-z0-9_-]{8,128}$/.test(ctx.idempotencyKey || '') || !HASH.test(ctx.idempotencyRequestHash || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Operation identity is invalid'); }
function id(value, name = 'ID') { if (!UUID.test(value || '')) throw new ApiError(400, 'VALIDATION_FAILED', `${name} is invalid`); return value; }
function version(value) { if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'VALIDATION_FAILED', 'Version is invalid'); return value; }
function cursor(value) { if (!value) return [null, null]; const match = /^([^|]+)\|([0-9a-f-]{36})$/i.exec(value); if (!match || Number.isNaN(Date.parse(match[1])) || !UUID.test(match[2])) throw new ApiError(400, 'VALIDATION_FAILED', 'Cursor is invalid'); return [match[1], match[2]]; }

function draft(body, partial = false) {
  const required = partial ? ['version'] : ['type', 'title', 'summary', 'description', 'rating'];
  const optional = partial ? ['title', 'summary', 'description', 'rating'] : [];
  if (!exact(body, required, optional)) throw new ApiError(400, 'VALIDATION_FAILED', 'Submission input is invalid');
  if (!partial && !TYPES.has(body.type)) throw new ApiError(400, 'VALIDATION_FAILED', 'Submission type is invalid');
  const result = {};
  if (body.title !== undefined) { result.title = text(body.title, 120); if (!result.title) throw new ApiError(400, 'VALIDATION_FAILED', 'Title is invalid'); }
  if (body.summary !== undefined) { result.summary = text(body.summary, 2000, true); if (result.summary == null) throw new ApiError(400, 'VALIDATION_FAILED', 'Summary is invalid'); }
  if (body.description !== undefined) { result.description = text(body.description, 10000, true); if (result.description == null) throw new ApiError(400, 'VALIDATION_FAILED', 'Description is invalid'); }
  if (body.rating !== undefined) { if (!RATINGS.has(body.rating)) throw new ApiError(400, 'VALIDATION_FAILED', 'Rating is invalid'); result.rating = body.rating; }
  return result;
}

function upload(body) {
  if (!exact(body, ['submissionType', 'filename', 'mimeType', 'sizeBytes', 'checksum', 'kind'], ['pageNo'])) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload declaration is invalid');
  const filename = typeof body.filename === 'string' ? body.filename.trim().toLowerCase() : '';
  const extension = filename.split('.').pop(); const policy = DECLARATIONS[body.mimeType];
  if (!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(filename) || filename.includes('..') || !policy || !policy.extensions.has(extension) || !HASH.test(body.checksum || '') || !KINDS.has(body.kind)) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload declaration is invalid');
  if (!Number.isSafeInteger(body.sizeBytes) || body.sizeBytes < 1) throw new ApiError(400, 'VALIDATION_FAILED', 'File size is invalid');
  if (body.sizeBytes > policy.max) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'File is too large');
  if ((body.kind === 'page' && (!Number.isSafeInteger(body.pageNo) || body.pageNo < 1 || body.pageNo > 100000)) || (body.kind !== 'page' && body.pageNo != null)) throw new ApiError(400, 'VALIDATION_FAILED', 'Page number is invalid');
  const validForType = body.submissionType === 'comic' && (body.kind === 'page' || body.kind === 'cover') && IMAGE_MIMES.has(body.mimeType)
    || body.submissionType === 'novel' && (body.kind === 'body' && NOVEL_MIMES.has(body.mimeType) || body.kind === 'cover' && IMAGE_MIMES.has(body.mimeType))
    || ['recommendation', 'other'].includes(body.submissionType) && (body.kind === 'attachment' && (IMAGE_MIMES.has(body.mimeType) || NOVEL_MIMES.has(body.mimeType)) || body.kind === 'cover' && IMAGE_MIMES.has(body.mimeType));
  if (!validForType) throw new ApiError(400, 'VALIDATION_FAILED', 'Asset kind is not allowed for this submission type');
  return { ...body, filename, extension, pageNo: body.pageNo || null };
}

function createSubmissionsService({ repository, objectStore, now = () => new Date(), randomUUID = crypto.randomUUID } = {}) {
  if (!repository || !objectStore) throw new Error('Submission repository and object store are required');
  const transition = (action) => async (ctx) => { actor(ctx); operation(ctx); if (!exact(ctx.body, ['version'])) throw new ApiError(400, 'VALIDATION_FAILED', 'Transition input is invalid'); return repository.transition({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId: id(ctx.params.id, 'Submission ID'), expectedVersion: version(ctx.body.version), action, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash, requestId: ctx.requestId }); };
  return {
    async createDraft(ctx) { actor(ctx); operation(ctx); const input = draft(ctx.body); return repository.createDraft({ userId: ctx.actorId, sessionId: ctx.actorSessionId, type: ctx.body.type, title: input.title, summary: input.summary, payload: { description: input.description, rating: input.rating }, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash, requestId: ctx.requestId }); },
    async updateDraft(ctx) { actor(ctx); operation(ctx); const input = draft(ctx.body, true); if (Object.keys(input).length === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'No submission changes supplied'); return repository.updateDraft({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId: id(ctx.params.id, 'Submission ID'), expectedVersion: version(ctx.body.version), title: input.title ?? null, summary: input.summary ?? null, payload: { ...(input.description === undefined ? {} : { description: input.description }), ...(input.rating === undefined ? {} : { rating: input.rating }) }, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash, requestId: ctx.requestId }); },
    submit: transition('submit'),
    withdraw: transition('withdraw'),
    async listMine(ctx) { actor(ctx); const limit = ctx.query.limit === undefined ? 20 : Number(ctx.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'VALIDATION_FAILED', 'Limit is invalid'); const [beforeAt, beforeId] = cursor(ctx.query.cursor); return repository.listMine({ userId: ctx.actorId, sessionId: ctx.actorSessionId, limit, beforeAt, beforeId }); },
    async getMine(ctx) { actor(ctx); return repository.getMine({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId: id(ctx.params.id, 'Submission ID') }); },
    async listAdmin(ctx) { actor(ctx, true); const limit = ctx.query.limit === undefined ? 20 : Number(ctx.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'VALIDATION_FAILED', 'Limit is invalid'); const status = ctx.query.status || null; if (status && !['draft', 'submitted', 'under_review', 'accepted', 'rejected', 'withdrawn'].includes(status)) throw new ApiError(400, 'VALIDATION_FAILED', 'Status is invalid'); const [beforeAt, beforeId] = cursor(ctx.query.cursor); return repository.listAdmin({ adminId: ctx.actorId, adminSessionId: ctx.actorSessionId, status, limit, beforeAt, beforeId }); },
    async review(ctx) { actor(ctx, true); operation(ctx); if (!exact(ctx.body, ['version', 'action'], ['rejectionReason', 'internalNote']) || !REVIEW_ACTIONS.has(ctx.body.action)) throw new ApiError(400, 'VALIDATION_FAILED', 'Review input is invalid'); const rejectionReason = ctx.body.rejectionReason === undefined ? null : text(ctx.body.rejectionReason, 500); const internalNote = ctx.body.internalNote === undefined ? null : text(ctx.body.internalNote, 2000); if (ctx.body.action === 'reject' && !rejectionReason || ctx.body.action !== 'reject' && ctx.body.rejectionReason !== undefined || ctx.body.internalNote !== undefined && internalNote == null) throw new ApiError(400, 'VALIDATION_FAILED', 'Review reason is invalid'); const result = await repository.review({ adminId: ctx.actorId, adminSessionId: ctx.actorSessionId, submissionId: id(ctx.params.id, 'Submission ID'), expectedVersion: version(ctx.body.version), action: ctx.body.action, rejectionReason, internalNote, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash, requestId: ctx.requestId }); return result; },
    async initUpload(ctx) { actor(ctx); operation(ctx); const item = upload(ctx.body); const newUploadId = randomUUID(); const newFileId = randomUUID(); const expiresAt = new Date(now().getTime() + 300000).toISOString(); const objectKey = `staging/submissions/${ctx.actorId}/${id(ctx.params.id, 'Submission ID')}/${newUploadId}/${newFileId}.${item.extension}`; const created = await repository.createUpload({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId: ctx.params.id, submissionType: item.submissionType, uploadId: newUploadId, fileId: newFileId, purpose: 'submission_asset', objectKey, expectedSize: item.sizeBytes, mimeType: item.mimeType, checksum: item.checksum, kind: item.kind, pageNo: item.pageNo, expiresAt, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash, requestId: ctx.requestId }); if (created.state === 'bound') return { uploadId: created.uploadId, fileId: created.fileId, status: 'verified' }; if (created.state === 'promoting') return { uploadId: created.uploadId, fileId: created.fileId, status: 'processing' }; const ticket = await objectStore.signPost({ objectKey: created.objectKey || objectKey, contentType: item.mimeType, contentLength: item.sizeBytes, checksum: item.checksum, expiresInSeconds: 300 }); return { uploadId: created.uploadId, fileId: created.fileId, objectKey: created.objectKey || objectKey, method: 'POST', uploadUrl: ticket.url, fields: ticket.fields, expiresAt: created.expiresAt || expiresAt }; },
    async completeUpload(ctx) {
      actor(ctx); operation(ctx); if (!exact(ctx.body || {}, [])) throw new ApiError(400, 'VALIDATION_FAILED', 'Completion input is invalid'); const submissionId = id(ctx.params.id, 'Submission ID'); const uploadId = id(ctx.params.uploadId, 'Upload ID'); const item = await repository.getUpload({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId, uploadId }); if (item?.status === 'bound') return { fileId: item.fileId, status: 'verified' }; if (!item || item.ownerId !== ctx.actorId || item.purpose !== 'submission_asset' || !['declared', 'promoting'].includes(item.status) || item.status === 'declared' && new Date(item.expiresAt) <= now() || !item.objectKey.startsWith(`staging/submissions/${ctx.actorId}/${submissionId}/${uploadId}/`)) throw new ApiError(409, 'STATE_CONFLICT', 'Upload is unavailable');
      let promotion = item.status === 'promoting' ? { promotionToken: item.promotionToken, objectKey: item.finalObjectKey, storageZone: item.storageZone } : null;
      if (!promotion) { let meta; let inspected; try { meta = await objectStore.head({ objectKey: item.objectKey }); inspected = await inspectStream(await objectStore.read({ objectKey: item.objectKey }), item.expectedSize, item.mimeType); } catch { throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object could not be verified'); } if (!meta || meta.sizeBytes !== item.expectedSize || String(meta.contentType || '').toLowerCase() !== item.mimeType || inspected.size !== item.expectedSize || inspected.checksum !== item.checksum || !matchesFormat(item.mimeType, inspected.sample, inspected.unsafeText)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object does not match its declaration'); const extension = item.objectKey.split('.').pop(); promotion = await repository.beginPromotion({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId, uploadId, fileId: item.fileId, promotionToken: randomUUID(), objectKey: `protected/works/${submissionId}/${item.fileId}.${extension}`, sizeBytes: inspected.size, checksum: inspected.checksum, etag: meta.etag || null }); }
      try { await objectStore.promote({ sourceKey: item.objectKey, destinationKey: promotion.objectKey, storageZone: 'private', contentType: item.mimeType }); } catch { try { await objectStore.headFinal({ objectKey: promotion.objectKey, storageZone: 'private' }); } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Object storage unavailable'); } }
      let finalMeta; let inspected; try { finalMeta = await objectStore.headFinal({ objectKey: promotion.objectKey, storageZone: 'private' }); inspected = await inspectStream(await objectStore.readFinal({ objectKey: promotion.objectKey, storageZone: 'private' }), item.expectedSize, item.mimeType); } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Promoted object unavailable'); } if (finalMeta.sizeBytes !== item.expectedSize || String(finalMeta.contentType || '').toLowerCase() !== item.mimeType || inspected.checksum !== item.checksum || !matchesFormat(item.mimeType, inspected.sample, inspected.unsafeText)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Promoted object does not match its declaration'); const result = await repository.completeUpload({ userId: ctx.actorId, sessionId: ctx.actorSessionId, submissionId, uploadId, fileId: item.fileId, promotionToken: promotion.promotionToken, objectKey: promotion.objectKey, storageZone: 'private', sizeBytes: finalMeta.sizeBytes, checksum: inspected.checksum, etag: finalMeta.etag || null, requestId: ctx.requestId }); try { await objectStore.delete(item.objectKey); } catch { /* lifecycle cleanup fallback */ } return result;
    },
  };
}

module.exports = { createSubmissionsService };
