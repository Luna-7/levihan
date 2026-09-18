const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 登录后读取自己的档案。粮仓钥匙 / 邀请码已随开放注册下线，这里只回传账号本身。 */
exports.main = async () => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');

  const profiles = data(await db.from('users').select('uid,nickname,role,created_at').eq('uid', uid).limit(1));
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  if (!row) throw new Error('PROFILE_REQUIRED');

  return {
    ok: true,
    profile: { uid: row.uid, nickname: row.nickname, role: row.role, createdAt: row.created_at },
  };
};
