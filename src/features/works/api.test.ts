import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveWork, completeAdminUpload, createWork, getAdminWork, getPublicWork, initAdminUpload, listAdminWorks,
  publishWork, rebuildCatalogSnapshot, reviewWork, uploadToCos, updateWork,
} from './api.ts';

const id = '550e8400-e29b-41d4-a716-446655440000';
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('typed works API client', () => {
  it('reads only a validated public work shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ work: { slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', authorName: '作者', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'page', publicPath: 'public/page.webp', pageNo: 1 }] } })));
    expect((await getPublicWork('summer')).work.slug).toBe('summer');
    expect(fetch).toHaveBeenCalledWith('/api/v1/works/summer', expect.objectContaining({ credentials: 'include' }));
  });

  it('sends CSRF-protected admin CRUD and lifecycle requests', async () => {
    vi.stubGlobal('document', { cookie: 'lv_csrf=' + 'c'.repeat(43) });
    const work = { id, slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', status: 'draft', version: 1, authorName: '作者', publishedAt: null };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ work }));
    vi.stubGlobal('fetch', fetchMock);
    await createWork({ slug: 'summer', type: 'comic', title: '夏日', summary: '', rating: 'general', authorName: '作者' });
    await updateWork(id, { version: 1, title: '盛夏' });
    await reviewWork(id, 1); await publishWork(id, 2); await archiveWork(id, 3);
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get('x-csrf-token')).toBe('c'.repeat(43));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/admin/works', `/api/v1/admin/works/${id}`, `/api/v1/admin/works/${id}/review`, `/api/v1/admin/works/${id}/publish`, `/api/v1/admin/works/${id}/archive`]);
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
    const ticket = { uploadId: id, fileId: id, objectKey: `staging/admin/${id}/${id}.webp`, method: 'PUT', uploadUrl: 'https://cos.test/key?signature=x', headers: { 'content-type': 'image/webp', 'content-length': '12', 'x-cos-meta-sha256': 'a'.repeat(64) }, expiresAt: '2030-01-01T00:05:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(ticket)).mockResolvedValueOnce(jsonResponse({ assetId: id, status: 'verified' })).mockResolvedValueOnce(jsonResponse({ version: 3, checksum: 'b'.repeat(64), objectKey: 'snapshots/public/catalog.v3.json' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await initAdminUpload({ workId: id, filename: 'page.webp', mimeType: 'image/webp', sizeBytes: 12, checksum: 'a'.repeat(64), kind: 'page', pageNo: 1, accessLevel: 'public' })).toEqual(ticket);
    await completeAdminUpload(id); await rebuildCatalogSnapshot();
    expect(fetchMock.mock.calls[0][1].body).not.toContain('base64');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/admin/uploads/init', `/api/v1/admin/uploads/${id}/complete`, '/api/v1/admin/snapshots/rebuild']);
  });

  it('rejects malformed server responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ work: { slug: 'summer', objectKey: 'private/key' } })));
    await expect(getPublicWork('summer')).rejects.toThrow();
  });

  it('uploads the Blob directly to COS with the exact signed headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ticket = { uploadId: id, fileId: id, objectKey: `staging/admin/${id}/${id}.webp`, method: 'PUT' as const, uploadUrl: 'https://cos.test/key?signature=x', headers: { 'content-type': 'image/webp', 'content-length': '3', 'x-cos-meta-sha256': 'a'.repeat(64) }, expiresAt: '2030-01-01T00:05:00.000Z' };
    const blob = new Blob(['abc'], { type: 'image/webp' });
    await uploadToCos(ticket, blob);
    expect(fetchMock).toHaveBeenCalledWith(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob });
  });
});
