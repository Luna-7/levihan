import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type', 'cookie', 'idempotency-key', 'origin', 'referer', 'user-agent', 'x-csrf-token', 'x-request-id'] as const;
const FORWARDED_RESPONSE_HEADERS = ['cache-control', 'content-type', 'pragma', 'referrer-policy', 'vary', 'x-request-id'] as const;

function gatewayBase(env: NodeJS.ProcessEnv) {
  const raw = env.CLOUDBASE_API_BASE_URL;
  if (!raw) throw new Error('CLOUDBASE_API_BASE_URL is required');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error('CLOUDBASE_API_BASE_URL must be an HTTPS /api/v1 gateway URL');
  }
  return url;
}

export async function proxyApiRequest(request: Request, env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  const incoming = new URL(request.url);
  const marker = '/api/v1/';
  const offset = incoming.pathname.indexOf(marker);
  if (offset < 0) return new Response('Not found', { status: 404 });
  const suffix = incoming.pathname.slice(offset + marker.length);
  if (suffix.split('/').some((part) => part === '.' || part === '..')) return new Response('Not found', { status: 404 });
  const target = new URL(`${gatewayBase(env).toString().replace(/\/$/, '')}/${suffix}`);
  target.search = incoming.search;
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');
  const platformIp = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || '').split(',')[0].trim();
  if (!isIP(platformIp)) return new Response('Trusted client address unavailable', { status: 503 });
  const proxySecret = env.API_PROXY_HMAC_SECRET;
  if (!proxySecret || proxySecret.length < 32) throw new Error('API_PROXY_HMAC_SECRET is required');
  const timestamp = String(Math.floor(Date.now() / 1000));
  headers.set('x-lv-client-ip', platformIp);
  headers.set('x-lv-proxy-timestamp', timestamp);
  headers.set('x-lv-proxy-signature', createHmac('sha256', proxySecret).update(`${request.method}\n${target.pathname}\n${platformIp}\n${timestamp}`).digest('hex'));
  const upstream = await transport(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });
  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const cookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);
  if (!cookies.length && upstream.headers.get('set-cookie')) responseHeaders.set('set-cookie', upstream.headers.get('set-cookie')!);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export default function handler(request: Request) {
  return proxyApiRequest(request);
}
