// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComment, getReadingProgress, listComments, syncReadingProgress } from './api';

const id = '550e8400-e29b-41d4-a716-446655440001';
const mutationId = '550e8400-e29b-41d4-a716-446655440002';
const now = '2030-01-01T00:00:00.000Z';
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lv_csrf=; Max-Age=0; Path=/'; });

describe('interaction API', () => {
  it('parses public comments and rejects unexpected private fields', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id, authorName: 'user', body: 'hello', createdAt: now }], count: 1, nextCursor: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(listComments('work-slug')).resolves.toMatchObject({ count: 1 });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id, authorName: 'user', body: 'hello', createdAt: now, userId: id }], count: 1, nextCursor: null }), { status: 200 }));
    await expect(listComments('work-slug')).rejects.toThrow();
  });

  it('sends CSRF and a stable idempotency key for comment and progress writes', async () => {
    document.cookie = 'lv_csrf=csrf-value; Path=/';
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id, status: 'pending', createdAt: now }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true, position: { kind: 'comic', page: 4 }, percent: 20, logicVersion: 1, clientVersion: 2, mutationId, version: 3, updatedAt: now }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await createComment('work-slug', ' hello ', mutationId);
    await syncReadingProgress('work-slug', { position: { kind: 'comic', page: 4 }, percent: 20, logicVersion: 1, clientVersion: 2, baseVersion: 2, mutationId });
    for (const call of fetch.mock.calls) {
      const headers = new Headers(call[1].headers);
      expect(headers.get('x-csrf-token')).toBe('csrf-value');
      expect(headers.get('idempotency-key')).toBe(mutationId);
    }
  });

  it('models missing progress without leaking work metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ progress: null }), { status: 200 })));
    await expect(getReadingProgress('work-slug')).resolves.toEqual(null);
  });
});
