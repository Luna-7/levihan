'use strict';

const crypto = require('crypto');
const { ApiError } = require('../../errors');
const { requireAdmin } = require('../works/service');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function buildCatalog(rows, version, generatedAt) {
  const works = rows
    .filter((work) => work.rating !== 'restricted')
    .map((work) => ({
      slug: work.slug, type: work.type, title: work.title, summary: work.summary, rating: work.rating,
      publishedAt: work.publishedAt,
      chapters: (work.chapters || []).map((chapter) => ({ title: chapter.title, position: chapter.position })).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
      assets: (work.assets || []).filter((asset) => asset.accessLevel === 'public' && asset.storageZone === 'public')
        .map((asset) => ({ kind: asset.kind, path: asset.objectKey, ...(asset.pageNo == null ? {} : { pageNo: asset.pageNo }), ...(asset.chapterPosition == null ? {} : { chapterPosition: asset.chapterPosition }) }))
        .sort((a, b) => (a.chapterPosition || 0) - (b.chapterPosition || 0) || (a.pageNo || 0) - (b.pageNo || 0) || a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const document = { schemaVersion: 1, version, generatedAt, works };
  const bytes = Buffer.from(canonicalJson(document));
  return { document, bytes, checksum: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function createSnapshotService({ repository, objectStore, now = () => new Date(), nonce = () => crypto.randomBytes(12).toString('hex') } = {}) {
  if (!repository || !objectStore) throw new Error('Snapshot repository and object store are required');
  return {
    async getCurrentCatalog() {
      const pointer = await repository.getCurrentSnapshot({ snapshotType: 'catalog' });
      if (!pointer) throw new ApiError(404, 'NOT_FOUND', 'Catalog snapshot is not available');
      return pointer;
    },
    async rebuildCatalog(ctx) {
      requireAdmin(ctx);
      const job = await repository.beginSnapshot({ snapshotType: 'catalog', actorId: ctx.actorId, requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey || null });
      try {
        if (job.state === 'prepared' || job.state === 'succeeded') {
          if (job.state === 'prepared') {
            await repository.completeSnapshot({ jobId: job.jobId, leaseToken: job.leaseToken, actorId: ctx.actorId, requestId: ctx.requestId });
          }
          return { version: job.version, checksum: job.checksum, objectKey: job.objectKey };
        }
        const rows = await repository.listPublicCatalog();
        const generatedAt = job.generatedAt || now().toISOString();
        const built = buildCatalog(rows, job.version, generatedAt);
        const versionKey = `snapshots/public/catalog.v${job.version}.json`;
        const immutable = await objectStore.putImmutable(versionKey, built.bytes, { cacheControl: 'public,max-age=31536000,immutable', version: job.version, schemaVersion: 1 });
        const checksum = immutable && immutable.checksum || built.checksum;
        await repository.prepareSnapshot({ jobId: job.jobId, leaseToken: job.leaseToken, snapshotType: 'catalog', version: job.version, objectKey: versionKey, checksum });
        await repository.completeSnapshot({ jobId: job.jobId, leaseToken: job.leaseToken, actorId: ctx.actorId, requestId: ctx.requestId });
        return { version: job.version, checksum, objectKey: versionKey };
      } catch (error) {
        await repository.failSnapshot(job.jobId, job.leaseToken, error instanceof ApiError ? error.errorCode : 'SNAPSHOT_DELIVERY_FAILED');
        throw error;
      }
    },
  };
}

function createSnapshotHttpService(service) {
  return { async rebuild(ctx) {
    if (ctx.body && (Object.getPrototypeOf(ctx.body) !== Object.prototype || Object.keys(ctx.body).length)) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body contains unsupported fields');
    return service.rebuildCatalog(ctx);
  }, async current() {
    const pointer = await service.getCurrentCatalog();
    return { statusCode: 200, headers: { 'cache-control': 'public,max-age=60,must-revalidate' }, body: pointer };
  } };
}

function createSnapshotTimerHandler({ service, actorId }) {
  if (!service || typeof service.rebuildCatalog !== 'function' || !/^[0-9a-f-]{36}$/i.test(actorId || '')) throw new Error('Snapshot timer service and system actor are required');
  return async (event) => {
    if (!event || event.type !== 'timer' || event.task !== 'catalog-snapshot' || Number.isNaN(Date.parse(event.scheduledAt))) throw new ApiError(400, 'VALIDATION_FAILED', 'Snapshot timer event is invalid');
    const key = `timer:${new Date(event.scheduledAt).toISOString()}`;
    return service.rebuildCatalog({ actorId, actorRole: 'admin', requestId: key, idempotencyKey: key });
  };
}

module.exports = { canonicalJson, buildCatalog, createSnapshotService, createSnapshotHttpService, createSnapshotTimerHandler };
