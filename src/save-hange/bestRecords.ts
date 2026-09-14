/**
 * 本机最佳纪录（localStorage）
 *
 * 主站排行榜弹窗（TatakaruGame）与 iframe 内的游戏同源，共用同一个键。
 *
 * 排序规则：第一优先 timeUsed 越小越好；timeUsed 相同时再比 moves 越小越好。
 * 存的是「完成用时」，绝对不要改成剩余时间。
 */

import { BEST_RECORD_KEY } from './constants.ts';
import type { Difficulty } from './levels.ts';

export interface BestRecord {
  difficulty: Difficulty;
  /** 完成用时（秒，取自 audio.currentTime） */
  timeUsed: number;
  /** 移动操作次数 */
  moves: number;
  ts: number;
}

export type BestRecords = Partial<Record<Difficulty, BestRecord>>;

export function readBestRecords(): BestRecords {
  try {
    const raw = localStorage.getItem(BEST_RECORD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as BestRecords;
  } catch {
    // 私密模式 / 存储被禁用时静默降级
    return {};
  }
}

/** 写入更优成绩；确实刷新了纪录返回 true */
export function saveBestRecord(difficulty: Difficulty, timeUsed: number, moves: number): boolean {
  try {
    const all = readBestRecords();
    const previous = all[difficulty];

    const isBetter =
      !previous ||
      timeUsed < previous.timeUsed ||
      (timeUsed === previous.timeUsed && moves < previous.moves);

    if (!isBetter) return false;

    all[difficulty] = {
      difficulty,
      timeUsed,
      moves,
      ts: Date.now(),
    };
    localStorage.setItem(BEST_RECORD_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
