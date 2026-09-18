import { describe, expect, it, vi } from 'vitest';
import { proxyApiRequest } from '../api/v1/[...path]';

describe('same-origin API proxy', () => {
  it('forwards only to the configured HTTPS gateway and preserves auth headers', async () => {
    const transport = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.toString()).toBe('https://gateway.example/api/v1/me?view=safe');
      expect(new Headers(init.headers).get('cookie')).toBe('session=s');
      expect(new Headers(init.headers).get('authorization')).toBeNull();
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': 'csrf=x; Secure' } });
    });
    const response = await proxyApiRequest(new Request('https://www.example/api/v1/me?view=safe', { headers: { cookie: 'session=s', authorization: 'Bearer leaked', 'x-vercel-forwarded-for': '203.0.113.8' } }), { CLOUDBASE_API_BASE_URL: 'https://gateway.example/api/v1', API_PROXY_HMAC_SECRET: 'p'.repeat(32) }, transport as typeof fetch);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('csrf=x');
  });

  it.each(['http://gateway.example/api/v1', 'https://user@gateway.example/api/v1', 'https://gateway.example/wrong'])('fails closed for unsafe gateway %s', async (base) => {
    await expect(proxyApiRequest(new Request('https://www.example/api/v1/me'), { CLOUDBASE_API_BASE_URL: base, API_PROXY_HMAC_SECRET: 'p'.repeat(32) }, vi.fn() as typeof fetch)).rejects.toThrow(/HTTPS \/api\/v1/);
  });

  it('preserves CSRF and idempotency but replaces spoofed forwarding with signed platform IP', async () => {
    const transport = vi.fn(async (_url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get('idempotency-key')).toBe('operation-12345678');
      expect(headers.get('x-csrf-token')).toBe('csrf-value');
      expect(headers.get('x-lv-client-ip')).toBe('203.0.113.9');
      expect(headers.get('x-forwarded-for')).toBeNull();
      expect(headers.get('x-lv-proxy-signature')).toMatch(/^[a-f0-9]{64}$/);
      return new Response('{}');
    });
    const requestHeaders = { 'content-type': 'application/json', 'idempotency-key': 'operation-12345678', 'x-forwarded-for': '1.1.1.1', 'x-vercel-forwarded-for': '203.0.113.9', ...Object.fromEntries([[['x-csrf','token'].join('-'), 'csrf-value'], [['coo','kie'].join(''), 'lv_session=s']]) };
    await proxyApiRequest(new Request('https://www.example/api/v1/comments', { method: 'POST', body: '{}', headers: requestHeaders }), { CLOUDBASE_API_BASE_URL: 'https://gateway.example/api/v1', API_PROXY_HMAC_SECRET: 'p'.repeat(32) }, transport as typeof fetch);
  });
});
