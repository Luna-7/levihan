const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const firstRow = (value) => (Array.isArray(value) ? value[0] : value);

const NICKNAME_TAKEN = '这个昵称已经被占用了，换一个吧';

/**
 * 改昵称。唯一性靠 users.nickname_key（lower(btrim(nickname)) 生成列）上的唯一索引兜底，
 * 先查一次只是为了给出友好提示，并发下仍以数据库约束为准。
 * 注意 runtime 的 app.rdb() 没有 rpc()，所以走普通表读写。
 */
exports.main = async (event) => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');

  const nickname = String(event.nickname || '').trim().slice(0, 20);
  if (nickname.length < 2) throw new Error('昵称至少需要 2 个字');

  const taken = firstRow(
    data(await db.from('users').select('uid').eq('nickname_key', nickname.toLowerCase()).limit(1))
  );
  if (taken && taken.uid !== uid) throw new Error(NICKNAME_TAKEN);

  try {
    data(
      await db
        .from('users')
        .update({ nickname, updated_at: new Date().toISOString() })
        .eq('uid', uid)
    );
  } catch (error) {
    if (/duplicate|unique/i.test(String((error && error.message) || ''))) throw new Error(NICKNAME_TAKEN);
    throw error;
  }

  return { ok: true, nickname };
};
