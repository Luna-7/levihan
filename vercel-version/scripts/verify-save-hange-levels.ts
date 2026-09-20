/**
 * SAVE HANGE 关卡验证：三关是否可解 + 最少移动操作数
 *
 * 运行：node scripts/verify-save-hange-levels.ts
 *
 * 算法：前向 BFS（层序），但状态不是对象数组，而是把 10 个棋子的格坐标
 * 各用 5 bit 打包成一个 < 2^50 的整数；已访问集合用定长开放寻址哈希表
 * （Float64Array）实现，避免 Map/对象带来的内存与 GC 开销。
 *
 * 规模实测（宽松规则）：EASY 约 71 万状态、HARD 约 293 万状态、
 * NORMAL 更大（此前用对象表示法在 400 万状态 / 深度 65 时仍未收敛）。
 *
 * 规则一致性：快速邻居生成器必须与游戏规则 (src/save-hange/gameLogic.ts)
 * 完全等价，脚本会对搜索中抽样到的局面逐状态交叉校验，不一致直接判失败。
 */

import { BOARD_HEIGHT, BOARD_WIDTH, EXIT_X, EXIT_Y, TARGET_PIECE_ID } from '../src/save-hange/constants.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/save-hange/levels.ts';
import type { Difficulty, Piece } from '../src/save-hange/levels.ts';
import { applyMove, enumerateMoves, serializePieces } from '../src/save-hange/gameLogic.ts';

const CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT;
const PIECE_COUNT = DIFFICULTIES.easy.initialPieces.length;
const BITS = 5; // 20 格 → 0~19，5 bit 足够

if (PIECE_COUNT !== 10) {
  throw new Error(`打包编码假定 10 个棋子，当前为 ${PIECE_COUNT}`);
}

interface PieceMeta {
  id: string;
  name: string;
  type: Piece['type'];
  w: number;
  h: number;
  /** 相对左顶点的格偏移 */
  offsets: number[];
  /** 位权：该子位置变化 d 格 → 打包整数变化 d * weight */
  weight: number;
}

/** 三关棋子集合一致、仅坐标不同，故元数据取任意一关即可 */
const META: PieceMeta[] = DIFFICULTIES.easy.initialPieces.map((piece, index) => {
  const offsets: number[] = [];
  for (let row = 0; row < piece.h; row++) {
    for (let col = 0; col < piece.w; col++) offsets.push(row * BOARD_WIDTH + col);
  }
  return {
    id: piece.id,
    name: piece.name,
    type: piece.type,
    w: piece.w,
    h: piece.h,
    offsets,
    weight: 2 ** (BITS * (PIECE_COUNT - 1 - index)),
  };
});

const HANGE_INDEX = META.findIndex((piece) => piece.id === TARGET_PIECE_ID);
const EXIT_CELL = EXIT_Y * BOARD_WIDTH + EXIT_X;

function layoutKey(difficulty: Difficulty): number {
  let key = 0;
  DIFFICULTIES[difficulty].initialPieces.forEach((piece, index) => {
    key += (piece.y * BOARD_WIDTH + piece.x) * META[index].weight;
  });
  return key;
}

/** 韩吉是否已在出口（O(1) 取出） */
function isGoalKey(key: number): boolean {
  return Math.floor(key / META[HANGE_INDEX].weight) % 32 === EXIT_CELL;
}

function keyToPieces(key: number): Piece[] {
  const pieces: Piece[] = new Array(PIECE_COUNT);
  for (let i = PIECE_COUNT - 1; i >= 0; i--) {
    const position = key % 32;
    key = Math.floor(key / 32);
    const meta = META[i];
    pieces[i] = {
      id: meta.id,
      name: meta.name,
      type: meta.type,
      w: meta.w,
      h: meta.h,
      x: position % BOARD_WIDTH,
      y: Math.floor(position / BOARD_WIDTH),
    };
  }
  return pieces;
}

/* ---------- 复用缓冲区，避免每个状态都分配数组 ---------- */

const scratchPositions = new Int32Array(PIECE_COUNT);
const scratchGrid = new Int8Array(CELL_COUNT);

/** 沿单一方向最多滑动几格（dx/dy 只有一个非 0） */
function travel(pieceIndex: number, x: number, y: number, w: number, h: number, dx: number, dy: number): number {
  let max = 0;

  for (let distance = 1; ; distance++) {
    const nx = x + dx * distance;
    const ny = y + dy * distance;
    if (nx < 0 || ny < 0 || nx + w > BOARD_WIDTH || ny + h > BOARD_HEIGHT) break;

    let clear = true;
    for (let row = 0; row < h && clear; row++) {
      for (let col = 0; col < w; col++) {
        const occupant = scratchGrid[(ny + row) * BOARD_WIDTH + (nx + col)];
        if (occupant !== -1 && occupant !== pieceIndex) {
          clear = false;
          break;
        }
      }
    }
    if (!clear) break;
    max = distance;
  }

  return max;
}

/** 把 key 的邻居写进 out（复用数组），返回个数 */
function neighborsOf(key: number, out: number[]): number {
  let rest = key;
  for (let i = PIECE_COUNT - 1; i >= 0; i--) {
    scratchPositions[i] = rest % 32;
    rest = Math.floor(rest / 32);
  }

  scratchGrid.fill(-1);
  for (let i = 0; i < PIECE_COUNT; i++) {
    const base = scratchPositions[i];
    const offsets = META[i].offsets;
    for (let o = 0; o < offsets.length; o++) scratchGrid[base + offsets[o]] = i;
  }

  let count = 0;

  for (let i = 0; i < PIECE_COUNT; i++) {
    const meta = META[i];
    const cell = scratchPositions[i];
    const x = cell % BOARD_WIDTH;
    const y = Math.floor(cell / BOARD_WIDTH);

    const maxLeft = travel(i, x, y, meta.w, meta.h, -1, 0);
    const maxRight = travel(i, x, y, meta.w, meta.h, 1, 0);
    const maxUp = travel(i, x, y, meta.w, meta.h, 0, -1);
    const maxDown = travel(i, x, y, meta.w, meta.h, 0, 1);

    for (let d = 1; d <= maxLeft; d++) out[count++] = key - d * meta.weight;
    for (let d = 1; d <= maxRight; d++) out[count++] = key + d * meta.weight;
    for (let d = 1; d <= maxUp; d++) out[count++] = key - d * BOARD_WIDTH * meta.weight;
    for (let d = 1; d <= maxDown; d++) out[count++] = key + d * BOARD_WIDTH * meta.weight;
  }

  out.length = count;
  return count;
}

/* ---------- 定长开放寻址哈希集合（存 key + 1，0 表示空槽） ---------- */

class KeySet {
  private slots: Float64Array;
  private mask: number;
  private size = 0;

  constructor(capacity: number) {
    let length = 1;
    while (length < capacity) length *= 2;
    this.slots = new Float64Array(length);
    this.mask = length - 1;
  }

  get count(): number {
    return this.size;
  }

  private hash(key: number): number {
    const low = key % 4294967296;
    const high = (key - low) / 4294967296;
    let h = (low ^ Math.imul(high, 2654435761)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h & this.mask;
  }

  /** 新增成功返回 true，已存在返回 false */
  add(key: number): boolean {
    if (this.size * 10 >= this.slots.length * 6) this.grow();

    const stored = key + 1;
    let index = this.hash(key);

    for (;;) {
      const value = this.slots[index];
      if (value === 0) {
        this.slots[index] = stored;
        this.size += 1;
        return true;
      }
      if (value === stored) return false;
      index = (index + 1) & this.mask;
    }
  }

  private grow(): void {
    const previous = this.slots;
    const next = new Float64Array(previous.length * 2);
    this.slots = next;
    this.mask = next.length - 1;

    for (let i = 0; i < previous.length; i++) {
      const value = previous[i];
      if (value === 0) continue;
      let index = this.hash(value - 1);
      while (next[index] !== 0) index = (index + 1) & this.mask;
      next[index] = value;
    }
  }
}

/* ---------- 与游戏规则逐状态交叉校验 ---------- */

const CROSS_CHECK_SAMPLES = 150;

function crossCheck(key: number): string | null {
  const pieces = keyToPieces(key);
  const expected = new Set(
    enumerateMoves(pieces).map((move) => serializePieces(applyMove(pieces, move.pieceId, move.delta)))
  );

  const buffer: number[] = [];
  const count = neighborsOf(key, buffer);
  const actual = new Set<string>();
  for (let i = 0; i < count; i++) actual.add(serializePieces(keyToPieces(buffer[i])));

  if (expected.size !== actual.size) {
    return `局面 ${serializePieces(pieces)} 邻居数不一致：gameLogic=${expected.size} 快速生成器=${actual.size}`;
  }
  for (const item of expected) {
    if (!actual.has(item)) return `局面 ${serializePieces(pieces)} 缺少邻居 ${item}`;
  }
  for (const item of actual) {
    if (!expected.has(item)) return `局面 ${serializePieces(pieces)} 多出邻居 ${item}`;
  }
  return null;
}

interface SolveResult {
  solvable: boolean;
  optimalMoves: number | null;
  exploredStates: number;
  elapsedMs: number;
  crossChecked: number;
  crossCheckError: string | null;
}

function solve(difficulty: Difficulty, verbose: boolean): SolveResult {
  const startedAt = Date.now();
  const root = layoutKey(difficulty);
  const visited = new KeySet(1 << 16);
  const neighborBuffer: number[] = [];

  let crossChecked = 0;
  let crossCheckError: string | null = null;

  const finish = (solvable: boolean, optimalMoves: number | null): SolveResult => ({
    solvable,
    optimalMoves,
    exploredStates: visited.count,
    elapsedMs: Date.now() - startedAt,
    crossChecked,
    crossCheckError,
  });

  if (isGoalKey(root)) return finish(true, 0);

  visited.add(root);
  let frontier: number[] = [root];
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    const next: number[] = [];

    for (const key of frontier) {
      if (crossCheckError === null && crossChecked < CROSS_CHECK_SAMPLES) {
        crossChecked += 1;
        crossCheckError = crossCheck(key);
      }

      const count = neighborsOf(key, neighborBuffer);
      for (let i = 0; i < count; i++) {
        const neighbor = neighborBuffer[i];
        if (isGoalKey(neighbor)) return finish(true, depth);
        if (visited.add(neighbor)) next.push(neighbor);
      }
    }

    if (verbose && (depth <= 5 || depth % 10 === 0)) {
      console.log(`  [${difficulty}] depth ${depth} · states ${visited.count} · ${Date.now() - startedAt}ms`);
    }

    frontier = next;
  }

  return finish(false, null);
}

/** 需求给出的建议区间：仅作参考输出，不参与通过/失败判定 */
const SUGGESTED_RANGES: Record<Difficulty, [number, number]> = {
  easy: [15, 25],
  normal: [30, 50],
  hard: [60, 100],
};

function main(): void {
  const verbose = !process.argv.includes('--quiet');

  console.log('SAVE HANGE LEVEL VERIFICATION');
  console.log('');

  const results = new Map<Difficulty, SolveResult>();
  let crossCheckFailure = false;

  for (const difficulty of DIFFICULTY_ORDER) {
    if (verbose) console.log(`搜索 ${difficulty.toUpperCase()} ...`);
    const result = solve(difficulty, verbose);
    results.set(difficulty, result);

    console.log(difficulty.toUpperCase());
    console.log(`solvable: ${result.solvable}`);
    console.log(`optimal moves: ${result.optimalMoves ?? 'unreachable'}`);
    console.log(`explored states: ${result.exploredStates}`);
    console.log(`suggested range: ${SUGGESTED_RANGES[difficulty][0]}-${SUGGESTED_RANGES[difficulty][1]}`);
    console.log(`rules cross-checked against gameLogic: ${result.crossChecked} states`);
    console.log(`elapsed: ${result.elapsedMs}ms`);
    console.log('');

    if (result.crossCheckError) {
      crossCheckFailure = true;
      console.error(`规则不一致：${result.crossCheckError}`);
    }
  }

  const allSolvable = DIFFICULTY_ORDER.every((difficulty) => results.get(difficulty)!.solvable);
  const easy = results.get('easy')!.optimalMoves ?? Number.POSITIVE_INFINITY;
  const normal = results.get('normal')!.optimalMoves ?? Number.POSITIVE_INFINITY;
  const hard = results.get('hard')!.optimalMoves ?? Number.POSITIVE_INFINITY;
  const monotonic = easy < normal && normal < hard;

  console.log(`all levels solvable: ${allSolvable}`);
  console.log(`difficulty monotonic (easy < normal < hard): ${monotonic}`);
  console.log(`optimal moves: easy=${easy} normal=${normal} hard=${hard}`);
  console.log(`rules equivalent to gameLogic: ${!crossCheckFailure}`);

  if (!allSolvable || !monotonic || crossCheckFailure) {
    console.error('');
    console.error('FAILED: 关卡验证未通过');
    process.exit(1);
  }

  console.log('');
  console.log('PASSED');
}

main();
