// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerRegistrationChallenge, confirmRecoveryCode, getMe, login, logout } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  document.cookie = 'lv_csrf=; Max-Age=0; Path=/';
  document.cookie = 'custom_csrf=; Max-Age=0; Path=/';
});

describe('auth API client', () => {
  it('uses the formal answer path with credentialed requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ registrationTicket: 'T'.repeat(43), expiresAt: '2030-01-01T00:10:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await answerRegistrationChallenge('550e8400-e29b-41d4-a716-446655440000', 'SUMMER');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/challenges/550e8400-e29b-41d4-a716-446655440000/answer', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ answer: 'SUMMER' }),
    }));
  });

  it('always includes credentials and sends no CSRF header for anonymous login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      user: { id: '550e8400-e29b-41d4-a716-446655440000', username: 'reader_01', role: 'member', capabilities: ['comment'], ageConsent: null },
      session: { expiresAt: '2030-02-01T00:00:00.000Z' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await login({ username: 'reader_01', password: 'a-secure-password' });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).has('x-csrf-token')).toBe(false);
  });

  it('copies the readable CSRF cookie into the logout header', async () => {
    document.cookie = `lv_csrf=${'C'.repeat(43)}; Path=/`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await logout();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('C'.repeat(43));
  });

  it('uses the configured CSRF cookie name for recovery confirmation', async () => {
    vi.stubEnv('VITE_CSRF_COOKIE_NAME', 'custom_csrf');
    document.cookie = `custom_csrf=${'D'.repeat(43)}; Path=/`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      confirmed: true,
      user: { id: '550e8400-e29b-41d4-a716-446655440000', username: 'reader_01', role: 'member', capabilities: ['comment'], ageConsent: null },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await confirmRecoveryCode('ABCD-EFGH-JKLM-NPQR');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/recovery-confirm');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('D'.repeat(43));
  });

  it('validates the complete /me payload instead of accepting a shallow user object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'not-a-uuid', username: 'Reader With Spaces' },
      role: 'member', capabilities: ['comment'], ageConsent: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(getMe()).rejects.toThrow();
  });
});
