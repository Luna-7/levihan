const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async () => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');
  const result = data(await db.rpc('generate_invite_for_user', { p_uid: uid }));
  const row = Array.isArray(result) ? result[0] : result;
  return { ok: true, code: row.code, expiresAt: row.expires_at };
};

