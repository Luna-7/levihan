import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface AuthRequest extends IncomingMessage {
  body?: { password?: unknown } | string;
}

const sendJson = (response: ServerResponse, status: number, body: object) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
};

const getPassword = (request: AuthRequest): string => {
  if (typeof request.body === 'string') {
    try {
      const parsed = JSON.parse(request.body) as { password?: unknown };
      return typeof parsed.password === 'string' ? parsed.password : '';
    } catch {
      return '';
    }
  }
  return typeof request.body?.password === 'string' ? request.body.password : '';
};

export default function handler(request: AuthRequest, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { ok: false });
    return;
  }

  const expectedPassword = process.env.DOUJIN_PASSWORD;
  if (!expectedPassword) {
    sendJson(response, 503, { ok: false });
    return;
  }

  const suppliedHash = createHash('sha256').update(getPassword(request)).digest();
  const expectedHash = createHash('sha256').update(expectedPassword).digest();
  const isValid = timingSafeEqual(suppliedHash, expectedHash);

  sendJson(response, isValid ? 200 : 401, { ok: isValid });
}
