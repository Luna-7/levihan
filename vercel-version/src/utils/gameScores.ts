/**
 * 头号玩家（三游戏排行榜）· 前端数据层
 *
 * 参与榜单的游戏只有两款（2026-09-17 定）：
 *   - daxigua 利韩·合成大西皮（全难度都记）
 *   - hange   利韩·拯救韩吉（只有「绝境」难度突围成功才记）
 *   - lihan   利韩·利了个韩 —— 暂不参与头号玩家，不参与任何计算
 *
 * 归一化公式必须与云函数保持一致：
 *   cloudbase/functions/submitGameScore/index.js → meritOf()
 * 改任一端都要同步改另一端，否则本地预估值与入库值会对不上。
 */
import { cloudbase } from './cloudbase';
import { FALLBACK_TRACK_SECONDS } from '../save-hange/constants';

export type GameKey = 'daxigua' | 'hange';

export const GAME_KEYS: readonly GameKey[] = ['daxigua', 'hange'] as const;

export const GAME_META: Record<GameKey, { short: string; emoji: string; color: string }> = {
  daxigua: { short: '大西皮', emoji: '🍉', color: '#3B6D11' },
  hange: { short: '拯救韩吉', emoji: '🛡️', color: '#534AB7' },
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

export type GameRaw = DaxiguaRaw | HangeRaw;

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

export function meritOf(gameKey: GameKey, raw: GameRaw): number {
  return gameKey === 'daxigua' ? meritForDaxigua(raw as DaxiguaRaw) : meritForHange(raw as HangeRaw);
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

async function currentUid(): Promise<string | null> {
  try {
    const user = await cloudbase.auth().getCurrentUser();
    return user?.uid || null;
  } catch {
    return null;
  }
}

/**
 * 提交一次成绩。永远不抛错 —— 打游戏时任何上报失败都不该打断玩家。
 */
export async function submitScore(gameKey: GameKey, raw: GameRaw): Promise<SubmitResult> {
  if (!GAME_KEYS.includes(gameKey)) return { merit: 0, improved: false, localOnly: true };

  const merit = meritOf(gameKey, raw);
  if (merit <= 0) return { merit: 0, improved: false, localOnly: true };

  const localImproved = writeLocalBest(gameKey, merit);
  const uid = await currentUid();
  if (!uid) return { merit, improved: localImproved, localOnly: true };

  try {
    const response = await cloudbase.callFunction({ name: 'submitGameScore', data: { gameKey, raw } });
    const result = (response as { result?: { improved?: boolean } })?.result || (response as { improved?: boolean });
    return { merit, improved: result?.improved === true, localOnly: false };
  } catch {
    return { merit, improved: localImproved, localOnly: true };
  }
}

export interface LeaderboardRow {
  uid: string;
  nickname: string;
  merit: number;
  achievedAt?: string;
}

export interface TotalRow extends LeaderboardRow {
  breakdown: Partial<Record<GameKey, number>>;
}

export interface LeaderboardData {
  total: TotalRow[];
  daxigua: LeaderboardRow[];
  hange: LeaderboardRow[];
  me: (TotalRow & { ranks: Partial<Record<'total' | GameKey, number>> }) | null;
}

/**
 * 拉取榜单。云函数尚未部署时返回 null，由 UI 显示「尚未开通」而不是报错。
 */
export async function fetchLeaderboard(): Promise<LeaderboardData | null> {
  try {
    const response = await cloudbase.callFunction({ name: 'getGameLeaderboard', data: {} });
    // 云函数返回体可能直接是数据，也可能包一层 { result }，两种都兼容
    const payload = (response as unknown as { result?: unknown } | null)?.result;
    const result = (payload ?? response) as LeaderboardData | null;
    if (!result || !Array.isArray(result.total)) return null;
    return result;
  } catch {
    return null;
  }
}
