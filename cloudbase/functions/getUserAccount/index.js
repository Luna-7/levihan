const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });
function data(result) { if (result.error) throw new Error(result.error.message); return result.data; }
exports.main = async () => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');
  const profiles = data(await db.from('users').select('*').eq('uid', uid).limit(1));
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  if (!row) throw new Error('PROFILE_REQUIRED');
  const invites = data(await db.from('invite_codes').select('code,status,used_by_uid,used_at,created_at,expires_at').eq('creator_uid', uid).order('created_at', { ascending: false }));
  return { ok: true, profile: { nickname: row.nickname, role: row.role, createdAt: row.created_at, inviterNickname: row.inviter_nickname, inviteQuota: row.invite_quota, invites: invites || [] } };
};

