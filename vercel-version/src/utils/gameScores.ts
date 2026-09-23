/**
 * 头号玩家（三游戏排行榜）· 前端数据层
 *
 * 参与榜单的游戏共三款：
 *   - daxigua 利韩·合成大西皮（全难度都记）
 *   - hange   利韩·拯救韩吉（只有「绝境」难度突围成功才记）
 *   - lihan   利韩·利了个韩（按通关时间升序）
 *
 * 归一化公式必须与云函数保持一致：
 *   cloudbase/functions/submitGameScore/index.js → meritOf()
 * 改任一端都要同步改另一端，否则本地预估值与入库值会对不上。
 */
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from './cloudbaseEndpoint';
import { getSessionToken } from './cloudbaseToken';
import { FALLBACK_TRACK_SECONDS } from '../save-hange/constants';

/**
 * 为什么不用 @cloudbase/js-sdk 的 callFunction：
 * SDK 走的是 <env>.<region>.tcb-api 网关，要校验「WEB 安全域名」，
 * 而控制台那份白名单里只有 tcloudbaseapp / *.preview.cloudbase.net 等，
 * 没有 levihan.asia —— 浏览器端一律回 INVALID_REQUEST_SOURCE。
 * 且全站登录是自建会话（Authorization: Bearer），SDK 侧并没有 CloudBase 登录态，
 * 云函数里的 app.auth().getUserInfo() 恒为空。
 * 所以这里跟公告/论坛/市集一样，统一走 HTTP 访问服务直连。
 */
async function postLeaderboard(
  body: Record<string, unknown>,
  token?: string | null
): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !result || result.ok !== true) return null;
  return result;
}

export type GameKey = 'daxigua' | 'hange' | 'lihan';

export const GAME_KEYS: readonly GameKey[] = ['daxigua', 'hange', 'lihan'] as const;

export const GAME_META: Record<GameKey, { short: string; emoji: string; color: string }> = {
  daxigua: { short: '大西皮', emoji: '🍉', color: '#3B6D11' },
  hange: { short: '拯救韩吉', emoji: '🛡️', color: '#534AB7' },
  lihan: { short: '利了个韩', emoji: '🥔', color: '#B7791F' },
};

export interface DaxiguaRaw {
  score: number;
}

export interface HangeRaw {
  /** 突围所用步数 */
  moves: number;
  /** 突围所用秒数（取自 BGM currentTime） */
  timeUsedSeconds: number;
  /** 终曲全长（秒） */
  duration: number;
  outcome: 'win';
}

export interface LihanRaw {
  timeUsedSeconds: number;
  outcome: 'win';
}

export type GameRaw = DaxiguaRaw | HangeRaw | LihanRaw;

/**
 * 归一化基准值 —— 〔待校准〕
 * 目前是按经验拍的，需要各打若干局采样后再调，改这里即可，云函数需同步。
 */
export const MERIT_TUNING = {
  /** 大西皮分数封顶，超过即满积分（同时也是对无敌模式刷分的兜底） */
  daxiguaScoreCap: 3000,
  /** 拯救韩吉「标准杆」步数：打到这个步数拿满步数奖励 */
  hangeParMoves: 30,
  hangeWinBase: 400,
  hangeTimeBonusMax: 300,
  hangeMoveBonusMax: 300,
  /** 利了个韩 15 分钟内通关按耗时折算综合榜积分；单项榜始终按真实耗时排序 */
  lihanBenchmarkSeconds: 900,
  meritCap: 1000,
} as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function meritForDaxigua(raw: DaxiguaRaw): number {
  const score = Number.isFinite(raw?.score) ? Math.max(0, Math.round(raw.score)) : 0;
  return Math.round(Math.min(score, MERIT_TUNING.daxiguaScoreCap) / MERIT_TUNING.daxiguaScoreCap * MERIT_TUNING.meritCap);
}

/**
 * 拯救韩吉只有突围成功才计入，所以这里不处理失败态。
 * 积分 = 突围基础分 + 剩余时间奖励 + 步数节省奖励
 */
export function meritForHange(raw: HangeRaw): number {
  const duration = raw?.duration > 0 ? raw.duration : FALLBACK_TRACK_SECONDS;
  const used = Math.max(0, Math.min(raw?.timeUsedSeconds || 0, duration));
  const timeFactor = clamp01((duration - used) / duration);
  const moveFactor = clamp01(1 - ((raw?.moves || 0) - MERIT_TUNING.hangeParMoves) / MERIT_TUNING.hangeParMoves);
  return Math.round(
    MERIT_TUNING.hangeWinBase +
      MERIT_TUNING.hangeTimeBonusMax * timeFactor +
      MERIT_TUNING.hangeMoveBonusMax * moveFactor
  );
}

export function meritForLihan(raw: LihanRaw): number {
  const used = Number.isFinite(raw?.timeUsedSeconds) ? Math.max(1, raw.timeUsedSeconds) : 0;
  if (!used) return 0;
  return Math.max(1, Math.round((1 - clamp01(used / MERIT_TUNING.lihanBenchmarkSeconds)) * (MERIT_TUNING.meritCap - 1)) + 1);
}

export function meritOf(gameKey: GameKey, raw: GameRaw): number {
  if (gameKey === 'daxigua') return meritForDaxigua(raw as DaxiguaRaw);
  if (gameKey === 'hange') return meritForHange(raw as HangeRaw);
  return meritForLihan(raw as LihanRaw);
}

/* ---------------- 本机最佳（未登录时的兜底） ---------------- */

const LOCAL_KEY = 'levihan.gameBest.v1';

export type LocalBest = Partial<Record<GameKey, number>>;

export function readLocalBest(): LocalBest {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalBest(gameKey: GameKey, merit: number): boolean {
  const current = readLocalBest();
  if ((current[gameKey] || 0) >= merit) return false;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...current, [gameKey]: merit }));
  } catch {
    /* 私密模式忽略 */
  }
  return true;
}

/* ---------------- 提交与拉取 ---------------- */

export interface SubmitResult {
  merit: number;
  /** 是否刷新了自己的纪录 */
  improved: boolean;
  /** true 表示只写在本地（未登录或云端不可用），未进云端榜 */
  localOnly: boolean;
}

/** 自建会话 token；uid 由后端凭 token 反查，前端只判断「有没有登录」 */
function currentToken(): string | null {
  return getSessionToken();
}

/**
 * 提交一次成绩。永远不抛错 —— 打游戏时任何上报失败都不该打断玩家。
 */
export async function submitScore(gameKey: GameKey, raw: GameRaw): Promise<SubmitResult> {
  if (!GAME_KEYS.includes(gameKey)) return { merit: 0, improved: false, localOnly: true };

  const merit = meritOf(gameKey, raw);
  if (merit <= 0) return { merit: 0, improved: false, localOnly: true };

  const localImproved = writeLocalBest(gameKey, merit);
  const token = currentToken();
  if (!token) return { merit, improved: localImproved, localOnly: true };

  const result = await postLeaderboard({ action: 'submitScore', gameKey, raw }, token).catch(() => null);
  // 云端不可用时静默退回本机成绩，绝不打断正在打游戏的人
  if (!result) return { merit, improved: localImproved, localOnly: true };
  return { merit, improved: result.improved === true, localOnly: false };
}

export interface LeaderboardRow {
  uid: string;
  nickname: string;
  merit: number;
  achievedAt?: string;
  timeUsedSeconds?: number;
}

export interface TotalRow extends LeaderboardRow {
  breakdown: Partial<Record<GameKey, number>>;
}

export interface LeaderboardData {
  total: TotalRow[];
  daxigua: LeaderboardRow[];
  hange: LeaderboardRow[];
  lihan: LeaderboardRow[];
  me: (TotalRow & { ranks: Partial<Record<'total' | GameKey, number>> }) | null;
}

/**
 * 拉取榜单。云函数尚未部署时返回 null，由 UI 显示「尚未开通」而不是报错。
 */
export async function fetchLeaderboard(): Promise<LeaderboardData | null> {
  // 带 token 时后端会额外返回「我的战绩」，游客也能看公开榜
  const result = await postLeaderboard({ action: 'leaderboard' }, currentToken()).catch(() => null);
  if (!result || !Array.isArray(result.total)) return null;
  const data = result as unknown as LeaderboardData;
  return {
    ...data,
    total: Array.isArray(data.total) ? data.total : [],
    daxigua: Array.isArray(data.daxigua) ? data.daxigua : [],
    hange: Array.isArray(data.hange) ? data.hange : [],
    lihan: Array.isArray(data.lihan) ? data.lihan : [],
  };
}
