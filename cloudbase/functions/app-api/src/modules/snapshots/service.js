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
      assets: (work.assets || []).filter((asset) => asset.accessLevel === 'public')
        .map((asset) => ({ kind: asset.kind, path: asset.objectKey, ...(asset.pageNo == null ? {} : { pageNo: asset.pageNo }), ...(asset.chapterPosition == null ? {} : { chapterPosition: asset.chapterPosition }) }))
        .sort((a, b) => (a.pageNo || 0) - (b.pageNo || 0) || a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const document = { schemaVersion: 1, version, generatedAt, works };
  return { document, checksum: crypto.createHash('sha256').update(canonicalJson(document)).digest('hex') };
}

function createSnapshotService({ repository, objectStore, now = () => new Date(), nonce = () => crypto.randomBytes(12).toString('hex') } = {}) {
  if (!repository || !objectStore) throw new Error('Snapshot repository and object store are required');
  return {
    async rebuildCatalog(ctx) {
      requireAdmin(ctx);
      const job = await repository.beginSnapshot({ snapshotType: 'catalog', actorId: ctx.actorId, requestId: ctx.requestId });
      try {
        const rows = await repository.listPublicCatalog();
        const generatedAt = now().toISOString();
        const built = buildCatalog(rows, job.version, generatedAt);
        const temporaryKey = `snapshots/public/.tmp/catalog.v${job.version}.${nonce()}.json`;
        const versionKey = `snapshots/public/catalog.v${job.version}.json`;
        await objectStore.putJson(temporaryKey, built.document, { cacheControl: 'no-store' });
        await objectStore.putJson(versionKey, built.document, { cacheControl: 'public,max-age=31536000,immutable', sourceKey: temporaryKey });
        await repository.prepareSnapshot({ jobId: job.jobId, snapshotType: 'catalog', version: job.version, objectKey: versionKey, checksum: built.checksum });
        await repository.completeSnapshot({ jobId: job.jobId, actorId: ctx.actorId, requestId: ctx.requestId });
        const manifest = { schemaVersion: 1, catalog: { version: job.version, objectKey: versionKey, checksum: built.checksum } };
        await objectStore.putJson('snapshots/public/manifest.json', manifest, { cacheControl: 'public,max-age=60,must-revalidate' });
        try { await objectStore.delete(temporaryKey); } catch { /* lifecycle cleanup is a safe fallback */ }
        return { version: job.version, checksum: built.checksum, objectKey: versionKey };
      } catch (error) {
        await repository.failSnapshot(job.jobId, typeof error.message === 'string' ? error.message.slice(0, 500) : 'Snapshot operation failed');
        throw error;
      }
    },
  };
}

function createSnapshotHttpService(service) {
  return { async rebuild(ctx) {
    if (ctx.body && (Object.getPrototypeOf(ctx.body) !== Object.prototype || Object.keys(ctx.body).length)) throw new ApiError(400, 'VALIDATION_FAILED', 'Request body contains unsupported fields');
    return service.rebuildCatalog(ctx);
  } };
}

module.exports = { canonicalJson, buildCatalog, createSnapshotService, createSnapshotHttpService };
