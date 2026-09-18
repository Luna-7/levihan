'use strict';

const { ApiError } = require('../../errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/;
const TYPES = new Set(['comic', 'novel', 'art', 'resource']);
const RATINGS = new Set(['general', 'mature', 'restricted']);
const TRANSITIONS = Object.freeze({
  review: { from: 'draft', to: 'review' },
  publish: { from: 'review', to: 'published' },
  archive: { from: 'published', to: 'archived' },
  restore: { from: 'archived', to: 'draft' },
});
const validSlug = (value) => SLUG.test(value) && !UUID_SHAPED.test(value);

function strictObject(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Request body contains unsupported fields');
  }
  return value;
}

function text(value, name, max, { empty = false } = {}) {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_FAILED', `${name} is required`);
  const normalized = value.trim();
  if ((!empty && !normalized) || normalized.length > max) throw new ApiError(400, 'VALIDATION_FAILED', `${name} is invalid`);
  return normalized;
}

function requireAdmin(ctx) {
  if (!ctx.actorId) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  if (ctx.actorRole !== 'admin') throw new ApiError(403, 'ACCESS_DENIED', 'Administrator access required');
}

function id(value, name = 'ID') {
  if (!UUID.test(value || '')) throw new ApiError(400, 'VALIDATION_FAILED', `${name} is invalid`);
  return value;
}

function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'VALIDATION_FAILED', 'Version is invalid');
  return value;
}

function mapRepositoryError(error) {
  if (error instanceof ApiError) return error;
  if (error && error.code === 'VERSION_CONFLICT') return new ApiError(409, 'VERSION_CONFLICT', 'The work has changed');
  if (error && error.code === 'STATE_CONFLICT') return new ApiError(409, 'STATE_CONFLICT', 'The work state does not allow this operation');
  if (error && error.code === 'UPLOAD_NOT_VERIFIED') return new ApiError(422, 'UPLOAD_NOT_VERIFIED', 'Required assets are not verified');
  if (error && error.code === 'NOT_FOUND') return new ApiError(404, 'NOT_FOUND', 'Work not found');
  if (error && error.code === 'SLUG_CONFLICT') return new ApiError(409, 'STATE_CONFLICT', 'Slug is unavailable');
  return error;
}

function createWorksService({ repository } = {}) {
  if (!repository) throw new Error('Works repository is required');
  return {
    async create(ctx) {
      requireAdmin(ctx);
      const body = strictObject(ctx.body, ['slug', 'type', 'title', 'summary', 'rating', 'authorName']);
      const input = {
        slug: text(body.slug, 'Slug', 128).toLowerCase(), type: body.type,
        title: text(body.title, 'Title', 120), summary: text(body.summary, 'Summary', 2000, { empty: true }),
        rating: body.rating, authorName: text(body.authorName, 'Author name', 120),
      };
      if (!validSlug(input.slug) || !TYPES.has(input.type) || !RATINGS.has(input.rating)) throw new ApiError(400, 'VALIDATION_FAILED', 'Work declaration is invalid');
      try {
        return { work: await repository.createWork({ ...input, actorId: ctx.actorId, requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey }) };
      } catch (error) { throw mapRepositoryError(error); }
    },

    async listAdmin(ctx) {
      requireAdmin(ctx);
      const limit = ctx.query.limit === undefined ? 20 : Number(ctx.query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'VALIDATION_FAILED', 'Limit is invalid');
      return repository.listAdminWorks({ limit, cursor: ctx.query.cursor || null, status: ctx.query.status || null });
    },

    async getAdmin(ctx) {
      requireAdmin(ctx);
      const work = await repository.getAdminWork(id(ctx.params.id, 'Work ID'));
      if (!work) throw new ApiError(404, 'NOT_FOUND', 'Work not found');
      return { work };
    },

    async update(ctx) {
      requireAdmin(ctx);
      id(ctx.params.id, 'Work ID');
      const body = strictObject(ctx.body, ['version', 'slug', 'title', 'summary', 'rating', 'authorName', 'chapters']);
      const changes = {};
      if (body.slug !== undefined) { changes.slug = text(body.slug, 'Slug', 128).toLowerCase(); if (!validSlug(changes.slug)) throw new ApiError(400, 'VALIDATION_FAILED', 'Slug is invalid'); }
      if (body.title !== undefined) changes.title = text(body.title, 'Title', 120);
      if (body.summary !== undefined) changes.summary = text(body.summary, 'Summary', 2000, { empty: true });
      if (body.rating !== undefined) { if (!RATINGS.has(body.rating)) throw new ApiError(400, 'VALIDATION_FAILED', 'Rating is invalid'); changes.rating = body.rating; }
      if (body.authorName !== undefined) changes.authorName = text(body.authorName, 'Author name', 120);
      if (body.chapters !== undefined) {
        if (!Array.isArray(body.chapters) || body.chapters.length > 1000) throw new ApiError(400, 'VALIDATION_FAILED', 'Chapters are invalid');
        changes.chapters = body.chapters.map((chapter, index) => {
          strictObject(chapter, ['id', 'title', 'position', 'version']);
          return { id: chapter.id == null ? null : id(chapter.id, 'Chapter ID'), title: text(chapter.title, 'Chapter title', 200), position: Number.isSafeInteger(chapter.position) && chapter.position > 0 ? chapter.position : index + 1, version: chapter.id == null ? null : version(chapter.version) };
        });
        if (new Set(changes.chapters.map((item) => item.position)).size !== changes.chapters.length) throw new ApiError(400, 'VALIDATION_FAILED', 'Chapter positions must be unique');
      }
      if (!Object.keys(changes).length) throw new ApiError(400, 'VALIDATION_FAILED', 'No changes were supplied');
      try {
        return { work: await repository.updateWork({ workId: ctx.params.id, actorId: ctx.actorId, requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, expectedVersion: version(body.version), changes }) };
      } catch (error) { throw mapRepositoryError(error); }
    },

    async transition(ctx, action) {
      requireAdmin(ctx);
      id(ctx.params.id, 'Work ID');
      const rule = TRANSITIONS[action];
      if (!rule) throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown work transition');
      const body = strictObject(ctx.body, ['version']);
      try {
        return { work: await repository.transitionWork({ workId: ctx.params.id, actorId: ctx.actorId, requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, expectedVersion: version(body.version), from: rule.from, to: rule.to, action }) };
      } catch (error) { throw mapRepositoryError(error); }
    },

    async getPublic(ctx) {
      const slug = String(ctx.params.slug || '').toLowerCase();
      if (!SLUG.test(slug)) throw new ApiError(404, 'NOT_FOUND', 'Work not found');
      const work = await repository.getPublicWorkBySlug(slug);
      if (!work) throw new ApiError(404, 'NOT_FOUND', 'Work not found');
      return { work };
    },
  };
}

module.exports = { createWorksService, requireAdmin, mapRepositoryError, TRANSITIONS };
