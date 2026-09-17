const tcb = require('@cloudbase/node-sdk');
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async (event) => {
  const accessKey = String(process.env.CLOUDBASE_APIKEY || '').trim();
  if (!accessKey || accessKey.startsWith('{{env.')) {
    return { ok: false, message: '粮仓钥匙服务配置异常，请联系管理员' };
  }
  const code = String(event.code || '').trim().toUpperCase();
  try {
    const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey });
    const db = app.rdb({ database: 'public' });
    const rows = data(await db.from('invite_codes').select('code,creator_nickname,status,expires_at').eq('code', code).limit(1));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || row.status !== 'unused' || new Date(row.expires_at) <= new Date()) return { ok: false, message: '粮仓钥匙无效、已使用或已过期' };
    return { ok: true, code: row.code, creatorNickname: row.creator_nickname };
  } catch (error) {
    console.error('validateRegistrationInvite failed', error);
    return { ok: false, message: '粮仓钥匙服务暂时不可用，请联系管理员' };
  }
};
