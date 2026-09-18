const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const db = app.rdb({ database: 'public' });

function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * 归一化公式必须与前端保持一致：
 *   src/utils/gameScores.ts → meritOf() / MERIT_TUNING
 * 改任一端都要同步改另一端，否则本地预估与入库值会对不上。
 * 〔待校准〕基准值是按经验拍的，采样后需调整。
 */
const TUNING = {
  daxiguaScoreCap: 3000,
  hangeParMoves: 30,
  hangeWinBase: 400,
  hangeTimeBonusMax: 300,
  hangeMoveBonusMax: 300,
  meritCap: 1000,
};

/** 与 save-hange 的 FALLBACK_TRACK_SECONDS 保持一致（终曲全长 3:56） */
const FALLBACK_TRACK_SECONDS = 236;
const VALID_KEYS = ['daxigua', 'hange'];
/** 每人每游戏每日最多提交次数，防脚本刷榜 */
const DAILY_LIMIT = 30;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function meritOf(gameKey, raw) {
  if (gameKey === 'daxigua') {
    const score = Math.max(0, Math.round(num(raw.score)));
    return Math.round((Math.min(score, TUNING.daxiguaScoreCap) / TUNING.daxiguaScoreCap) * TUNING.meritCap);
  }
  const duration = num(raw.duration) > 0 ? num(raw.duration) : FALLBACK_TRACK_SECONDS;
  const used = Math.max(0, Math.min(num(raw.timeUsedSeconds), duration));
  const timeFactor = clamp01((duration - used) / duration);
  const moveFactor = clamp01(1 - (num(raw.moves) - TUNING.hangeParMoves) / TUNING.hangeParMoves);
  return Math.round(
    TUNING.hangeWinBase + TUNING.hangeTimeBonusMax * timeFactor + TUNING.hangeMoveBonusMax * moveFactor
  );
}

exports.main = async (event) => {
  const { uid } = app.auth().getUserInfo();
  if (!uid) throw new Error('AUTH_REQUIRED');

  const gameKey = String(event.gameKey || '');
  if (!VALID_KEYS.includes(gameKey)) throw new Error('BAD_GAME_KEY');

  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const merit = meritOf(gameKey, raw);
  if (merit <= 0) throw new Error('NO_MERIT');

  const profiles = data(await db.from('users').select('nickname,role').eq('uid', uid).limit(1));
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  if (!profile) throw new Error('PROFILE_REQUIRED');
  if (profile.role === 'banned') throw new Error('USER_BANNED');

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = data(
    await db
      .from('game_scores')
      .select('id')
      .eq('uid', uid)
      .eq('game_key', gameKey)
      .gte('created_at', startOfDay.toISOString())
  );
  if (Array.isArray(today) && today.length >= DAILY_LIMIT) throw new Error('RATE_LIMITED');

  const now = new Date().toISOString();
  data(
    await db.from('game_scores').insert({
      uid,
      nickname: profile.nickname,
      game_key: gameKey,
      merit,
      raw_score: raw,
      created_at: now,
    })
  );

  const existing = data(await db.from('game_best').select('merit').eq('uid', uid).eq('game_key', gameKey).limit(1));
  const prev = Array.isArray(existing) ? existing[0] : existing;
  const improved = !prev || merit > prev.merit;

  if (improved) {
    const payload = { uid, game_key: gameKey, merit, raw_score: raw, achieved_at: now };
    if (prev) {
      data(await db.from('game_best').update(payload).eq('uid', uid).eq('game_key', gameKey));
    } else {
      data(await db.from('game_best').insert(payload));
    }
  }

  return { ok: true, merit, improved, best: improved ? merit : prev.merit };
};
