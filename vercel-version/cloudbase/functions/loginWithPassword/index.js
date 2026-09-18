/**
 * 登录：昵称 + 密码。校验通过后签发自定义登录票据，前端用它换登录态。
 *
 * 与 registerWithPassword 一样走「事件函数 + HTTP 访问服务」，
 * 因为登录必然发生在获得登录态之前，网关策略默认不放行匿名 callFunction。
 *
 * 为什么不用 db.rpc()：runtime 里的 @cloudbase/node-sdk 3.18.3，app.rdb() 返回的
 * postgrest 客户端只暴露 from()/select()/insert()/update()，没有 rpc()。
 *
 * 安全约定：
 * - 昵称不存在与密码错误返回同一句提示，避免昵称枚举。
 * - 口令用 crypto.timingSafeEqual 做定长比较，避免时序侧信道。
 * - 〔待补〕目前没有失败次数限制，公网爆破防护需要后续在网关 QPS 策略或
 *   users 表加失败计数后补上。
 */
const crypto = require('crypto');
const tcb = require('@cloudbase/node-sdk');

const ALLOWED_ORIGINS = new Set([
  'https://levihan.asia',
  'https://www.levihan.asia',
  'http://localhost:5173',
  'http://localhost:4173',
]);
const FALLBACK_ORIGIN = 'https://levihan.asia';
const TICKET_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const CREDENTIAL_ERROR = '昵称或密码不正确';
const CONFIG_MESSAGE = '账号服务配置异常，请联系管理员';
const UNAVAILABLE_MESSAGE = '登录服务暂时不可用，请稍后重试';

function corsHeaders(event) {
  const headers = (event && event.headers) || {};
  const origin = headers.origin || headers.Origin || '';
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function respond(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(body) };
}

function readPayload(event) {
  if (!event) return {};
  const isHttp = Boolean(event.httpMethod || event.requestContext || event.headers);
  if (!isHttp) return event;
  if (typeof event.body === 'string') {
    if (!event.body) return {};
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  }
  return event.body && typeof event.body === 'object' ? event.body : {};
}

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const firstRow = (value) => (Array.isArray(value) ? value[0] : value);

function initApp() {
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  const usable = accessKey && !accessKey.startsWith('{{env.');
  return tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, ...(usable ? { accessKey } : {}) });
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, parts[1], SCRYPT_KEYLEN);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function issueTicket(app, uid) {
  const issued = await Promise.resolve(app.auth().createTicket(uid, { refresh: TICKET_REFRESH_MS }));
  const ticket = typeof issued === 'string' ? issued : issued && issued.ticket;
  if (!ticket) throw new Error('TICKET_ISSUE_FAILED');
  return ticket;
}

exports.main = async (event) => {
  if (String((event && event.httpMethod) || '').toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  let payload;
  try {
    payload = readPayload(event);
  } catch {
    return respond(event, 400, { ok: false, message: '请求格式错误' });
  }

  const nickname = String(payload.nickname || '').trim();
  const password = String(payload.password || '');
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return respond(event, 401, { ok: false, message: CREDENTIAL_ERROR });
  }

  try {
    const app = initApp();
    const db = app.rdb({ database: 'public' });

    const credential = firstRow(
      data(
        await db
          .from('users')
          .select('uid,nickname,role,password_hash')
          .eq('nickname_key', nickname.toLowerCase())
          .limit(1)
      )
    );

    if (!credential || !credential.password_hash || !verifyPassword(password, credential.password_hash)) {
      return respond(event, 401, { ok: false, message: CREDENTIAL_ERROR });
    }
    if (credential.role === 'banned') {
      return respond(event, 403, { ok: false, message: '这个账号已被停用' });
    }

    const ticket = await issueTicket(app, credential.uid);
    return respond(event, 200, {
      ok: true,
      ticket,
      profile: { uid: credential.uid, nickname: credential.nickname, role: credential.role },
    });
  } catch (error) {
    const raw = String((error && error.message) || '');
    if (/permission denied|credentials|CLOUDBASE_APIKEY/i.test(raw)) {
      console.error('loginWithPassword config error', error);
      return respond(event, 503, { ok: false, message: CONFIG_MESSAGE });
    }
    console.error('loginWithPassword failed', error);
    return respond(event, 503, { ok: false, message: UNAVAILABLE_MESSAGE });
  }
};
