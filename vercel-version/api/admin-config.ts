import type { IncomingMessage, ServerResponse } from 'node:http';

const ADMIN_ORIGIN = 'https://admin.levihan.asia';

interface ConfigRequest extends IncomingMessage {}

function sendJson(response: ServerResponse, status: number, body: object) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.end(JSON.stringify(body));
}

export default function handler(request: ConfigRequest, response: ServerResponse) {
  response.setHeader('Vary', 'Origin');
  const origin = request.headers.origin;
  if (origin && origin !== ADMIN_ORIGIN) {
    sendJson(response, 403, { ok: false, error: '请求来源无效' });
    return;
  }
  if (origin === ADMIN_ORIGIN) {
    response.setHeader('Access-Control-Allow-Origin', ADMIN_ORIGIN);
  }

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { ok: false, error: '请求方法不支持' });
    return;
  }

  const configuredOrigin = String(process.env.CLOUDBASE_ORIGIN || '').trim().replace(/\/+$/, '');
  let cloudbaseOrigin: URL;
  try {
    cloudbaseOrigin = new URL(configuredOrigin);
  } catch {
    sendJson(response, 503, { ok: false, error: '管理接口地址尚未配置' });
    return;
  }
  if (cloudbaseOrigin.protocol !== 'https:' || !cloudbaseOrigin.hostname.endsWith('.service.tcloudbase.com')) {
    sendJson(response, 503, { ok: false, error: '管理接口地址配置无效' });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    adminUploadUrl: `${cloudbaseOrigin.origin}/admin-upload`,
  });
}
