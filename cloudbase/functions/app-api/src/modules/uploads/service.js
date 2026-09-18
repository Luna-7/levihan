'use strict';

const crypto = require('crypto');
const { ApiError } = require('../../errors');
const { requireAdmin } = require('../works/service');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKSUM = /^[a-f0-9]{64}$/;
const DECLARATIONS = Object.freeze({
  'image/jpeg': { extensions: new Set(['jpg', 'jpeg']), max: 20 * 1024 * 1024 },
  'image/png': { extensions: new Set(['png']), max: 20 * 1024 * 1024 },
  'image/webp': { extensions: new Set(['webp']), max: 20 * 1024 * 1024 },
  'image/gif': { extensions: new Set(['gif']), max: 20 * 1024 * 1024 },
  'text/plain': { extensions: new Set(['txt']), max: 5 * 1024 * 1024 },
  'application/epub+zip': { extensions: new Set(['epub']), max: 50 * 1024 * 1024 },
  'application/pdf': { extensions: new Set(['pdf']), max: 50 * 1024 * 1024 },
});
const KINDS = new Set(['cover', 'page', 'body', 'attachment', 'preview']);

function strictBody(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body contains unsupported fields');
  return value;
}

function validateDeclaration(body) {
  const allowed = ['workId', 'filename', 'mimeType', 'sizeBytes', 'checksum', 'kind', 'pageNo', 'chapterId', 'accessLevel'];
  strictBody(body, allowed);
  if (!UUID.test(body.workId || '') || !CHECKSUM.test(body.checksum || '') || !KINDS.has(body.kind) || !['public', 'private'].includes(body.accessLevel)) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload declaration is invalid');
  const filename = typeof body.filename === 'string' ? body.filename.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(filename) || filename.includes('..')) throw new ApiError(400, 'VALIDATION_FAILED', 'Filename is invalid');
  const extension = filename.split('.').pop();
  const policy = DECLARATIONS[body.mimeType];
  if (!policy) throw new ApiError(400, 'VALIDATION_FAILED', 'File type is not allowed');
  if (!policy.extensions.has(extension)) throw new ApiError(400, 'VALIDATION_FAILED', 'File extension does not match its MIME type');
  if (!Number.isSafeInteger(body.sizeBytes) || body.sizeBytes < 1) throw new ApiError(400, 'VALIDATION_FAILED', 'File size is invalid');
  if (body.sizeBytes > policy.max) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'File is too large');
  if (body.kind === 'page' && (!Number.isSafeInteger(body.pageNo) || body.pageNo < 1)) throw new ApiError(400, 'VALIDATION_FAILED', 'Page number is required');
  if (body.kind !== 'page' && body.pageNo != null) throw new ApiError(400, 'VALIDATION_FAILED', 'Page number is not allowed');
  if (body.chapterId != null && !UUID.test(body.chapterId)) throw new ApiError(400, 'VALIDATION_FAILED', 'Chapter ID is invalid');
  return { ...body, filename, extension };
}

function safeMessage(error) {
  const message = error && error.message;
  return typeof message === 'string' ? message.slice(0, 500) : 'Snapshot operation failed';
}

function createUploadsService({ repository, objectStore, now = () => new Date(), randomUUID = crypto.randomUUID } = {}) {
  if (!repository || !objectStore) throw new Error('Upload repository and object store are required');
  return {
    async initAdmin(ctx) {
      requireAdmin(ctx);
      const item = validateDeclaration(ctx.body);
      const uploadId = randomUUID();
      const fileId = randomUUID();
      const expiresAt = new Date(now().getTime() + 5 * 60 * 1000).toISOString();
      const objectKey = `staging/admin/${uploadId}/${fileId}.${item.extension}`;
      const created = await repository.createUpload({
        uploadId, fileId, ownerId: ctx.actorId, workId: item.workId, chapterId: item.chapterId || null,
        purpose: 'work_asset', objectKey, expectedSize: item.sizeBytes, mimeType: item.mimeType,
        checksum: item.checksum, kind: item.kind, pageNo: item.pageNo || null, accessLevel: item.accessLevel,
        expiresAt, requestId: ctx.requestId,
      });
      const actualUploadId = created.uploadId;
      const actualFileId = created.fileId;
      const actualKey = `staging/admin/${actualUploadId}/${actualFileId}.${item.extension}`;
      const ticket = await objectStore.signPut({ objectKey: actualKey, contentType: item.mimeType, contentLength: item.sizeBytes, checksum: item.checksum, expiresInSeconds: 300 });
      return { uploadId: actualUploadId, fileId: actualFileId, objectKey: actualKey, method: 'PUT', uploadUrl: ticket.url, headers: ticket.headers, expiresAt };
    },

    async completeAdmin(ctx) {
      requireAdmin(ctx);
      if (!UUID.test(ctx.params.id || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload ID is invalid');
      strictBody(ctx.body || {}, []);
      const upload = await repository.getUploadForCompletion({ uploadId: ctx.params.id, ownerId: ctx.actorId });
      if (!upload || upload.ownerId !== ctx.actorId || upload.status !== 'declared' || upload.purpose && upload.purpose !== 'work_asset' || new Date(upload.expiresAt) <= now()) throw new ApiError(409, 'STATE_CONFLICT', 'Upload is unavailable');
      if (!upload.objectKey.startsWith(`staging/admin/${upload.uploadId}/${upload.fileId}.`)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Upload object key is invalid');
      let metadata;
      try { metadata = await objectStore.head({ objectKey: upload.objectKey }); } catch (error) { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', safeMessage(error)); }
      if (!metadata || metadata.sizeBytes !== upload.expectedSize || String(metadata.contentType || '').toLowerCase() !== upload.mimeType || String(metadata.checksum || '').toLowerCase() !== upload.checksum) {
        throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object does not match its declaration');
      }
      return repository.completeAndBind({ uploadId: upload.uploadId, fileId: upload.fileId, workId: upload.workId, chapterId: upload.chapterId || null, actorId: ctx.actorId, requestId: ctx.requestId, objectKey: upload.objectKey, sizeBytes: metadata.sizeBytes, mimeType: metadata.contentType, checksum: metadata.checksum, etag: metadata.etag || null, kind: upload.kind, pageNo: upload.pageNo || null, accessLevel: upload.accessLevel });
    },
  };
}

module.exports = { createUploadsService, validateDeclaration, DECLARATIONS };
