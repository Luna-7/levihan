// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminWrite, listUsers } from './api';

afterEach(() => { vi.restoreAllMocks(); document.cookie = 'lv_csrf=; Max-Age=0'; });

describe('typed admin client', () => {
  it('encodes filters and a compound cursor without leaking credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    await listUsers({ status: 'active', search: 'mei', cursor: '2030-01-01T00:00:00Z|550e8400-e29b-41d4-a716-446655440001', limit: 10 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/admin/users?');
    expect(String(url)).toContain('cursor=');
    expect(init).toMatchObject({ credentials: 'include' });
    expect(JSON.stringify(init)).not.toMatch(/password|database|secret/i);
  });

  it('requires CSRF and domain idempotency for every write', async () => {
    await expect(adminWrite('/admin/questions', {}, 'operation-1')).rejects.toMatchObject({ errorCode: 'ACCESS_DENIED' });
    document.cookie = 'lv_csrf=csrf-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await adminWrite('/admin/questions', { prompt: 'x' }, 'operation-1');
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('csrf-token');
    expect(headers.get('idempotency-key')).toBe('operation-1');
  });

  it('notifies the shell to clear privileged UI when a session expires', async () => {
    const expired = vi.fn(); window.addEventListener('admin-session-expired', expired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ errorCode: 'SESSION_EXPIRED', message: 'expired' }), { status: 401 }));
    await expect(listUsers()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce(); window.removeEventListener('admin-session-expired', expired);
  });
});
