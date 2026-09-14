import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CharacterArt } from '../data/characters';
import type { Piece } from '../levels';
import type { MoveDelta } from '../gameLogic';
import { canMoveInAnyDirection, getMoveLimits } from '../gameLogic';
import { soundManager } from '../audio/soundManager';
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
  currentDeltaX: number;
  currentDeltaY: number;
  maxLeft: number;
  maxRight: number;
  maxUp: number;
  maxDown: number;
  lockAxis: 'x' | 'y' | null;
  /** 拖拽起始网格坐标与尺寸（用于落点幽灵预览） */
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

export const GameBoard: React.FC<GameBoardProps> = ({
  pieces,
  onMovePiece,
  isGameOver,
}) => {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  /** 真实拖拽结束后要吞掉紧随其后的 click（一次手势只允许产生一次移动） */
  const suppressClickRef = useRef<boolean>(false);

  /**
   * 某棋子四个方向各能滑几格。
   * 规则唯一来源是 gameLogic.getMoveLimits —— 这里不允许再写一份判定。
   */
  const limitsOf = useCallback((piece: Piece) => getMoveLimits(pieces, piece), [pieces]);

  // Execute movement
  const commitMove = useCallback(
    (pieceId: string, dx: number, dy: number) => {
      if (isGameOver || (dx === 0 && dy === 0)) return;

      // 位移裁剪、计步、胜负判定全部由宿主用 gameLogic 统一处理：
      // 返回 true 才算「真的动了一格」，也只有这时才响落地音。
      const moved = onMovePiece(pieceId, { dx, dy });

      if (moved) {
        soundManager.playSlideSound(); // "刷刷" friction swoosh sound
        haptic(8); // 轻微触感确认每一步落子
      }
    },
    [isGameOver, onMovePiece]
  );

  // Smart Click / Tap fallback
  const handlePieceClick = (piece: Piece) => {
    if (isGameOver) return;

    // 刚发生过真实拖拽 → 这次 click 只是手势的尾巴，必须吞掉。
    // 否则一次拖拽会先由 pointerup 落子、再被 click 按方向优先级落一次（重复移动 + 重复计步）。
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    setSelectedPieceId(piece.id);

    const limits = limitsOf(piece);
    // 四个方向都被锁死：抖动 + 触感提示「这块推不动」
    if (!canMoveInAnyDirection(limits)) {
      setShakeId(piece.id);
      haptic(20);
      window.setTimeout(() => setShakeId((cur) => (cur === piece.id ? null : cur)), 340);
      return;
    }

    // Prioritize directions: Down > Right > Left > Up
    if (limits.maxDown > 0) commitMove(piece.id, 0, 1);
    else if (limits.maxRight > 0) commitMove(piece.id, 1, 0);
    else if (limits.maxLeft > 0) commitMove(piece.id, -1, 0);
    else if (limits.maxUp > 0) commitMove(piece.id, 0, -1);
  };

  // Pointer Down: Start Drag
  const handlePointerDown = (e: React.PointerEvent, piece: Piece) => {
    if (isGameOver) return;
    setSelectedPieceId(piece.id);

    const limits = limitsOf(piece);
    isDraggingRef.current = false;
    suppressClickRef.current = false;

    setDragState({
      pieceId: piece.id,
      startX: e.clientX,
      startY: e.clientY,
      currentDeltaX: 0,
      currentDeltaY: 0,
      maxLeft: limits.maxLeft,
      maxRight: limits.maxRight,
      maxUp: limits.maxUp,
      maxDown: limits.maxDown,
      lockAxis: null,
      gx: piece.x,
      gy: piece.y,
      gw: piece.w,
      gh: piece.h,
    });

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Pointer Move: Smooth Real-time Dragging
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState || !boardRef.current || isGameOver) return;

    const rect = boardRef.current.getBoundingClientRect();
    const cellWidth = rect.width / 4;
    const cellHeight = rect.height / 5;

    const rawDeltaX = e.clientX - dragState.startX;
    const rawDeltaY = e.clientY - dragState.startY;

    // Detect if gesture exceeds minimal threshold to become a real drag
    if (!isDraggingRef.current && (Math.abs(rawDeltaX) > 4 || Math.abs(rawDeltaY) > 4)) {
      isDraggingRef.current = true;
    }

    let lockAxis = dragState.lockAxis;
    if (!lockAxis && (Math.abs(rawDeltaX) > 6 || Math.abs(rawDeltaY) > 6)) {
      const canGoX = (rawDeltaX < 0 && dragState.maxLeft > 0) || (rawDeltaX > 0 && dragState.maxRight > 0);
      const canGoY = (rawDeltaY < 0 && dragState.maxUp > 0) || (rawDeltaY > 0 && dragState.maxDown > 0);

      if (canGoX && !canGoY) {
        lockAxis = 'x';
      } else if (!canGoX && canGoY) {
        lockAxis = 'y';
      } else if (Math.abs(rawDeltaX) >= Math.abs(rawDeltaY)) {
        lockAxis = 'x';
      } else {
        lockAxis = 'y';
      }
    }

    let clampedDeltaX = 0;
    let clampedDeltaY = 0;

    if (lockAxis === 'x') {
      const minPixelX = -dragState.maxLeft * cellWidth;
      const maxPixelX = dragState.maxRight * cellWidth;
      clampedDeltaX = Math.max(minPixelX, Math.min(maxPixelX, rawDeltaX));
    } else if (lockAxis === 'y') {
      const minPixelY = -dragState.maxUp * cellHeight;
      const maxPixelY = dragState.maxDown * cellHeight;
      clampedDeltaY = Math.max(minPixelY, Math.min(maxPixelY, rawDeltaY));
    }

    setDragState((prev) =>
      prev
        ? {
            ...prev,
            currentDeltaX: clampedDeltaX,
            currentDeltaY: clampedDeltaY,
            lockAxis,
          }
        : null
    );
  };

  // Pointer Up: Commit Move or Spring Back
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState || !boardRef.current) {
      setDragState(null);
      isDraggingRef.current = false;
      return;
    }

    // 快照本次手势是否真的拖动过（决定要不要吞掉随后的 click）
    const dragged = isDraggingRef.current;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const rect = boardRef.current.getBoundingClientRect();
    const cellWidth = rect.width / 4;
    const cellHeight = rect.height / 5;

    const { currentDeltaX, currentDeltaY, pieceId } = dragState;

    let moveX = 0;
    let moveY = 0;

    // 0.25 格即吸附：低于此回弹，略一用力就跟进下一格，手感更跟手
    if (Math.abs(currentDeltaX) > cellWidth * 0.25) {
      moveX = Math.round(currentDeltaX / cellWidth);
    }
    if (Math.abs(currentDeltaY) > cellHeight * 0.25) {
      moveY = Math.round(currentDeltaY / cellHeight);
    }

    if (moveX !== 0 || moveY !== 0) {
      commitMove(pieceId, moveX, moveY);
    }

    setDragState(null);
    // 拖动过就吞掉随后的 click；用状态位而不是定时器，避免 50ms 这种时序脆弱写法
    suppressClickRef.current = dragged;
    isDraggingRef.current = false;
  };

  // Keyboard controls（无选中时默认操控目标块「韩吉」）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isGameOver) return;
      const activeId = selectedPieceId ?? 'hange';
      if (['ArrowUp', 'KeyW'].includes(e.code)) {
        e.preventDefault();
        setSelectedPieceId(activeId);
        commitMove(activeId, 0, -1);
      } else if (['ArrowDown', 'KeyS'].includes(e.code)) {
        e.preventDefault();
        setSelectedPieceId(activeId);
        commitMove(activeId, 0, 1);
      } else if (['ArrowLeft', 'KeyA'].includes(e.code)) {
        e.preventDefault();
        setSelectedPieceId(activeId);
        commitMove(activeId, -1, 0);
      } else if (['ArrowRight', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        setSelectedPieceId(activeId);
        commitMove(activeId, 1, 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPieceId, isGameOver, commitMove]);

  // 自适应棋盘尺寸：按容器可用空间计算（保持 4:5），不再依赖固定像素断点，
  // 保证在任意宽度的 9:16 iframe 内都完整显示不溢出
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [boardSize, setBoardSize] = useState<{ w: number; h: number }>({ w: 320, h: 400 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const availW = r.width;
      const availH = r.height > 0 ? r.height : r.width * 1.25;
      const w = Math.max(220, Math.min(availW, availH * 0.8, 460));
      setBoardSize({ w: Math.round(w), h: Math.round(w * 1.25) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 拖拽落点幽灵预览：跟随手指吸附到最近可行格，松手即落在该格
  const dragGhost = (() => {
    if (!dragState) return null;
    const cellW = boardSize.w / 4;
    const cellH = boardSize.h / 5;
    let tx = 0;
    let ty = 0;
    if (dragState.lockAxis === 'x') {
      tx = Math.max(-dragState.maxLeft, Math.min(dragState.maxRight, Math.round(dragState.currentDeltaX / cellW)));
    } else if (dragState.lockAxis === 'y') {
      ty = Math.max(-dragState.maxUp, Math.min(dragState.maxDown, Math.round(dragState.currentDeltaY / cellH)));
    }
    return {
      left: (dragState.gx + tx) * 25,
      top: (dragState.gy + ty) * 20,
      w: dragState.gw * 25,
      h: dragState.gh * 20,
    };
  })();

  return (
    <div ref={rootRef} className="flex items-center justify-center select-none w-full h-full min-h-0 max-w-2xl mx-auto">
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
            <span className="text-[10px] md:text-xs font-bold tracking-widest">
              飞机 (EXIT)
            </span>
          </div>
        </div>

        {/* Drag Ghost Preview: 松手落点的虚线幽灵格 */}
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

          const leftPct = piece.x * 25;
          const topPct = piece.y * 20;
          const widthPct = piece.w * 25;
          const heightPct = piece.h * 20;

          const dragX = isCurrentlyDragging ? dragState.currentDeltaX : 0;
          const dragY = isCurrentlyDragging ? dragState.currentDeltaY : 0;

          return (
            <div
              key={piece.id}
              id={`piece-${piece.id}`}
              onClick={() => handlePieceClick(piece)}
              onPointerDown={(e) => handlePointerDown(e, piece)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
                // 弹簧曲线：略过冲再回弹，落格更「脆」
                transition: isCurrentlyDragging
                  ? 'none'
                  : 'left 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.08), top 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.08), transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.08)',
                willChange: isCurrentlyDragging ? 'transform' : 'left, top',
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
                    ? 'border-[#34d399] ring-2 ring-[#34d399]/80 shadow-[0_0_20px_rgba(52,211,153,0.6)]'
                    : isHans
                    ? 'border-[#4ade80] shadow-[0_4px_12px_rgba(0,0,0,0.8)] hover:brightness-110'
                    : 'border-[#1b382b] shadow-[0_3px_8px_rgba(0,0,0,0.7)] hover:border-[#2d5a45] hover:brightness-110'
                }`}
              >
                {/* Character Illustration / Graphic (Clean, without top-left name) */}
                <div className="absolute inset-0 z-0 pointer-events-none">
                  <CharacterArt id={piece.id} />
                </div>

                {/* 重点标签 - 只为目标方块显示 */}
                {isHans && (
                  <div className="absolute top-1 left-1 z-20 px-1.5 py-0.5 bg-[#facc15] text-[#052014] text-[8px] font-black rounded shadow-md border border-[#eab308]">
                    拯救韩吉
                  </div>
                )}

                {/* Subtle border accent */}
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#34d399]/30 to-transparent z-10 pointer-events-none" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
