/**
 * SAVE HANGE 输入层
 *
 * 这里只放「把玩家手势翻译成一次移动意图」的纯逻辑：拖拽激活阈值、轴向锁定、
 * 边界裁剪、松手吸附、键盘方向映射。
 *
 * 组件（components/GameBoard.tsx）负责事件绑定与渲染，规则判定交给 gameLogic，
 * 三者职责不要混在一起。
 */

import type { MoveDelta, MoveLimits } from './gameLogic';

export type Axis = 'x' | 'y';

/**
 * 拖拽激活阈值（px）。小于该位移视为「点击」，只做选中，不进入拖拽。
 * 取值偏小以免手感发黏，同时又能滤掉触摸时的自然抖动。
 */
export const DRAG_ACTIVATION_PX = 4;

/** 键盘方向映射：方向键与 WASD 等价，每次输入 = 单格移动 */
export const KEY_DIRECTION_BY_CODE: Record<string, MoveDelta> = {
  ArrowUp: { dx: 0, dy: -1 },
  KeyW: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  KeyS: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  KeyA: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
};

/** 位移是否已经大到应该进入拖拽（而不是当成点击） */
export function shouldActivateDrag(rawDx: number, rawDy: number): boolean {
  return Math.abs(rawDx) > DRAG_ACTIVATION_PX || Math.abs(rawDy) > DRAG_ACTIVATION_PX;
}

/**
 * 轴向锁定。
 *
 * 为什么不按「横向棋子只能横移」来锁：
 *   本作的棋盘规则是宽松滑块规则（见 gameLogic.ts 的说明与反证）——只要空间允许，
 *   任何棋子都能沿任一方向滑动。若在这里按棋子类型锁死轴向，EASY 里压在出口上的
 *   始祖巨人将永远无法下移，三关全部无解（有 BFS 证据）。
 *   所以轴向锁定只用于「抑制轻微斜向拖动造成的抖动」，依据是当前棋子的合法可动范围：
 *     1. 只有一个轴可动 → 锁那个轴
 *     2. 两个轴都可动 → 按初始运动方向的主分量锁定（|dx| > |dy| 锁 x，否则锁 y）
 *     3. 都不能动 → 不锁定（松手即回弹）
 *   一旦锁定就不再改变，避免拖到一半突然换轴。
 */
export function resolveDragAxis(
  rawDx: number,
  rawDy: number,
  limits: MoveLimits,
  locked: Axis | null
): Axis | null {
  if (locked) return locked;

  const canX = (rawDx < 0 && limits.maxLeft > 0) || (rawDx > 0 && limits.maxRight > 0);
  const canY = (rawDy < 0 && limits.maxUp > 0) || (rawDy > 0 && limits.maxDown > 0);

  if (canX && !canY) return 'x';
  if (canY && !canX) return 'y';
  if (!canX && !canY) return null;

  return Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y';
}

/**
 * 把拖拽位移裁剪到当前方向的最大合法距离内。
 * 越界或撞到其它棋子的部分直接被吃掉 —— 棋子停在最大合法位置，绝不穿模。
 */
export function clampDragOffset(rawPx: number, maxCells: number, cellPx: number): number {
  if (maxCells <= 0 || cellPx <= 0) return 0;
  const limit = Math.min(maxCells, 1) * cellPx;
  return Math.max(-limit, Math.min(limit, rawPx));
}

/**
 * 松手吸附：位移不足半格回弹，超过半格吸附到最近合法格。
 * 返回本次吸附跨越的格数（可能为 0 = 回弹）。
 */
export function resolveSnap(offsetPx: number, cellPx: number): number {
  if (cellPx <= 0) return 0;
  return Math.max(-1, Math.min(1, Math.round(offsetPx / cellPx)));
}
