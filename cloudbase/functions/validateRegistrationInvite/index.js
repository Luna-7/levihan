const tcb = require('@cloudbase/node-sdk');
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async (event) => {
  const isHttp = Boolean(event && (event.httpMethod || event.requestContext || event.headers));
  const origin = isHttp && event.headers ? (event.headers.origin || event.headers.Origin || '') : '';
  const allowedOrigins = new Set(['https://levihan.asia', 'https://www.levihan.asia', 'http://localhost:5173', 'http://localhost:4173']);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://levihan.asia',
    'Vary': 'Origin',
  };
  const respond = (statusCode, result) => isHttp
    ? { statusCode, headers, body: JSON.stringify(result) }
    : result;
  let payload = event || {};
  if (isHttp && typeof event.body === 'string') {
    try { payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); }
    catch { return respond(400, { ok: false, message: '请求格式错误' }); }
  } else if (isHttp && event.body && typeof event.body === 'object') {
    payload = event.body;
  }
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  if (!accessKey || accessKey.startsWith('{{env.')) {
    return respond(503, { ok: false, message: '粮仓钥匙服务配置异常，请联系管理员' });
  }
  const code = String(payload.code || '').trim().toUpperCase();
  try {
    const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey });
    const db = app.rdb({ database: 'public' });
    const rows = data(await db.from('invite_codes').select('code,creator_nickname,status,expires_at').eq('code', code).limit(1));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || row.status !== 'unused' || new Date(row.expires_at) <= new Date()) return respond(400, { ok: false, message: '粮仓钥匙无效、已使用或已过期' });
    return respond(200, { ok: true, code: row.code, creatorNickname: row.creator_nickname });
  } catch (error) {
    console.error('validateRegistrationInvite failed', error);
    return respond(503, { ok: false, message: '粮仓钥匙服务暂时不可用，请联系管理员' });
  }
};
