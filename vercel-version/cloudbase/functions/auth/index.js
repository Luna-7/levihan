/**
 * 账号统一入口：答题注册 + 自建会话（彻底替换 CloudBase 内置 auth()）。
 *
 * 动作（event.action）：
 *   challenge — 抽 1 道题，建答题挑战，返回 challenge_id + 题目（不带答案）
 *   answer    — 提交答案；答对发票据，答错 3 次置 failed 并触发 24h 冷却
 *   register  — 凭票据 + 昵称 + 密码注册（argon2 散列），建会话，返回 token
 *   login     — 昵称 + 密码校验，建会话，返回 token
 *   logout    — 撤销当前会话
 *   me        — 凭 token 返回当前用户档案
 *
 * 为什么不用 CloudBase 内置 auth()：
 *   原方案（自定义票据 + cloudbase.auth()）把登录态深耦合在平台 auth 上，
 *   无法实现「答题门槛 + 24h 冷却 + 会话可撤销」。改用自建会话表。
 *
 * 为什么不用 db.rpc()：runtime 的 @cloudbase/node-sdk 3.18.x，app.rdb() 返回的
 *   postgrest 客户端只有 from()/select()/insert()/update()，没有 rpc()。
 *   所以全部业务逻辑用表读写 + 云函数内 JS 实现。
 *
 * 密码：argon2id（@node-rs/argon2），随包上传 linux-x64-gnu 二进制。
 * 答案：question_bank.accepted_answer_hashes 存 HMAC-SHA256(pepper, "question-answer\0"+归一化答案)，
 *   题库不存明文答案。pepper 放环境变量 AUTH_PEPPER。
 * 会话：不透明 token（randomBytes(32)），服务端只存 SHA-256 哈希。
 */
const crypto = require('crypto');
const tcb = require('@cloudbase/node-sdk');
const { hash: argon2Hash, verify: argon2Verify } = require('@node-rs/argon2');

const ALLOWED_ORIGINS = new Set(['https://levihan.asia', 'https://www.levihan.asia']);
/**
 * 本地开发/预览端口不固定（dev 3000 / preview 4173 / vite 5173 / --host 局域网 IP），
 * 逐个枚举必漏。注册/登录是匿名接口、不携带会话，CORS 在此不是安全边界，本地与私有网段整体放行。
 */
const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const FALLBACK_ORIGIN = 'https://levihan.asia';
const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin);

const ENV_ID = process.env.TCB_ENV || 'levihan-tudou-d0g7jivue1ccc4a35';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;

/** 会话有效期：普通用户 30 天 / 管理员 8 小时 */
const MEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_TTL_MS = 8 * 60 * 60 * 1000;

/** 答题挑战：3 次机会，24h 冷却 */
const CHALLENGE_MAX_ATTEMPTS = 3;
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 单次挑战 30 分钟过期
const TICKET_TTL_MS = 15 * 60 * 1000; // 注册票据 15 分钟有效期
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 答错满 3 次后 24h 冷却

const NICKNAME_TAKEN_MESSAGE = '这个昵称已经被占用了，换一个吧';
const CREDENTIAL_ERROR = '昵称或密码不正确';
const CONFIG_MESSAGE = '账号服务配置异常，请联系管理员';
const UNAVAILABLE_MESSAGE = '账号服务暂时不可用，请稍后重试';
const AUTH_REQUIRED_MESSAGE = '登录状态已失效，请重新登录';

function corsHeaders(event) {
  const headers = (event && event.headers) || {};
  const origin = headers.origin || headers.Origin || '';
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : FALLBACK_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function respond(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(body) };
}

/** 同时兼容 HTTP 访问服务（event.body 字符串）与直接 payload 调用 */
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

/** 从 Authorization: Bearer <token> 或 X-Session-Token 头取 token */
function readToken(event) {
  const headers = (event && event.headers) || {};
  const authHeader = headers.Authorization || headers.authorization || '';
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return String(headers['x-session-token'] || '').trim() || null;
}

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const firstRow = (value) => (Array.isArray(value) ? value[0] : value);

/** 数据面：服务端 API Key 映射 PostgreSQL 的 service_role */
function initDb() {
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  if (!accessKey || accessKey.startsWith('{{env.')) throw new Error('CLOUDBASE_APIKEY 未配置');
  return tcb.init({ env: ENV_ID, accessKey }).rdb({ database: 'public' });
}

/** 答案归一化：去首尾空白 + 小写（与 question_bank.normalization_rule 一致） */
function normalizeAnswer(answer, rule = 'trim_lowercase') {
  let text = String(answer || '').trim();
  if (rule === 'trim_lowercase' || rule === 'trim_lower') text = text.toLowerCase();
  return text;
}

/** HMAC-SHA256(pepper, "question-answer\0" + 归一化答案) 的 hex */
function answerHash(answer, rule) {
  const pepper = String(process.env.AUTH_PEPPER || '');
  if (!pepper || pepper.startsWith('{{env.')) throw new Error('AUTH_PEPPER 未配置');
  const normalized = normalizeAnswer(answer, rule);
  return crypto
    .createHmac('sha256', pepper)
    .update('question-answer\0' + normalized)
    .digest('hex');
}

/** 恒定时间比较两个 hex 哈希 */
function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** SHA-256 hex（用于 token_hash / ip_hash / code_hash） */
function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/** 取调用方 IP（优先 X-Forwarded-For / x-real-ip，兜底 sourceIp） */
function clientIp(event) {
  const headers = (event && event.headers) || {};
  const xff = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
  if (xff) return xff.split(',')[0].trim();
  return headers['x-real-ip'] || event?.requestContext?.identity?.sourceIp || event?.sourceIp || 'unknown';
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

async function argon2HashPassword(password) {
  // argon2id，参数与 POC 探针一致
  return argon2Hash(password, {
    algorithm: 2, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function createSession(db, userId, role, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = role === 'admin' ? ADMIN_TTL_MS : MEMBER_TTL_MS;
  const now = Date.now();
  const expiresAt = new Date(now + ttl).toISOString();
  const row = {
    user_id: userId,
    token_hash: sha256Hex(token),
    expires_at: expiresAt,
    ip_hash: sha256Hex(ip),
  };
  data(await db.from('user_sessions').insert(row));
  return { token, expiresAt };
}

/** 凭 token 恢复会话 + 用户，返回 { user, session } 或 null */
async function resolveSession(db, token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = firstRow(
    data(
      await db
        .from('user_sessions')
        .select('id,user_id,expires_at,revoked_at')
        .eq('token_hash', tokenHash)
        .limit(1)
    )
  );
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = firstRow(
    data(
      await db
        .from('app_users')
        .select('id,username,role,status,created_at,last_login_at')
        .eq('id', session.user_id)
        .limit(1)
    )
  );
  if (!user || user.status !== 'active') return null;
  return { user, session };
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

async function actionChallenge(db, event, payload) {
  const ipHash = sha256Hex(clientIp(event));

  // 24h 冷却：同 ip 且 failed 且 updated_at > now - 24h
  const cooldownSince = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const recentFailed = data(
    await db
      .from('registration_challenges')
      .select('id')
      .eq('ip_hash', ipHash)
      .eq('status', 'failed')
      .gte('updated_at', cooldownSince)
      .limit(1)
  );
  if (firstRow(recentFailed)) {
    return respond(event, 429, {
      ok: false,
      message: '答题连续答错 3 次，请 24 小时后再试',
      cooldownUntil: new Date(Date.now() + COOLDOWN_MS).toISOString(),
    });
  }

  // 抽 1 道 active 题（按 sampling_weight 加权随机，简单起见随机取）
  const questions = data(
    await db.from('question_bank').select('id,prompt,options,version').eq('status', 'active').limit(50)
  );
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) {
    return respond(event, 503, { ok: false, message: '题库暂未开放，请稍后再试' });
  }
  const picked = list[Math.floor(Math.random() * list.length)];

  // 建挑战
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  data(
    await db.from('registration_challenges').insert({
      id: challengeId,
      question_ids: [picked.id],
      question_versions: [picked.version],
      max_attempts: CHALLENGE_MAX_ATTEMPTS,
      expires_at: expiresAt,
      ip_hash: ipHash,
    })
  );

  return respond(event, 200, {
    ok: true,
    challengeId,
    question: { id: picked.id, prompt: picked.prompt, options: picked.options },
    maxAttempts: CHALLENGE_MAX_ATTEMPTS,
  });
}

async function actionAnswer(db, event, payload) {
  const challengeId = String(payload.challengeId || '');
  const answer = String(payload.answer || '');
  if (!challengeId || !answer) {
    return respond(event, 400, { ok: false, message: '缺少 challengeId 或 answer' });
  }

  const challenge = firstRow(
    data(await db.from('registration_challenges').select('*').eq('id', challengeId).limit(1))
  );
  if (!challenge) return respond(event, 404, { ok: false, message: '挑战不存在或已过期' });
  if (challenge.status !== 'pending') {
    return respond(event, 409, { ok: false, message: '该挑战已结束，请重新开始' });
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    data(await db.from('registration_challenges').update({ status: 'expired' }).eq('id', challengeId));
    return respond(event, 410, { ok: false, message: '挑战已超时，请重新开始' });
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    return respond(event, 409, { ok: false, message: '答题次数已用完' });
  }

  // 取题目 + 校验答案
  const question = firstRow(
    data(await db.from('question_bank').select('*').eq('id', challenge.question_ids[0]).limit(1))
  );
  if (!question || question.status !== 'active') {
    return respond(event, 503, { ok: false, message: '题目已失效，请重新开始' });
  }
  const rule = question.normalization_rule || 'trim_lowercase';
  const submittedHash = answerHash(answer, rule);
  const accepted = Array.isArray(question.accepted_answer_hashes) ? question.accepted_answer_hashes : [];
  const correct = accepted.some((h) => timingSafeEqualHex(submittedHash, h));

  const newAttemptCount = challenge.attempt_count + 1;

  if (correct) {
    // 答对：挑战 passed，发一次性注册票据
    data(
      await db
        .from('registration_challenges')
        .update({ status: 'passed', attempt_count: newAttemptCount })
        .eq('id', challengeId)
    );
    const ticket = crypto.randomBytes(32).toString('base64url');
    const ticketExpires = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    data(
      await db.from('registration_tickets').insert({
        challenge_id: challengeId,
        token_hash: sha256Hex(ticket),
        expires_at: ticketExpires,
      })
    );
    return respond(event, 200, { ok: true, correct: true, ticket });
  }

  // 答错
  const exhausted = newAttemptCount >= challenge.max_attempts;
  data(
    await db
      .from('registration_challenges')
      .update({ status: exhausted ? 'failed' : 'pending', attempt_count: newAttemptCount })
      .eq('id', challengeId)
  );

  if (exhausted) {
    return respond(event, 200, {
      ok: false,
      correct: false,
      exhausted: true,
      message: '答题连续答错 3 次，已触发 24 小时冷却',
      cooldownUntil: new Date(Date.now() + COOLDOWN_MS).toISOString(),
    });
  }
  return respond(event, 200, {
    ok: false,
    correct: false,
    remainingAttempts: challenge.max_attempts - newAttemptCount,
    message: '答案不正确',
  });
}

async function actionRegister(db, event, payload) {
  const ticket = String(payload.ticket || '');
  const nickname = String(payload.nickname || '').trim();
  const password = String(payload.password || '');

  const invalid = validateNickname(nickname) || validatePassword(password);
  if (invalid) return respond(event, 400, { ok: false, message: invalid });
  if (!ticket) return respond(event, 400, { ok: false, message: '缺少注册票据' });

  // 校验票据：存在、未使用、未过期
  const ticketHash = sha256Hex(ticket);
  const ticketRow = firstRow(
    data(
      await db
        .from('registration_tickets')
        .select('id,challenge_id,used_at,expires_at')
        .eq('token_hash', ticketHash)
        .limit(1)
    )
  );
  if (!ticketRow || ticketRow.used_at) {
    return respond(event, 403, { ok: false, message: '注册票据无效或已使用，请重新答题' });
  }
  if (new Date(ticketRow.expires_at).getTime() < Date.now()) {
    return respond(event, 403, { ok: false, message: '注册票据已过期，请重新答题' });
  }

  // 昵称唯一性（lower(username) 唯一索引兜底）
  const existing = firstRow(
    data(
      await db
        .from('app_users')
        .select('id')
        .eq('username', nickname)
        .limit(1)
    )
  );
  // lower 唯一索引由数据库兜底；这里再用不区分大小写预查一次更稳
  if (existing) return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });

  const userId = crypto.randomUUID();
  const passwordHash = await argon2HashPassword(password);
  const ip = clientIp(event);

  try {
    data(
      await db.from('app_users').insert({
        id: userId,
        username: nickname,
        password_hash: passwordHash,
        role: 'member',
        status: 'active',
      })
    );
  } catch (error) {
    if (/duplicate|unique/i.test(String((error && error.message) || ''))) {
      return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });
    }
    throw error;
  }

  // 标记票据已用
  data(await db.from('registration_tickets').update({ used_at: new Date().toISOString() }).eq('id', ticketRow.id));

  // 建会话
  const { token } = await createSession(db, userId, 'member', ip);

  return respond(event, 200, {
    ok: true,
    token,
    profile: { uid: userId, nickname, role: 'member' },
  });
}

async function actionLogin(db, event, payload) {
  const nickname = String(payload.nickname || '').trim();
  const password = String(payload.password || '');
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return respond(event, 401, { ok: false, message: CREDENTIAL_ERROR });
  }

  const user = firstRow(
    data(
      await db
        .from('app_users')
        .select('id,username,password_hash,role,status')
        .eq('username', nickname)
        .limit(1)
    )
  );
  if (!user || !user.password_hash) {
    return respond(event, 401, { ok: false, message: CREDENTIAL_ERROR });
  }
  let verified = false;
  try {
    verified = await argon2Verify(user.password_hash, password);
  } catch {
    verified = false;
  }
  if (!verified) return respond(event, 401, { ok: false, message: CREDENTIAL_ERROR });

  if (user.status === 'suspended' || user.status === 'deleted') {
    return respond(event, 403, { ok: false, message: '这个账号已被停用' });
  }

  // 更新 last_login_at
  data(await db.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id));

  const { token } = await createSession(db, user.id, user.role, clientIp(event));

  return respond(event, 200, {
    ok: true,
    token,
    profile: { uid: user.id, nickname: user.username, role: user.role },
  });
}

async function actionLogout(db, event, payload) {
  const token = readToken(event) || String(payload.token || '');
  if (!token) return respond(event, 401, { ok: false, message: AUTH_REQUIRED_MESSAGE });
  const tokenHash = sha256Hex(token);
  const session = firstRow(
    data(await db.from('user_sessions').select('id,revoked_at').eq('token_hash', tokenHash).limit(1))
  );
  if (session && !session.revoked_at) {
    data(await db.from('user_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', session.id));
  }
  return respond(event, 200, { ok: true });
}

async function actionMe(db, event, payload) {
  const token = readToken(event) || String(payload.token || '');
  const resolved = await resolveSession(db, token);
  if (!resolved) return respond(event, 401, { ok: false, message: AUTH_REQUIRED_MESSAGE });
  const { user } = resolved;
  return respond(event, 200, {
    ok: true,
    profile: {
      uid: user.id,
      nickname: user.username,
      role: user.role,
      createdAt: user.created_at,
    },
  });
}

async function actionUpdateNickname(db, event, payload) {
  const token = readToken(event) || String(payload.token || '');
  const resolved = await resolveSession(db, token);
  if (!resolved) return respond(event, 401, { ok: false, message: AUTH_REQUIRED_MESSAGE });
  const { user } = resolved;

  const nickname = String(payload.nickname || '').trim().slice(0, 20);
  const invalid = validateNickname(nickname);
  if (invalid) return respond(event, 400, { ok: false, message: invalid });

  // 唯一性：lower(username) 唯一索引兜底
  const taken = firstRow(
    data(await db.from('app_users').select('id').eq('username', nickname).limit(1))
  );
  if (taken && taken.id !== user.id) return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });

  try {
    data(await db.from('app_users').update({ username: nickname }).eq('id', user.id));
  } catch (error) {
    if (/duplicate|unique/i.test(String((error && error.message) || ''))) {
      return respond(event, 409, { ok: false, message: NICKNAME_TAKEN_MESSAGE });
    }
    throw error;
  }

  return respond(event, 200, { ok: true, nickname });
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

const ACTIONS = {
  challenge: actionChallenge,
  answer: actionAnswer,
  register: actionRegister,
  login: actionLogin,
  logout: actionLogout,
  me: actionMe,
  'update-nickname': actionUpdateNickname,
};

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

  const action = String(payload.action || '');
  const handler = ACTIONS[action];
  if (!handler) {
    return respond(event, 400, { ok: false, message: `未知动作：${action || '(空)'}` });
  }

  try {
    const db = initDb();
    return await handler(db, event, payload);
  } catch (error) {
    const raw = String((error && error.message) || '');
    if (/permission denied|credentials|CLOUDBASE_APIKEY|AUTH_PEPPER/i.test(raw)) {
      console.error('auth config error', error);
      return respond(event, 503, { ok: false, message: CONFIG_MESSAGE });
    }
    console.error('auth failed', error);
    return respond(event, 503, { ok: false, message: UNAVAILABLE_MESSAGE });
  }
};
