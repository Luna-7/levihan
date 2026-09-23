const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 榜单展示条数（「我的战绩」的排名按全量数据计算，不受此限制） */
const TOP = 50;
const GAME_KEYS = ['daxigua', 'hange', 'lihan'];
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const rows = (value) => (Array.isArray(value) ? value : value ? [value] : []);

exports.main = async () => {
  // 游客也能看榜，拿不到登录态时只返回公开榜单
  let uid = null;
  try {
    uid = app.auth().getUserInfo().uid || null;
  } catch {
    uid = null;
  }

  const best = rows(
    data(await db.from('game_best').select('uid,game_key,merit,raw_score,achieved_at').order('merit', { ascending: false }).limit(500))
  );

  const uids = [...new Set(best.map((row) => row.uid))];
  const nicknameMap = {};
  if (uids.length) {
    const users = rows(data(await db.from('users').select('uid,nickname').in('uid', uids)));
    users.forEach((user) => {
      nicknameMap[user.uid] = user.nickname || '无名士兵';
    });
  }
  const nameOf = (id) => nicknameMap[id] || '无名士兵';

  // 分榜（best 已按 merit 降序，过滤后顺序保持）
  const ranked = {};
  GAME_KEYS.forEach((key) => {
    ranked[key] = best.filter((row) => row.game_key === key);
  });
  ranked.lihan.sort((a, b) => num(a.raw_score && a.raw_score.timeUsedSeconds) - num(b.raw_score && b.raw_score.timeUsedSeconds));

  // 总榜：按 uid 聚合各游戏积分
  const totalsMap = new Map();
  best.forEach((row) => {
    const entry = totalsMap.get(row.uid) || { uid: row.uid, merit: 0, breakdown: {} };
    entry.merit += row.merit;
    entry.breakdown[row.game_key] = row.merit;
    totalsMap.set(row.uid, entry);
  });
  const rankedTotal = [...totalsMap.values()].sort((a, b) => b.merit - a.merit);

  const shape = (entry) => ({
    uid: entry.uid,
    nickname: nameOf(entry.uid),
    merit: entry.merit,
    achievedAt: entry.achieved_at,
    ...(entry.game_key === 'lihan' ? { timeUsedSeconds: num(entry.raw_score && entry.raw_score.timeUsedSeconds) } : {}),
  });

  const total = rankedTotal.slice(0, TOP).map((entry) => ({
    ...shape(entry),
    breakdown: entry.breakdown,
  }));
  const daxigua = ranked.daxigua.slice(0, TOP).map(shape);
  const hange = ranked.hange.slice(0, TOP).map(shape);
  const lihan = ranked.lihan.slice(0, TOP).map(shape);

  let me = null;
  if (uid && totalsMap.has(uid)) {
    const mine = totalsMap.get(uid);
    const indexOf = (list) => {
      const index = list.findIndex((entry) => entry.uid === uid);
      return index >= 0 ? index + 1 : null;
    };
    me = {
      uid,
      nickname: nameOf(uid),
      merit: mine.merit,
      breakdown: mine.breakdown,
      ranks: {
        total: indexOf(rankedTotal),
        daxigua: indexOf(ranked.daxigua),
        hange: indexOf(ranked.hange),
        lihan: indexOf(ranked.lihan),
      },
    };
  }

  return { ok: true, total, daxigua, hange, lihan, me };
};
