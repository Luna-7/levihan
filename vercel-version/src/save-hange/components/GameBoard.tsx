import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CharacterArt } from '../data/characters';
import type { Piece } from '../levels';
import type { MoveDelta, MoveLimits } from '../gameLogic';
import { getMoveLimits } from '../gameLogic';
import type { Axis } from '../input';
import {
  KEY_DIRECTION_BY_CODE,
  clampDragOffset,
  resolveDragAxis,
  resolveSnap,
  shouldActivateDrag,
} from '../input';
import { soundManager } from '../audio';
import { Plane } from 'lucide-react';

interface GameBoardProps {
  pieces: Piece[];
  /**
   * 请求执行一次移动。返回 true 表示棋盘确实发生了变化
   * （宿主据此计 1 次移动）；返回 false 表示本次操作没有产生任何位移。
   */
  onMovePiece: (pieceId: string, delta: MoveDelta) => boolean;
  /** 终局（胜利或失败）后棋盘不再响应任何操作 */
  isGameOver: boolean;
}

interface DragState {
  pieceId: string;
  startX: number;
  startY: number;
  /** 已裁剪到合法范围内的跟随位移（px） */
  offsetX: number;
  offsetY: number;
  axis: Axis | null;
  /** 按下瞬间的合法可动范围快照 */
  limits: MoveLimits;
  /** 落点幽灵预览用的起始格坐标与尺寸 */
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

/** 触感反馈（无振动硬件时静默降级） */
const haptic = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
};

export const GameBoard: React.FC<GameBoardProps> = ({ pieces, onMovePiece, isGameOver }) => {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  /**
   * 真实拖拽结束后要吞掉紧随其后的 click。
   * pointerup 与 click 是两次独立事件，不隔离的话一次拖拽会被执行两次。
   */
  const suppressClickRef = useRef<boolean>(false);

  /** 某棋子四个方向各能滑几格（规则唯一来源是 gameLogic） */
  const limitsOf = useCallback((piece: Piece) => getMoveLimits(pieces, piece), [pieces]);

  /** 「推不动」反馈：轻微抖动 + 短促失败音 + 轻触感 */
  const flashBlocked = useCallback((pieceId: string) => {
    setShakeId(pieceId);
    soundManager.playBlockedSound();
    haptic(20);
    window.setTimeout(() => setShakeId((cur) => (cur === pieceId ? null : cur)), 320);
  }, []);

  /** 选中：只改选中态，绝不移动棋子 */
  const selectPiece = useCallback(
    (pieceId: string) => {
      if (selectedPieceId !== pieceId) {
        soundManager.playSelectSound();
        setSelectedPieceId(pieceId);
      }
    },
    [selectedPieceId]
  );

  /**
   * 点击 = 只选中，不移动。
   *
   * 早期版本会按「下 > 右 > 左 > 上」的固定优先级自动走一格，那正是
   * 「点一下就自己动了」的根源，已彻底移除。现在改变棋子位置只有两条路径：
   * 拖拽，或键盘方向键。
   */
  const handlePieceClick = useCallback(
    (piece: Piece) => {
      if (isGameOver) return;

      // 刚刚发生过真实拖拽 → 这次 click 只是手势的尾巴，直接吞掉
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      selectPiece(piece.id);
    },
    [isGameOver, selectPiece]
  );

  /* ---------- 拖拽 ---------- */

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, piece: Piece) => {
      if (isGameOver) return;

      selectPiece(piece.id);

      isDraggingRef.current = false;
      suppressClickRef.current = false;

      setDragState({
        pieceId: piece.id,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: 0,
        offsetY: 0,
        axis: null,
        limits: limitsOf(piece),
        gx: piece.x,
        gy: piece.y,
        gw: piece.w,
        gh: piece.h,
      });

      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [isGameOver, limitsOf, selectPiece]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragState || !boardRef.current || isGameOver) return;

      const rect = boardRef.current.getBoundingClientRect();
      const cellWidth = rect.width / 4;
      const cellHeight = rect.height / 5;

      const rawDx = event.clientX - dragState.startX;
      const rawDy = event.clientY - dragState.startY;

      if (!isDraggingRef.current && shouldActivateDrag(rawDx, rawDy)) {
        isDraggingRef.current = true;
      }

      setDragState((prev) => {
        if (!prev) return null;

        const axis = resolveDragAxis(rawDx, rawDy, prev.limits, prev.axis);
        const maxX = rawDx < 0 ? prev.limits.maxLeft : prev.limits.maxRight;
        const maxY = rawDy < 0 ? prev.limits.maxUp : prev.limits.maxDown;

        // 跟手：拖到哪儿棋子就贴到哪儿，但仍被合法范围裁住（不穿模、不出界）
        return {
          ...prev,
          axis,
          offsetX: axis === 'x' ? clampDragOffset(rawDx, maxX, cellWidth) : 0,
          offsetY: axis === 'y' ? clampDragOffset(rawDy, maxY, cellHeight) : 0,
        };
      });
    },
    [dragState, isGameOver]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!dragState || !boardRef.current) {
        setDragState(null);
        isDraggingRef.current = false;
        return;
      }

      // 快照本次手势是否真的拖动过（决定要不要吞掉随后的 click）
      const dragged = isDraggingRef.current;

      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      const rect = boardRef.current.getBoundingClientRect();
      const cellWidth = rect.width / 4;
      const cellHeight = rect.height / 5;

      const moveX = dragState.axis === 'x' ? resolveSnap(dragState.offsetX, cellWidth) : 0;
      const moveY = dragState.axis === 'y' ? resolveSnap(dragState.offsetY, cellHeight) : 0;

      setDragState(null);
      suppressClickRef.current = dragged;
      isDraggingRef.current = false;

      if (moveX !== 0 || moveY !== 0) {
        const moved = onMovePiece(dragState.pieceId, { dx: moveX, dy: moveY });
        if (moved) {
          soundManager.playMoveSound();
          haptic(8);
        } else {
          // 兜底：越界部分已在拖动时裁掉，真没动就不计步、给失败反馈
          flashBlocked(dragState.pieceId);
        }
        return;
      }

      // 拖动不足半格时静默复位。不要再触发 lockedShake，否则视觉上像松手回弹。
    },
    [dragState, flashBlocked, onMovePiece]
  );

  /* ---------- 键盘：每次输入 = 单格移动 ---------- */

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isGameOver) return;

      const delta = KEY_DIRECTION_BY_CODE[event.code];
      if (!delta) return;
      event.preventDefault();

      // 没有选中时默认操控目标块「韩吉」，并把它显式选中，让玩家看得见
      const targetId = selectedPieceId ?? 'hange';
      if (selectedPieceId !== targetId) setSelectedPieceId(targetId);

      const moved = onMovePiece(targetId, delta);
      if (!moved) flashBlocked(targetId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPieceId, isGameOver, onMovePiece, flashBlocked]);

  /* ---------- 自适应棋盘尺寸（保持 4:5，不依赖固定断点） ---------- */

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [boardSize, setBoardSize] = useState<{ w: number; h: number }>({ w: 320, h: 400 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const availableWidth = rect.width;
      const availableHeight = rect.height > 0 ? rect.height : rect.width * 1.25;
      const width = Math.max(220, Math.min(availableWidth, availableHeight * 0.8, 460));
      setBoardSize({ w: Math.round(width), h: Math.round(width * 1.25) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 拖拽落点幽灵预览：跟随手指吸附到最近可行格 */
  const dragGhost = (() => {
    if (!dragState || !dragState.axis) return null;

    const cellW = boardSize.w / 4;
    const cellH = boardSize.h / 5;
    const steps =
      dragState.axis === 'x'
        ? resolveSnap(dragState.offsetX, cellW)
        : resolveSnap(dragState.offsetY, cellH);

    return {
      left: (dragState.gx + (dragState.axis === 'x' ? steps : 0)) * 25,
      top: (dragState.gy + (dragState.axis === 'y' ? steps : 0)) * 20,
      w: dragState.gw * 25,
      h: dragState.gh * 20,
    };
  })();

  return (
    <div
      ref={rootRef}
      className="flex items-center justify-center select-none w-full h-full min-h-0 max-w-2xl mx-auto"
    >
      {/* 4x5 Board Surface */}
      <div
        ref={boardRef}
        style={{
          width: boardSize.w,
          height: boardSize.h,
          backgroundImage: `
            linear-gradient(to right, rgba(46, 74, 59, 0.25) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(46, 74, 59, 0.25) 1px, transparent 1px)
          `,
          backgroundSize: '25% 20%, 25% 20%',
        }}
        className="relative bg-[#0c1410] border-2 border-[#203a2e] overflow-hidden shadow-[inset_0_0_30px_rgba(0,0,0,0.8)] touch-none rounded-sm"
      >
        {/* Bottom Plane Exit Gate (Flying Boat Escape Plane Icon) */}
        <div className="absolute bottom-0 left-[25%] w-[50%] h-[20%] border-t-2 border-dashed border-[#55b382]/80 bg-[#163023]/60 flex flex-col items-center justify-center text-[#5eead4] pointer-events-none z-0">
          <div className="flex items-center gap-1 px-2.5 py-1 bg-[#09150f]/90 border border-[#3e7e5d] text-[#6ee7b7] shadow-md animate-pulse">
            <Plane className="w-4 h-4 md:w-5 md:h-5 text-[#34d399] -rotate-45" />
            <span className="text-[10px] md:text-xs font-bold tracking-widest">飞机 (EXIT)</span>
          </div>
        </div>

        {/* 拖拽落点预览 */}
        {dragGhost && (
          <div
            className="absolute border-2 border-dashed border-[#34d399]/80 bg-[#34d399]/15 rounded-sm pointer-events-none z-20 transition-[left,top] duration-100 ease-out"
            style={{
              left: `${dragGhost.left}%`,
              top: `${dragGhost.top}%`,
              width: `${dragGhost.w}%`,
              height: `${dragGhost.h}%`,
            }}
          />
        )}

        {/* Render All Pieces */}
        {pieces.map((piece) => {
          const isSelected = selectedPieceId === piece.id;
          const isHans = piece.type === 'target';
          const isCurrentlyDragging = dragState?.pieceId === piece.id;

          const dragX = isCurrentlyDragging ? dragState.offsetX : 0;
          const dragY = isCurrentlyDragging ? dragState.offsetY : 0;

          return (
            <div
              key={piece.id}
              id={`piece-${piece.id}`}
              onClick={() => handlePieceClick(piece)}
              onPointerDown={(event) => handlePointerDown(event, piece)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                left: `${piece.x * 25}%`,
                top: `${piece.y * 20}%`,
                width: `${piece.w * 25}%`,
                height: `${piece.h * 20}%`,
                transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
                // 始终不对位置做补间：松手后立即落格或复位，避免拖拽后的回弹感。
                transition: 'none',
                willChange: 'transform',
                touchAction: 'none',
                zIndex: isCurrentlyDragging ? 30 : 10,
              }}
              className="absolute p-1 cursor-grab active:cursor-grabbing select-none"
            >
              <div
                className={`w-full h-full relative overflow-hidden flex flex-col items-center justify-between border-2 transition-colors duration-100 ${
                  shakeId === piece.id ? 'animate-lockedShake' : ''
                } ${
                  isSelected || isCurrentlyDragging
                    ? 'border-[#34d399] ring-2 ring-[#34d399]/80 shadow-[0_0_18px_rgba(52,211,153,0.55)]'
                    : isHans
                      ? 'border-[#4ade80] shadow-[0_4px_12px_rgba(0,0,0,0.8)] hover:brightness-110'
                      : 'border-[#1b382b] shadow-[0_3px_8px_rgba(0,0,0,0.7)] hover:border-[#2d5a45] hover:brightness-110'
                }`}
              >
                {/* Character Illustration / Graphic */}
                <div className="absolute inset-0 z-0 pointer-events-none">
                  <CharacterArt id={piece.id} />
                </div>

                {/* 重点标签 - 只为目标方块显示 */}
                {isHans && (
                  <div className="absolute top-1 left-1 z-20 px-1.5 py-0.5 bg-[#facc15] text-[#052014] text-[8px] font-black rounded shadow-md border border-[#eab308]">
                    拯救韩吉
                  </div>
                )}

                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#34d399]/30 to-transparent z-10 pointer-events-none" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
