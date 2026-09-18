/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createWorksService } = require('../src/modules/works/service');
const { registerWorksRoutes } = require('../src/modules/works/routes');
const { createWorksRepository } = require('../src/modules/works/repository');
const { createRouter } = require('../src/router');
const { createApi } = require('../src/http');

const actorId = '550e8400-e29b-41d4-a716-446655440001';
const workId = '550e8400-e29b-41d4-a716-446655440002';

function ctx(overrides = {}) {
  return { actorId, actorRole: 'admin', requestId: 'request-1', body: {}, params: {}, query: {}, ...overrides };
}

function setup(repository = {}) {
  const defaults = {
    createWork: vi.fn(), listAdminWorks: vi.fn(), getAdminWork: vi.fn(), updateWork: vi.fn(),
    transitionWork: vi.fn(), getPublicWorkBySlug: vi.fn(),
  };
  return { repository: { ...defaults, ...repository }, service: createWorksService({ repository: { ...defaults, ...repository } }) };
}

describe('work routes and authorization', () => {
  it('exposes public reads and protects every admin write', () => {
    const router = createRouter();
    registerWorksRoutes(router, new Proxy({}, { get: () => vi.fn() }));
    expect(router.resolve('GET', '/works/a-story').metadata.sessionRequired).not.toBe(true);
    for (const [method, path] of [
      ['POST', '/admin/works'], ['PATCH', `/admin/works/${workId}`],
      ['POST', `/admin/works/${workId}/review`], ['POST', `/admin/works/${workId}/publish`],
      ['POST', `/admin/works/${workId}/archive`], ['POST', `/admin/works/${workId}/restore`],
    ]) {
      expect(router.resolve(method, path).metadata).toMatchObject({ sessionRequired: true, role: 'admin', idempotency: { mode: 'domain' } });
    }
  });

  it('blocks missing sessions and non-admin actors before an admin handler executes', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const config = { environment: 'test', allowedOrigins: [], gatewayPath: '/api/v1', csrfRequired: false, bodyLimitBytes: 1024, sessionCookieName: 'lv_session', csrfCookieName: 'lv_csrf', sessionHashPepper: 's'.repeat(32), rateLimitPepper: 'r'.repeat(32) };
    const anonymous = createApi({ config, actorResolver: async () => null, logger: { info() {}, error() {} } });
    anonymous.router.get('/admin/check', handler, { sessionRequired: true, role: 'admin' });
    expect((await anonymous.handle({ httpMethod: 'GET', path: '/api/v1/admin/check' })).statusCode).toBe(401);
    const member = createApi({ config, actorResolver: async () => ({ actorId, role: 'member' }), logger: { info() {}, error() {} } });
    member.router.get('/admin/check', handler, { sessionRequired: true, role: 'admin' });
    expect((await member.handle({ httpMethod: 'GET', path: '/api/v1/admin/check' })).statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('work repository transaction boundary', () => {
  it('routes create, update and lifecycle changes through atomic database routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: workId, slug: 'summer', type: 'comic', title: 'Summer', summary: '', rating: 'general', status: 'draft', version: 1, author_name: 'A' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: workId, slug: 'summer', type: 'comic', title: 'New', summary: '', rating: 'general', status: 'draft', version: 2, author_name: 'A' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: workId, slug: 'summer', type: 'comic', title: 'New', summary: '', rating: 'general', status: 'review', version: 3, author_name: 'A' }], error: null });
    const repository = createWorksRepository({ rdb: { rpc, from: vi.fn() } });
    await repository.createWork({ slug: 'summer', type: 'comic', title: 'Summer', summary: '', rating: 'general', authorName: 'A', actorId, requestId: 'req' });
    await repository.updateWork({ workId, expectedVersion: 1, changes: { title: 'New', chapters: [] }, actorId, requestId: 'req' });
    await repository.transitionWork({ workId, expectedVersion: 2, from: 'draft', to: 'review', action: 'review', actorId, requestId: 'req' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['create_work_draft', 'update_work_draft', 'transition_work_state']);
    expect(rpc.mock.calls[1][1].p_chapters).toEqual([]);
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_expected_status: 'draft', p_target_status: 'review' });
  });

  it('maps public chapter positions without exposing database chapter IDs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ slug: 'summer', type: 'comic', title: 'Summer', summary: '', rating: 'general', author_name: 'A', published_at: '2030-01-01T00:00:00Z', chapters: [{ title: 'One', position: 1 }], assets: [{ kind: 'page', object_key: 'public/page.webp', page_no: 1, chapter_position: 1 }] }], error: null });
    const repository = createWorksRepository({ rdb: { rpc, from: vi.fn() } });
    const work = await repository.getPublicWorkBySlug('summer');
    expect(work.assets).toEqual([{ kind: 'page', publicPath: 'public/page.webp', pageNo: 1, chapterPosition: 1 }]);
    expect(JSON.stringify(work)).not.toMatch(/chapterId|chapter_id/);
  });

  it.each([
    ['version_conflict', 'VERSION_CONFLICT'], ['state_conflict', 'STATE_CONFLICT'],
    ['assets_incomplete', 'UPLOAD_NOT_VERIFIED'], ['slug_conflict', 'SLUG_CONFLICT'],
  ])('maps controlled database error %s', async (message, code) => {
    const repository = createWorksRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message } }), from: vi.fn() } });
    await expect(repository.transitionWork({ workId, expectedVersion: 1, from: 'review', to: 'published', action: 'publish', actorId, requestId: 'req' }))
      .rejects.toMatchObject({ code });
  });
});

describe('work lifecycle', () => {
  it('creates a normalized draft and delegates its audit write to one atomic repository operation', async () => {
    const created = { id: workId, slug: 'summer-story', type: 'comic', title: '夏日', summary: '', rating: 'general', status: 'draft', version: 1 };
    const repository = { createWork: vi.fn().mockResolvedValue(created) };
    const service = createWorksService({ repository });
    const response = await service.create(ctx({ body: { slug: 'summer-story', type: 'comic', title: ' 夏日 ', summary: '', rating: 'general', authorName: '作者' } }));
    expect(response).toEqual({ work: created });
    expect(repository.createWork).toHaveBeenCalledWith(expect.objectContaining({ actorId, requestId: 'request-1', title: '夏日' }));
  });

  it('uses optimistic versioning for edits and maps conflicts', async () => {
    const repository = { updateWork: vi.fn().mockRejectedValue(Object.assign(new Error('version_conflict'), { code: 'VERSION_CONFLICT' })) };
    const service = createWorksService({ repository });
    await expect(service.update(ctx({ params: { id: workId }, body: { version: 2, title: '新标题' } })))
      .rejects.toMatchObject({ status: 409, errorCode: 'VERSION_CONFLICT' });
  });

  it.each([
    ['review', 'draft', 'review'],
    ['publish', 'review', 'published'],
    ['archive', 'published', 'archived'],
    ['restore', 'archived', 'draft'],
  ])('allows %s only through an audited atomic transition', async (action, from, to) => {
    const work = { id: workId, status: to, version: 4 };
    const repository = { transitionWork: vi.fn().mockResolvedValue(work) };
    const service = createWorksService({ repository });
    expect(await service.transition(ctx({ params: { id: workId }, body: { version: 3 } }), action)).toEqual({ work });
    expect(repository.transitionWork).toHaveBeenCalledWith({ workId, actorId, requestId: 'request-1', expectedVersion: 3, from, to, action });
  });

  it('rejects publishing when the transactional repository reports incomplete assets', async () => {
    const repository = { transitionWork: vi.fn().mockRejectedValue(Object.assign(new Error('assets_incomplete'), { code: 'UPLOAD_NOT_VERIFIED' })) };
    const service = createWorksService({ repository });
    await expect(service.transition(ctx({ params: { id: workId }, body: { version: 3 } }), 'publish'))
      .rejects.toMatchObject({ status: 422, errorCode: 'UPLOAD_NOT_VERIFIED' });
  });

  it('returns only published public work and never private object keys', async () => {
    const repository = { getPublicWorkBySlug: vi.fn().mockResolvedValue({
      slug: 'summer-story', type: 'comic', title: '夏日', summary: '', rating: 'general', authorName: '作者',
      publishedAt: '2030-01-01T00:00:00.000Z', assets: [{ kind: 'page', publicPath: 'media/page-1.webp', pageNo: 1 }],
    }) };
    const service = createWorksService({ repository });
    const response = await service.getPublic(ctx({ actorId: undefined, actorRole: undefined, params: { slug: 'summer-story' } }));
    expect(response.work.assets).toEqual([{ kind: 'page', publicPath: 'media/page-1.webp', pageNo: 1 }]);
    expect(JSON.stringify(response)).not.toMatch(/objectKey|private|staging/i);
  });
});
