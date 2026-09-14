/**
 * SAVE HANGE 棋盘规则（纯函数，无副作用）
 *
 * 这是对局规则的唯一真相来源：UI（components/GameBoard.tsx）与关卡验证脚本
 * （scripts/verify-save-hange-levels.ts）必须共用同一套实现，不允许各自再写一份。
 *
 * ─────────────────────────────────────────────────────────────
 * 移动规则（重要：不要按「标准华容道」去"修正"它）
 * ─────────────────────────────────────────────────────────────
 * 本作不是严格华容道，而是：**只要目标格全空且不越界，任何棋子都能沿上下左右
 * 任一方向滑动**（横向棋子也能纵向滑、纵向棋子也能横向滑）。
 *
 * 这是从上线版本延续下来的既有玩法，三套关卡布局正是按此规则设计和调过的。
 * 反证（scripts/verify-save-hange-levels.ts 可复现）：一旦给横向棋子加上
 * 「只能横移」的限制，EASY 里压在出口上的始祖巨人可达位置数只有 1（彻底锁死），
 * NORMAL 里韩吉本身可达位置数只有 1（开局零合法移动），三关全部无解。
 */

import { BOARD_HEIGHT, BOARD_WIDTH, EXIT_X, EXIT_Y, TARGET_PIECE_ID } from './constants.ts';
import type { Difficulty, Piece } from './levels.ts';
import { DIFFICULTIES, clonePieces } from './levels.ts';

export interface MoveDelta {
  dx: number;
  dy: number;
}

/** 某个棋子在四个方向上最多能滑动的格数 */
export interface MoveLimits {
  maxLeft: number;
  maxRight: number;
  maxUp: number;
  maxDown: number;
}

/** 把棋子铺到 5×4 网格上，空格为 null */
export function buildOccupancy(pieces: readonly Piece[]): Array<Array<string | null>> {
  const grid: Array<Array<string | null>> = Array.from({ length: BOARD_HEIGHT }, () =>
    Array<string | null>(BOARD_WIDTH).fill(null)
  );

  for (const piece of pieces) {
    for (let row = 0; row < piece.h; row++) {
      for (let col = 0; col < piece.w; col++) {
        const gx = piece.x + col;
        const gy = piece.y + row;
        if (gx >= 0 && gx < BOARD_WIDTH && gy >= 0 && gy < BOARD_HEIGHT) {
          grid[gy][gx] = piece.id;
        }
      }
    }
  }

  return grid;
}

/**
 * 计算棋子在四个方向上的最大可滑动格数。
 * 越界或撞到其它棋子即截断（不能穿过其它棋子）；不限制滑动轴。
 */
export function getMoveLimits(pieces: readonly Piece[], piece: Piece): MoveLimits {
  const grid = buildOccupancy(pieces);

  let maxLeft = 0;
  let maxRight = 0;
  let maxUp = 0;
  let maxDown = 0;

  for (let distance = 1; piece.x - distance >= 0; distance++) {
    let clear = true;
    for (let row = 0; row < piece.h; row++) {
      const cell = grid[piece.y + row][piece.x - distance];
      if (cell !== null && cell !== piece.id) {
        clear = false;
        break;
      }
    }
    if (!clear) break;
    maxLeft = distance;
  }

  for (let distance = 1; piece.x + piece.w + distance - 1 < BOARD_WIDTH; distance++) {
    let clear = true;
    for (let row = 0; row < piece.h; row++) {
      const cell = grid[piece.y + row][piece.x + piece.w + distance - 1];
      if (cell !== null && cell !== piece.id) {
        clear = false;
        break;
      }
    }
    if (!clear) break;
    maxRight = distance;
  }

  for (let distance = 1; piece.y - distance >= 0; distance++) {
    let clear = true;
    for (let col = 0; col < piece.w; col++) {
      const cell = grid[piece.y - distance][piece.x + col];
      if (cell !== null && cell !== piece.id) {
        clear = false;
        break;
      }
    }
    if (!clear) break;
    maxUp = distance;
  }

  for (let distance = 1; piece.y + piece.h + distance - 1 < BOARD_HEIGHT; distance++) {
    let clear = true;
    for (let col = 0; col < piece.w; col++) {
      const cell = grid[piece.y + piece.h + distance - 1][piece.x + col];
      if (cell !== null && cell !== piece.id) {
        clear = false;
        break;
      }
    }
    if (!clear) break;
    maxDown = distance;
  }

  return { maxLeft, maxRight, maxUp, maxDown };
}

export function canMoveInAnyDirection(limits: MoveLimits): boolean {
  return limits.maxLeft > 0 || limits.maxRight > 0 || limits.maxUp > 0 || limits.maxDown > 0;
}

/**
 * 把一次移动请求裁剪成「一次操作、一个轴」的合法位移。
 *
 * - 按各方向剩余空间裁剪距离（拖三格但只剩一格空间 → 只走一格）
 * - 一次操作只允许一个轴：同时请求 dx 与 dy 时保留位移更大的那个轴
 *   （拖拽路径本身有轴锁定，这里是防御性保证，使实际玩法与 BFS 验证模型严格一致）
 * - 返回 {0,0} 表示本次没有任何位移 → 调用方不计步
 */
export function clampMove(piece: Piece, limits: MoveLimits, delta: MoveDelta): MoveDelta {
  const wantsX = delta.dx !== 0;
  const wantsY = delta.dy !== 0;

  const useX = wantsX && (!wantsY || Math.abs(delta.dx) >= Math.abs(delta.dy));
  const useY = wantsY && !useX;

  const dx = !useX
    ? 0
    : delta.dx < 0
      ? -Math.min(Math.abs(delta.dx), limits.maxLeft)
      : Math.min(delta.dx, limits.maxRight);

  const dy = !useY
    ? 0
    : delta.dy < 0
      ? -Math.min(Math.abs(delta.dy), limits.maxUp)
      : Math.min(delta.dy, limits.maxDown);

  return { dx, dy };
}

/**
 * 执行一次移动（允许一次滑动多格）。
 *
 * 关键约定：**没有任何实际位移时返回原数组引用本身**，
 * 调用方用 `next !== current` 即可判断「本次操作不合法 / 没动，不计步」，
 * 不需要再写深比较。
 */
export function applyMove(pieces: readonly Piece[], pieceId: string, delta: MoveDelta): Piece[] {
  const piece = pieces.find((item) => item.id === pieceId);
  if (!piece) return pieces as Piece[];

  const limits = getMoveLimits(pieces, piece);
  const { dx, dy } = clampMove(piece, limits, delta);

  if (dx === 0 && dy === 0) return pieces as Piece[];

  return (pieces as Piece[]).map((item) =>
    item.id === pieceId ? { ...item, x: item.x + dx, y: item.y + dy } : item
  );
}

/**
 * 唯一的胜利判定：韩吉（2×2）左顶点抵达出口 (1,3)，即占据底部中央 x=1~2, y=3~4。
 * UI 与验证脚本都只能调用这里，禁止另写一套判断。
 */
export function isVictory(pieces: readonly Piece[]): boolean {
  const target = pieces.find((piece) => piece.id === TARGET_PIECE_ID);
  if (!target) return false;
  return target.x === EXIT_X && target.y === EXIT_Y;
}

export function createInitialPieces(difficulty: Difficulty): Piece[] {
  return clonePieces(DIFFICULTIES[difficulty].initialPieces);
}

/** 把局面序列化成可比较的字符串（与棋子顺序无关） */
export function serializePieces(pieces: readonly Piece[]): string {
  return pieces
    .map((piece) => `${piece.id}:${piece.x},${piece.y}`)
    .sort()
    .join('|');
}

/** 枚举当前局面下所有合法的一步操作（含一次滑动多格），供 BFS 使用 */
export function enumerateMoves(
  pieces: readonly Piece[]
): Array<{ pieceId: string; delta: MoveDelta }> {
  const moves: Array<{ pieceId: string; delta: MoveDelta }> = [];

  for (const piece of pieces) {
    const limits = getMoveLimits(pieces, piece);

    for (let step = 1; step <= limits.maxLeft; step++) moves.push({ pieceId: piece.id, delta: { dx: -step, dy: 0 } });
    for (let step = 1; step <= limits.maxRight; step++) moves.push({ pieceId: piece.id, delta: { dx: step, dy: 0 } });
    for (let step = 1; step <= limits.maxUp; step++) moves.push({ pieceId: piece.id, delta: { dx: 0, dy: -step } });
    for (let step = 1; step <= limits.maxDown; step++) moves.push({ pieceId: piece.id, delta: { dx: 0, dy: step } });
  }

  return moves;
}
