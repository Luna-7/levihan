// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptAgeConsent, getAgePolicy, getRestrictedAccess, revokeAgeConsent } from './api';

const workId = '550e8400-e29b-41d4-a716-446655440002';
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'lv_csrf=; Max-Age=0'; });

describe('restricted access browser API', () => {
  it('sends CSRF on writes and never asks the API to replay signed access', async () => {
    document.cookie = 'lv_csrf=csrf-value';
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ policyVersion: '2026-09', acceptedAt: '2030-01-01T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ work: { id: workId, type: 'comic', title: 'X', rating: 'restricted' }, assets: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await acceptAgeConsent('2026-09');
    await getRestrictedAccess(workId);
    await revokeAgeConsent();
    expect(fetch.mock.calls[0][1].headers.get('x-csrf-token')).toBe('csrf-value');
    expect(fetch.mock.calls[1][1].headers.get('x-csrf-token')).toBe('csrf-value');
    expect(fetch.mock.calls[1][1].headers.has('idempotency-key')).toBe(false);
    expect(fetch.mock.calls[2][1].headers.get('x-csrf-token')).toBe('csrf-value');
  });

  it('strictly validates signed response fields without exposing object keys', async () => {
    document.cookie = 'lv_csrf=csrf-value';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      work: { id: workId, type: 'comic', title: 'X', rating: 'restricted' },
      assets: [{ id: workId, kind: 'page', mimeType: 'image/webp', pageNo: 1, url: 'https://private.cos.ap-test.myqcloud.com/protected/x?q-sign=1', expiresAt: '2030-01-01T00:05:00.000Z', objectKey: 'protected/secret' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(getRestrictedAccess(workId)).rejects.toBeTruthy();
  });

  it('reads the server-owned age policy version and warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ policyVersion: '2026-09', warning: '成人内容警告', assurance: 'self_declaration_only' }), { status: 200 })));
    await expect(getAgePolicy()).resolves.toMatchObject({ policyVersion: '2026-09', assurance: 'self_declaration_only' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/content/access-policy', expect.objectContaining({ method: 'GET', credentials: 'include' }));
  });
});
