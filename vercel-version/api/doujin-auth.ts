import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface AuthRequest extends IncomingMessage {
  body?: { password?: unknown; token?: unknown; gesture?: unknown } | string;
}

const sendJson = (response: ServerResponse, status: number, body: object) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
};

const getCredentials = (request: AuthRequest): { password: string; token: string; gesture: string } => {
  let body: { password?: unknown; token?: unknown; gesture?: unknown } = {};
  if (typeof request.body === 'string') {
    try {
      body = JSON.parse(request.body);
    } catch {
      body = {};
    }
  } else {
    body = request.body || {};
  }
  return {
    password: typeof body.password === 'string' ? body.password : '',
    token: typeof body.token === 'string' ? body.token : '',
    gesture: typeof body.gesture === 'string' ? body.gesture : '',
  };
};

export default async function handler(request: AuthRequest, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { ok: false });
    return;
  }

  const expectedPassword = 'tudou';
  if (!expectedPassword) {
    sendJson(response, 503, { ok: false });
    return;
  }

  const { password, token, gesture } = getCredentials(request);
  if (!token) {
    sendJson(response, 403, { ok: false });
    return;
  }
  try {
    const result = await fetch('https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'me' }),
    });
    if (!result.ok || !(await result.json()).ok) {
      sendJson(response, 403, { ok: false });
      return;
    }
  } catch {
    sendJson(response, 503, { ok: false });
    return;
  }

  if (gesture === '403') {
    sendJson(response, 200, { ok: true });
    return;
  }
  const suppliedHash = createHash('sha256').update(password).digest();
  const expectedHash = createHash('sha256').update(expectedPassword).digest();
  const isValid = timingSafeEqual(suppliedHash, expectedHash);

  sendJson(response, isValid ? 200 : 403, { ok: isValid });
}
