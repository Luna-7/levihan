const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async (event) => {
  const code = String(event.code || '').trim().toUpperCase();
  const rows = data(await db.from('invite_codes').select('code,creator_nickname,status,expires_at').eq('code', code).limit(1));
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || row.status !== 'unused' || new Date(row.expires_at) <= new Date()) return { ok: false, message: '粮仓钥匙无效或已过期' };
  return { ok: true, code: row.code, creatorNickname: row.creator_nickname };
};

