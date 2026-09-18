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

async function inspectStream(value, max, mime) {
  const hash = crypto.createHash('sha256');
  let total = 0;
  let sample = Buffer.alloc(0);
  let unsafeText = false;
  let textTail = '';
  const source = Buffer.isBuffer(value) ? [value] : value;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > max) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object is invalid');
    hash.update(bytes);
    if (sample.length < 16) sample = Buffer.concat([sample, bytes.subarray(0, 16 - sample.length)]);
    if (mime === 'text/plain') {
      if (bytes.includes(0)) unsafeText = true;
      const text = (textTail + bytes.toString('utf8')).toLowerCase();
      if (/<(?:!doctype\s+html|html|script|iframe|svg)\b/.test(text)) unsafeText = true;
      textTail = text.slice(-64);
    }
  }
  return { size: total, checksum: hash.digest('hex'), sample, unsafeText };
}

function matchesFormat(mime, bytes, unsafeText = false) {
  const hex = bytes.subarray(0, 16).toString('hex');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'application/epub+zip') return hex.startsWith('504b0304');
  if (mime === 'text/plain') return !unsafeText;
  return false;
}

function createUploadsService({ repository, objectStore, now = () => new Date(), randomUUID = crypto.randomUUID } = {}) {
  if (!repository || !objectStore) throw new Error('Upload repository and object store are required');
  return {
    async initAdmin(ctx) {
      requireAdmin(ctx);
      if (!CHECKSUM.test(ctx.idempotencyRequestHash || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload operation hash is invalid');
      const item = validateDeclaration(ctx.body);
      const uploadId = randomUUID();
      const fileId = randomUUID();
      const expiresAt = new Date(now().getTime() + 5 * 60 * 1000).toISOString();
      const objectKey = `staging/admin/${uploadId}/${fileId}.${item.extension}`;
      const created = await repository.createUpload({
        uploadId, fileId, ownerId: ctx.actorId, workId: item.workId, chapterId: item.chapterId || null,
        purpose: 'work_asset', objectKey, expectedSize: item.sizeBytes, mimeType: item.mimeType,
        checksum: item.checksum, kind: item.kind, pageNo: item.pageNo || null, accessLevel: item.accessLevel,
        expiresAt, requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, requestHash: ctx.idempotencyRequestHash,
      });
      const actualUploadId = created.uploadId;
      const actualFileId = created.fileId;
      if (created.state === 'bound' && created.assetId) return { uploadId: actualUploadId, fileId: actualFileId, assetId: created.assetId, status: 'verified' };
      const actualKey = created.objectKey || `staging/admin/${actualUploadId}/${actualFileId}.${item.extension}`;
      const ticket = await objectStore.signPut({ objectKey: actualKey, contentType: item.mimeType, contentLength: item.sizeBytes, checksum: item.checksum, expiresInSeconds: 300 });
      return { uploadId: actualUploadId, fileId: actualFileId, objectKey: actualKey, method: 'PUT', uploadUrl: ticket.url, headers: ticket.headers, expiresAt: created.expiresAt || expiresAt };
    },

    async completeAdmin(ctx) {
      requireAdmin(ctx);
      if (!UUID.test(ctx.params.id || '')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload ID is invalid');
      strictBody(ctx.body || {}, []);
      const upload = await repository.getUploadForCompletion({ uploadId: ctx.params.id, ownerId: ctx.actorId });
      if (upload && upload.ownerId === ctx.actorId && upload.status === 'bound' && upload.assetId) return { assetId: upload.assetId, status: 'verified' };
      if (!upload || upload.ownerId !== ctx.actorId || !['declared', 'promoting'].includes(upload.status) || upload.purpose && upload.purpose !== 'work_asset' || (upload.status === 'declared' && new Date(upload.expiresAt) <= now())) throw new ApiError(409, 'STATE_CONFLICT', 'Upload is unavailable');
      if (!upload.objectKey.startsWith(`staging/admin/${upload.uploadId}/${upload.fileId}.`)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Upload object key is invalid');
      const extension = upload.objectKey.split('.').pop();
      const storageZone = upload.accessLevel === 'public' ? 'public' : 'private';
      const objectKey = `${storageZone === 'public' ? 'media' : 'protected'}/works/${upload.workId}/${upload.fileId}.${extension}`;
      let promotion = upload.status === 'promoting' ? { promotionToken: upload.promotionToken, objectKey: upload.finalObjectKey, storageZone: upload.storageZone, state: 'promoting' } : null;
      if (!promotion) {
        let metadata; let inspected;
        try { metadata = await objectStore.head({ objectKey: upload.objectKey }); } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Object storage unavailable'); }
        if (!metadata || metadata.sizeBytes !== upload.expectedSize || String(metadata.contentType || '').toLowerCase() !== upload.mimeType) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object does not match its declaration');
        try { inspected = await inspectStream(await objectStore.read({ objectKey: upload.objectKey }), upload.expectedSize, upload.mimeType); } catch { throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object could not be verified'); }
        if (inspected.size !== upload.expectedSize || inspected.checksum !== upload.checksum || !matchesFormat(upload.mimeType, inspected.sample, inspected.unsafeText)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Uploaded object does not match its declaration');
        promotion = await repository.beginPromotion({ uploadId: upload.uploadId, fileId: upload.fileId, actorId: ctx.actorId, promotionToken: randomUUID(), objectKey, storageZone, sizeBytes: metadata.sizeBytes, mimeType: metadata.contentType, checksum: inspected.checksum, etag: metadata.etag || null, contentDisposition: ['application/pdf', 'application/epub+zip'].includes(upload.mimeType) ? 'attachment' : null });
      }
      try { await objectStore.promote({ sourceKey: upload.objectKey, destinationKey: promotion.objectKey, storageZone: promotion.storageZone, contentType: upload.mimeType }); } catch {
        try { await objectStore.headFinal({ objectKey: promotion.objectKey, storageZone: promotion.storageZone }); } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Object storage unavailable'); }
      }
      let finalMetadata; let finalInspected;
      try {
        finalMetadata = await objectStore.headFinal({ objectKey: promotion.objectKey, storageZone: promotion.storageZone });
        finalInspected = await inspectStream(await objectStore.readFinal({ objectKey: promotion.objectKey, storageZone: promotion.storageZone }), upload.expectedSize, upload.mimeType);
      } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Promoted object unavailable'); }
      if (finalMetadata.sizeBytes !== upload.expectedSize || finalInspected.checksum !== upload.checksum || !matchesFormat(upload.mimeType, finalInspected.sample, finalInspected.unsafeText)) throw new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Promoted object does not match its declaration');
      const result = await repository.completeAndBind({ uploadId: upload.uploadId, fileId: upload.fileId, workId: upload.workId, chapterId: upload.chapterId || null, actorId: ctx.actorId, requestId: ctx.requestId, promotionToken: promotion.promotionToken, objectKey: promotion.objectKey, storageZone: promotion.storageZone, sizeBytes: finalMetadata.sizeBytes, mimeType: upload.mimeType, checksum: finalInspected.checksum, etag: finalMetadata.etag || null, kind: upload.kind, pageNo: upload.pageNo || null, accessLevel: upload.accessLevel });
      try { await objectStore.delete(upload.objectKey); } catch { /* private staging lifecycle is the fallback */ }
      return result;
    },
  };
}

module.exports = { createUploadsService, validateDeclaration, matchesFormat, DECLARATIONS };
