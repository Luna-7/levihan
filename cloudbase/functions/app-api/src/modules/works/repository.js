'use strict';

const { ApiError } = require('../../errors');

function first(data) { return Array.isArray(data) ? data[0] : data; }

function controlledError(error) {
  const message = String(error && error.message || '');
  for (const [needle, code] of [['version_conflict', 'VERSION_CONFLICT'], ['state_conflict', 'STATE_CONFLICT'], ['assets_incomplete', 'UPLOAD_NOT_VERIFIED'], ['page_sequence_invalid', 'UPLOAD_NOT_VERIFIED'], ['asset_policy_invalid', 'UPLOAD_NOT_VERIFIED'], ['slug_conflict', 'SLUG_CONFLICT'], ['not_found', 'NOT_FOUND']]) {
    if (message.includes(needle)) return Object.assign(new Error(needle), { code });
  }
  return new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Content storage unavailable');
}

function rpcResult(result) {
  if (!result || result.error) throw controlledError(result && result.error);
  const row = first(result.data);
  if (!row) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Content storage unavailable');
  return row;
}

function mapWork(row) {
  const chapters = row.chapters === undefined ? undefined : (row.chapters || []).map((chapter) => ({
    id: chapter.id, workId: chapter.work_id, title: chapter.title, position: Number(chapter.position), version: Number(chapter.version),
    status: chapter.status, createdAt: chapter.created_at, updatedAt: chapter.updated_at,
  }));
  const assets = row.assets === undefined ? undefined : (row.assets || []).map((asset) => ({
    id: asset.id, workId: asset.work_id, chapterId: asset.chapter_id, kind: asset.kind, objectKey: asset.object_key,
    storageZone: asset.storage_zone, accessLevel: asset.access_level, mimeType: asset.mime_type, sizeBytes: Number(asset.size_bytes),
    checksum: asset.checksum, pageNo: asset.page_no, status: asset.status,
  }));
  return {
    id: row.id, slug: row.slug, type: row.type, title: row.title, summary: row.summary, rating: row.rating,
    status: row.status, version: Number(row.version), authorName: row.author_name,
    publishedAt: row.published_at || null, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(chapters === undefined ? {} : { chapters }),
    ...(assets === undefined ? {} : { assets }),
  };
}

function createWorksRepository({ rdb }) {
  if (!rdb || typeof rdb.rpc !== 'function') throw new Error('CloudBase rdb().rpc adapter is required for works');
  return {
    async createWork(input) {
      return mapWork(rpcResult(await rdb.rpc('create_work_draft', {
        p_slug: input.slug, p_type: input.type, p_title: input.title, p_summary: input.summary, p_rating: input.rating,
        p_author_name: input.authorName, p_actor_id: input.actorId, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey,
      })));
    },
    async updateWork(input) {
      return mapWork(rpcResult(await rdb.rpc('update_work_draft', {
        p_work_id: input.workId, p_expected_version: input.expectedVersion, p_changes: input.changes,
        p_chapters: input.changes.chapters === undefined ? null : input.changes.chapters,
        p_actor_id: input.actorId, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey,
      })));
    },
    async transitionWork(input) {
      return mapWork(rpcResult(await rdb.rpc('transition_work_state', {
        p_work_id: input.workId, p_expected_version: input.expectedVersion, p_expected_status: input.from,
        p_target_status: input.to, p_action: input.action, p_actor_id: input.actorId, p_request_id: input.requestId, p_idempotency_key: input.idempotencyKey,
      })));
    },
    async listAdminWorks({ limit, cursor, status }) {
      const row = rpcResult(await rdb.rpc('list_admin_works', { p_limit: limit, p_cursor: cursor, p_status: status }));
      return { items: (row.items || []).map(mapWork), nextCursor: row.next_cursor || null };
    },
    async getAdminWork(workId) {
      const result = await rdb.rpc('get_admin_work', { p_work_id: workId });
      if (result && !result.error && (!result.data || !first(result.data))) return null;
      return mapWork(rpcResult(result));
    },
    async getPublicWorkBySlug(slug) {
      const result = await rdb.rpc('get_public_work', { p_slug: slug });
      if (result && !result.error && (!result.data || !first(result.data))) return null;
      const row = rpcResult(result);
      return {
        slug: row.slug, type: row.type, title: row.title, summary: row.summary, rating: row.rating,
        authorName: row.author_name, publishedAt: row.published_at,
        chapters: row.chapters || [],
        assets: (row.assets || []).map((asset) => ({ kind: asset.kind, publicPath: asset.object_key, ...(asset.page_no == null ? {} : { pageNo: asset.page_no }), ...(asset.chapter_position == null ? {} : { chapterPosition: asset.chapter_position }) })),
      };
    },
  };
}

module.exports = { createWorksRepository, mapWork };
