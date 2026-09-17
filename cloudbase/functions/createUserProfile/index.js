const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async (event) => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');
  const nickname = String(event.nickname || '').trim().slice(0, 20);
  const code = String(event.code || '').trim().toUpperCase();
  const result = data(await db.rpc('claim_registration_invite', { p_uid: uid, p_nickname: nickname, p_code: code }));
  const row = Array.isArray(result) ? result[0] : result;
  return { ok: true, profile: row };
};

