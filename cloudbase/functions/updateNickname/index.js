const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }

exports.main = async (event) => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');
  const nickname = String(event.nickname || '').trim().slice(0, 20);
  if (nickname.length < 2) throw new Error('昵称至少需要 2 个字');
  data(await db.from('users').update({ nickname, updated_at: new Date().toISOString() }).eq('uid', uid));
  return { ok: true, nickname };
};
