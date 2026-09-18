/**
 * 注册：昵称 + 密码（开放注册，不再需要粮仓钥匙）。
 *
 * 为什么走 HTTP 访问服务、而不是浏览器的 cloudbase.callFunction：
 * 注册必然发生在登录之前，而网关鉴权策略默认只放行已登录用户，
 * 只有 HTTP 访问服务允许未登录用户调用，事件函数网关仍默认要求登录态。
 *
 * 为什么不用 db.rpc()：runtime 里的 @cloudbase/node-sdk 3.18.3，app.rdb() 返回的
 * postgrest 客户端只暴露 from()/select()/insert()/update()，没有 rpc()。
 * 所以这里用普通表读写，昵称唯一性交给 users.nickname_key 唯一索引兜底。
 *
 * uid 由服务端生成，客户端不可指定；口令在函数内做 scrypt 散列，数据库只存散列。
 * 返回的 ticket 交给前端 auth.signInWithCustomTicket() 换登录态。
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
/** 自定义登录票据 30 天免重登；过期后需要重新输入昵称与密码 */
const TICKET_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
/** 与 public.users.nickname 的 CHECK 约束（2–20 字）保持一致 */
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const NICKNAME_TAKEN_MESSAGE = '这个昵称已经被占用了，换一个吧';
const CONFIG_MESSAGE = '账号服务配置异常，请联系管理员';
const UNAVAILABLE_MESSAGE = '注册服务暂时不可用，请稍后重试';

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

/** 同时兼容 HTTP 访问服务（event.body 是字符串）与直接 payload 调用 */
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

function validateNickname(nickname) {
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return `昵称需要 ${NICKNAME_MIN}–${NICKNAME_MAX} 个字`;
  }
  return null;
}

function validatePassword(password) {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`;
  }
  return null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const firstRow = (value) => (Array.isArray(value) ? value[0] : value);

/**
 * 环境 ID 必须是具体值：带 accessKey 初始化时 SYMBOL_CURRENT_ENV 解析不出凭证。
 */
const ENV_ID = process.env.TCB_ENV || 'levihan-tudou-d0g7jivue1ccc4a35';

/**
 * 数据面：服务端 API Key 映射 PostgreSQL 的 service_role，缺它会被 RLS / 表权限拒绝。
 */
function initDb() {
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  if (!accessKey || accessKey.startsWith('{{env.')) throw new Error('CLOUDBASE_APIKEY 未配置');
  return tcb.init({ env: ENV_ID, accessKey });
}

/**
 * 票据面：createTicket 不是调接口，而是用「自定义登录私钥」本地签一张 RS256 JWT
 * （返回 private_key_id + '/@@/' + token）。私钥 JSON 结构 { private_key_id, private_key, env_id }，
 * 来自控制台「登录授权 → 自定义登录私钥」。
 *
 * 为什么默认按 base64 解：CLI 渲染 cloudbaserc 时给 JSON.parse 挂了 reviver
 * （「只解析对象」——凡长得像 JSON 的字符串值都会再被解析成对象），
 * 于是 .env 里直接放私钥 JSON 会被解析成对象，部署时报
 * `Environment.Variables.N.Value` 类型不是 string。base64 不含 {} " : ，
 * JSON.parse 失败因而保持字符串，可安全穿过该 reviver。
 * 也兼容控制台里直接填明文 JSON（形如 { 开头）。
 */
function parseCredentials(raw) {
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

function initAuth() {
  const raw = String(process.env.CUSTOM_LOGIN_CREDENTIALS || '').trim();
  if (!raw || raw.startsWith('{{env.')) throw new Error('CUSTOM_LOGIN_CREDENTIALS 未配置');
  let credentials;
  try {
    credentials = parseCredentials(raw);
  } catch {
    throw new Error('CUSTOM_LOGIN_CREDENTIALS 不是合法凭据（应为 base64 或 JSON）');
  }
  return tcb.init({ env: ENV_ID, credentials });
}

async function issueTicket(app, uid) {
  // node-sdk 各版本 createTicket 的返回形态不完全一致（字符串 / { ticket }）
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

  const invalid = validateNickname(nickname) || validatePassword(password);
  if (invalid) return respond(event, 400, { ok: false, message: invalid });

  try {
    const db = initDb().rdb({ database: 'public' });
    const nicknameKey = nickname.toLowerCase();

    const existing = firstRow(
      data(await db.from('users').select('uid').eq('nickname_key', nicknameKey).limit(1))
    );
    if (existing) return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });

    const uid = `lh_${crypto.randomBytes(10).toString('hex')}`;
    try {
      data(
        await db.from('users').insert({
          uid,
          nickname,
          role: 'user',
          password_hash: hashPassword(password),
          invite_quota: 0,
        })
      );
    } catch (error) {
      // 并发下可能撞唯一索引，这里兜底成同一句提示
      if (/duplicate|unique/i.test(String((error && error.message) || ''))) {
        return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });
      }
      throw error;
    }

    const ticket = await issueTicket(initAuth(), uid);
    return respond(event, 200, {
      ok: true,
      ticket,
      profile: { uid, nickname, role: 'user' },
    });
  } catch (error) {
    const raw = String((error && error.message) || '');
    if (/permission denied|credentials|CLOUDBASE_APIKEY/i.test(raw)) {
      console.error('registerWithPassword config error', error);
      return respond(event, 503, { ok: false, message: CONFIG_MESSAGE });
    }
    console.error('registerWithPassword failed', error);
    return respond(event, 503, { ok: false, message: UNAVAILABLE_MESSAGE });
  }
};
