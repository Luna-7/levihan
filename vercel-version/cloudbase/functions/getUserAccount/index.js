const tcb = require('@cloudbase/node-sdk');
// 环境 ID 用具体值：带 accessKey 初始化时 SYMBOL_CURRENT_ENV 会让 SDK 解析不出凭证
// （报 Cannot destructure property 'env_id' of 'credentials'），改用运行时注入的 TCB_ENV。
const ENV_ID = process.env.TCB_ENV || 'levihan-tudou-d0g7jivue1ccc4a35';
const app = tcb.init({ env: ENV_ID, accessKey: process.env.CLOUDBASE_APIKEY });
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
