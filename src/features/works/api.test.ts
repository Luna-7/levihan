import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveWork, completeAdminUpload, createWork, getAdminWork, getCurrentCatalogSnapshot, getPublicWork, initAdminUpload, listAdminWorks,
  publishWork, rebuildCatalogSnapshot, reviewWork, uploadToCos, updateWork, createOperationKey,
} from './api.ts';

const id = '550e8400-e29b-41d4-a716-446655440000';
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('typed works API client', () => {
  it('creates operation keys explicitly so callers can retain one across retries', () => {
    const first = createOperationKey(); const second = createOperationKey();
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,128}$/); expect(second).not.toBe(first);
  });
  it('reads only a validated public work shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ work: { slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', authorName: '作者', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'page', publicPath: 'public/page.webp', pageNo: 1 }] } })));
    expect((await getPublicWork('summer')).work.slug).toBe('summer');
    expect(fetch).toHaveBeenCalledWith('/api/v1/works/summer', expect.objectContaining({ credentials: 'include' }));
  });

  it('requires an opaque access id for restricted metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ work: { accessId: id, slug: 'restricted', type: 'comic', title: 'R', summary: '', rating: 'restricted', authorName: '作者', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'preview', publicPath: 'media/works/w/blur.webp' }] } })));
    await expect(getPublicWork('restricted')).resolves.toMatchObject({ work: { accessId: id, rating: 'restricted' } });
  });

  it('sends CSRF-protected admin CRUD and lifecycle requests', async () => {
    vi.stubGlobal('document', { cookie: 'lv_csrf=' + 'c'.repeat(43) });
    const work = { id, slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', status: 'draft', version: 1, authorName: '作者', publishedAt: null };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ id, status: 'draft', version: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const operationKey = createOperationKey();
    await createWork({ slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', authorName: '作者' }, operationKey);
    await updateWork(id, { version: 1, title: '盛夏' }, operationKey);
    await reviewWork(id, 1, operationKey); await publishWork(id, 2, operationKey); await archiveWork(id, 3, operationKey);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get('x-csrf-token')).toBe('c'.repeat(43));
      expect(new Headers(init.headers).get('idempotency-key')).toBe(operationKey);
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/admin/works', `/api/v1/admin/works/${id}`, `/api/v1/admin/works/${id}/review`, `/api/v1/admin/works/${id}/publish`, `/api/v1/admin/works/${id}/archive`]);
  });

  it('rejects UUID-shaped slugs in admin create and update before the request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const input = { slug: id, type: 'comic' as const, title: '夏日', summary: '', rating: 'general' as const, authorName: '作者' };
    await expect(createWork(input, createOperationKey())).rejects.toThrow('作品地址无效');
    await expect(updateWork(id, { version: 1, slug: id }, createOperationKey())).rejects.toThrow('作品地址无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('provides validated admin list and detail reads', async () => {
    const work = { id, slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', status: 'draft', version: 1, authorName: '作者', publishedAt: null };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [work], nextCursor: null })).mockResolvedValueOnce(jsonResponse({ work }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await listAdminWorks({ status: 'draft', limit: 10 })).items).toHaveLength(1);
    expect((await getAdminWork(id)).work.id).toBe(id);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/admin/works?status=draft&limit=10', `/api/v1/admin/works/${id}`]);
  });

  it('initializes direct upload without reading or serializing file bytes', async () => {
    vi.stubGlobal('document', { cookie: 'lv_csrf=' + 'c'.repeat(43) });
    const ticket = { uploadId: id, fileId: id, objectKey: `staging/admin/${id}/${id}.webp`, method: 'PUT', uploadUrl: 'https://cos.test/key?signature=x', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) }, expiresAt: '2030-01-01T00:05:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(ticket)).mockResolvedValueOnce(jsonResponse({ assetId: id, status: 'verified' })).mockResolvedValueOnce(jsonResponse({ version: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    const operationKey = createOperationKey();
    expect(await initAdminUpload({ workId: id, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' }, operationKey)).toEqual(ticket);
    await completeAdminUpload(id, operationKey); await rebuildCatalogSnapshot(operationKey);
    expect(fetchMock.mock.calls[0][1].body).not.toContain('base64');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/admin/uploads/init', `/api/v1/admin/uploads/${id}/complete`, '/api/v1/admin/snapshots/rebuild']);
  });

  it('accepts the durable processing replay without a staging signature', async () => {
    vi.stubGlobal('document', { cookie: 'lv_csrf=' + 'c'.repeat(43) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ uploadId: id, fileId: id, status: 'processing' })));
    await expect(initAdminUpload({ workId: id, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' }, createOperationKey())).resolves.toEqual({ uploadId: id, fileId: id, status: 'processing' });
  });

  it('reads the PostgreSQL-backed current pointer before immutable COS content', async () => {
    const pointer = { version: 3, objectKey: 'snapshots/public/catalog.v3.json', checksum: 'a'.repeat(64), updatedAt: '2030-01-01T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(pointer)));
    await expect(getCurrentCatalogSnapshot()).resolves.toEqual(pointer);
    expect(fetch).toHaveBeenCalledWith('/api/v1/snapshots/catalog/current', expect.objectContaining({ credentials: 'include' }));
  });

  it('rejects malformed server responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ work: { slug: 'summer', objectKey: 'private/key' } })));
    await expect(getPublicWork('summer')).rejects.toThrow();
  });

  it('uploads the Blob directly to COS with the exact signed headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ticket = { uploadId: id, fileId: id, objectKey: `staging/admin/${id}/${id}.webp`, method: 'PUT' as const, uploadUrl: 'https://cos.test/key?signature=x', headers: { 'content-type': 'image/webp', 'x-cos-meta-sha256': 'a'.repeat(64) }, expiresAt: '2030-01-01T00:05:00.000Z' };
    const blob = new Blob(['abc'], { type: 'image/webp' });
    await uploadToCos(ticket, blob);
    expect(fetchMock).toHaveBeenCalledWith(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob });
  });
});
