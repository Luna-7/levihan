/**
 * SAVE HANGE —— 对局主体
 *
 * 状态机约定（改代码前先读这段）：
 *   1. 时间轴唯一数据源是 Bauklötze 音频的 currentTime：
 *      剩余时间 = audio.duration - audio.currentTime。
 *      没有 setInterval，也没有任何独立的倒计时变量；requestAnimationFrame
 *      只负责把音频时间刷进 UI（按 0.1 秒粒度节流）。
 *   2. 只有两个合法终态：
 *        Victory = 韩吉抵达出口（gameLogic.isVictory）
 *        Defeat  = 音频自然播放结束
 *      用 terminalRef 做互斥锁，任何路径都不可能同时/先后触发两种结局。
 *   3. 一次「移动操作」= 一次拖拽 / 点击 / 按键，无论滑动几格，moves 只 +1；
 *      没有实际位移的操作不计步（applyMove 返回原引用即视为没动）。
 *   4. 页面加载不开始计时；第一次有效移动才启动音频与时间轴。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Flame, RotateCcw, Skull, Volume2, VolumeX } from 'lucide-react';
import rumblingBg from './assets/images/rumbling_bg_1789328679857.jpg';
import { GameBoard } from './components/GameBoard';
import { VictoryModal } from './components/VictoryModal';
import { DefeatModal } from './components/DefeatModal';
import { soundManager } from './audio/soundManager';
import { saveBestRecord } from './bestRecords';
import { applyMove, createInitialPieces, isVictory } from './gameLogic';
import type { MoveDelta } from './gameLogic';
import { DIFFICULTIES, DIFFICULTY_ORDER } from './levels';
import type { Difficulty, Piece } from './levels';
import { HOST_BGM_MESSAGE_TYPE } from './constants';

/**
 * 对局音乐状态通知：嵌在主站 iframe 里时通知父页面（TatakaruGame）。
 * 协议名与载荷不可更改：{ type: 'save-hange-bgm', state: 'start' | 'end' }
 *   - start：对局音乐（Bauklötze）开始播放 → 父页面关闭外部共用 BGM 与开关
 *   - end  ：对局音乐停止（胜利/失败/重开/切难度/iframe 卸载）→ 父页面恢复共用 BGM
 */
const notifyHostBgm = (state: 'start' | 'end') => {
  try {
    window.parent?.postMessage({ type: HOST_BGM_MESSAGE_TYPE, state }, '*');
  } catch {
    /* 独立打开（无父页面）时忽略 */
  }
};

/** 触感反馈（无振动硬件时静默降级） */
const haptic = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
};

interface Timeline {
  /** 已播放秒数（= audio.currentTime） */
  elapsed: number;
  /** 剩余秒数（= audio.duration - audio.currentTime） */
  remaining: number;
  duration: number;
}

const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const SaveHangeGame: React.FC = () => {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [showDifficultyMenu, setShowDifficultyMenu] = useState<boolean>(false);
  const [pieces, setPieces] = useState<Piece[]>(() => createInitialPieces('normal'));
  const [moves, setMoves] = useState<number>(0);
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [hasWon, setHasWon] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => soundManager.getIsMuted());
  const [timeUsedSeconds, setTimeUsedSeconds] = useState<number>(0);
  const [timeline, setTimeline] = useState<Timeline>(() => {
    const duration = soundManager.bgmDuration;
    return { elapsed: 0, remaining: duration, duration };
  });

  /* ---------- 事件回调里需要读到的实时值（避免闭包过期） ---------- */
  const piecesRef = useRef<Piece[]>(pieces);
  const movesRef = useRef<number>(0);
  const difficultyRef = useRef<Difficulty>('normal');
  const startedRef = useRef<boolean>(false);
  /** 终态锁：胜利 / 失败互斥，且终态后不再接受任何移动 */
  const terminalRef = useRef<boolean>(false);
  const difficultyMenuRef = useRef<HTMLDivElement | null>(null);

  const currentConfig = DIFFICULTIES[difficulty];
  const timelineActive = hasStarted && !hasWon && !isGameOver;

  /* ---------- 难度下拉：点击外部收起 ---------- */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (difficultyMenuRef.current && !difficultyMenuRef.current.contains(event.target as Node)) {
        setShowDifficultyMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ---------- 对局时间轴：只读音频，不做独立倒计时 ---------- */
  useEffect(() => {
    if (!timelineActive) return;

    let rafId = 0;
    let lastTenth = -1;

    const sync = () => {
      const duration = soundManager.bgmDuration;
      const elapsed = Math.min(Math.max(soundManager.bgmCurrentTime, 0), duration);
      const tenth = Math.floor(elapsed * 10);

      // 每 0.1 秒刷一次 UI，避免 60fps 触发整棵组件树重渲染
      if (tenth !== lastTenth) {
        lastTenth = tenth;
        setTimeline({ elapsed, remaining: Math.max(0, duration - elapsed), duration });
      }

      rafId = requestAnimationFrame(sync);
    };

    sync();
    return () => cancelAnimationFrame(rafId);
  }, [timelineActive]);

  /* ---------- 两个终态 ---------- */

  /** Defeat：音频自然播放结束（曲终仍未突围） */
  const handleAudioEnded = useCallback(() => {
    if (terminalRef.current) return; // 已经胜利或失败 → 不再判定
    terminalRef.current = true;

    const duration = soundManager.bgmDuration;
    setTimeline({ elapsed: duration, remaining: 0, duration });
    setIsGameOver(true);
    setHasWon(false);

    soundManager.playDefeatSound();
    haptic([120]);
    notifyHostBgm('end'); // 对局音乐结束 → 宿主恢复共用 BGM
  }, []);

  /** Victory：韩吉抵达出口 */
  const handleWin = useCallback((finalMoves: number) => {
    if (terminalRef.current) return;
    terminalRef.current = true;

    // 先取时间再暂停：结算用时就是音乐播到的那一刻
    const elapsed = soundManager.bgmCurrentTime;
    soundManager.pauseBGM();

    const duration = soundManager.bgmDuration;
    setTimeUsedSeconds(elapsed);
    setTimeline({ elapsed, remaining: Math.max(0, duration - elapsed), duration });
    setHasWon(true);
    setIsGameOver(false);

    haptic([30, 50, 30, 50, 90]);
    saveBestRecord(difficultyRef.current, elapsed, finalMoves);
    notifyHostBgm('end'); // 对局音乐停止 → 宿主恢复共用 BGM
    soundManager.playVictorySound();
  }, []);

  /* ---------- 开局 ---------- */

  /** 第一次有效操作才启动音频与时间轴 */
  const startGame = useCallback(() => {
    if (startedRef.current || terminalRef.current) return;

    startedRef.current = true;
    setHasStarted(true);
    notifyHostBgm('start'); // 通知宿主关闭外部共用 BGM

    // playBGM 会把 currentTime 归零、开始播放，并把「自然结束」回调挂上。
    // 若浏览器仍因自动播放策略拒绝，这里不会退化成第二套计时器：
    // 对局照常可玩，只是没有倒计时（时间轴始终以音频为准）。
    soundManager.playBGM(handleAudioEnded);
  }, [handleAudioEnded]);

  /**
   * 执行一次移动操作。
   * 返回 true 表示棋盘确实发生了变化（调用方据此播放落地音）。
   */
  const commitMove = useCallback(
    (pieceId: string, delta: MoveDelta): boolean => {
      if (terminalRef.current) return false;

      const current = piecesRef.current;
      const next = applyMove(current, pieceId, delta);

      // applyMove 在「没有任何实际位移」时返回原数组引用 → 本次不计步
      if (next === current) return false;

      if (!startedRef.current) startGame();

      piecesRef.current = next;
      setPieces(next);

      // 一次操作只 +1，与滑动了几格无关
      const nextMoves = movesRef.current + 1;
      movesRef.current = nextMoves;
      setMoves(nextMoves);

      if (isVictory(next)) handleWin(nextMoves);

      return true;
    },
    [startGame, handleWin]
  );

  /* ---------- 重开 / 切难度：都视为全新对局 ---------- */

  const resetTo = useCallback((nextDifficulty: Difficulty) => {
    const wasPlaying = startedRef.current;

    // pause + currentTime = 0：旧音频绝不会继续播
    soundManager.stopBGM();
    startedRef.current = false;
    terminalRef.current = false;

    // 对局中重开 / 切难度 → 音乐中止，宿主恢复共用 BGM
    if (wasPlaying) notifyHostBgm('end');

    const next = createInitialPieces(nextDifficulty);
    piecesRef.current = next;
    movesRef.current = 0;
    difficultyRef.current = nextDifficulty;

    setDifficulty(nextDifficulty);
    setPieces(next);
    setMoves(0);
    setHasStarted(false);
    setIsGameOver(false);
    setHasWon(false);
    setTimeUsedSeconds(0);

    const duration = soundManager.bgmDuration;
    setTimeline({ elapsed: 0, remaining: duration, duration });
  }, []);

  const handleReset = useCallback(() => {
    setShowDifficultyMenu(false);
    resetTo(difficultyRef.current);
  }, [resetTo]);

  const handleSelectDifficulty = useCallback(
    (level: Difficulty) => {
      setShowDifficultyMenu(false);
      resetTo(level);
    },
    [resetTo]
  );

  const handleToggleMute = useCallback(() => {
    setIsMuted(soundManager.toggleMute());
  }, []);

  /* ---------- iframe 卸载：确保宿主恢复共用 BGM ---------- */
  useEffect(
    () => () => {
      soundManager.stopBGM();
      if (startedRef.current && !terminalRef.current) notifyHostBgm('end');
    },
    []
  );

  const timeRemaining = timeline.remaining;
  const boardLocked = isGameOver || hasWon;

  return (
    <div className="relative w-full h-[100dvh] bg-[#080d0a] text-[#f2f7f4] select-none overflow-hidden">
      {/*
        游戏画面直接铺满主站提供的 9:16 iframe（外框由主站 TatakaruGame 统一绘制，不再叠加机壳）
      */}
      <div className="absolute inset-0 p-3 sm:p-4 flex flex-col justify-between text-[#f2f7f4] overflow-hidden">
        {/* 9:16 Cropped Rumbling Wall Titans Image */}
        <div
          className="absolute inset-0 bg-cover bg-center filter brightness-[0.48] contrast-110 saturate-115 pointer-events-none"
          style={{ backgroundImage: `url(${rumblingBg})` }}
        />

        {/* Steaming Heat & Smoky Titan Atmosphere Overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#09150e]/90 via-[#0d1f15]/70 to-[#120707]/92 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.18)_0%,transparent_65%)] pointer-events-none animate-pulse" />

        {/* Top Header Section */}
        <div className="relative z-10 flex flex-col">
          {/* Top Status & Difficulty Switcher */}
          <div className="flex items-center justify-between mb-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#1e1010]/90 border border-[#4a1c1c] text-red-400 font-mono text-[9px] sm:text-[10px] font-bold tracking-wider uppercase rounded shadow-sm backdrop-blur-sm whitespace-nowrap shrink-0">
              <Skull className="w-3 h-3 text-red-500 animate-pulse shrink-0" />
              {hasStarted ? '地鸣逼近 • THE RUMBLING' : '待机中 • STANDBY'}
            </span>

            <div className="flex items-center gap-2">
              {/* Music Toggle Button */}
              <button
                id="music-toggle-btn"
                onClick={handleToggleMute}
                className="flex items-center justify-center w-8 h-8 bg-[#102419]/90 hover:bg-[#1a3827] border border-[#2b5941] hover:border-[#34d399] rounded text-[#86efac] transition-all cursor-pointer shadow-sm"
                title={isMuted ? '开启音乐' : '关闭音乐'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* Difficulty Dropdown Selector placed at the top right */}
              <div ref={difficultyMenuRef} className="relative">
                <button
                  id="difficulty-selector-btn"
                  onClick={() => setShowDifficultyMenu((prev) => !prev)}
                  className="flex items-center gap-1 px-2 py-0.5 bg-[#102419]/90 hover:bg-[#1a3827] border border-[#2b5941] hover:border-[#34d399] rounded text-[10px] font-mono font-black text-[#86efac] tracking-wider transition-all cursor-pointer shadow-sm"
                  title="切换关卡难度"
                >
                  <Flame className="w-3 h-3 text-yellow-400" />
                  <span>{currentConfig.tag} MODE</span>
                  <ChevronDown
                    className={`w-3 h-3 text-[#34d399] transition-transform duration-200 ${
                      showDifficultyMenu ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Dropdown Menu for Difficulty Levels */}
                {showDifficultyMenu && (
                  <div className="absolute top-full right-0 mt-1 w-44 bg-[#0d1c14] border-2 border-[#2b5941] rounded-lg shadow-2xl p-1 z-50 animate-fadeIn backdrop-blur-md">
                    {DIFFICULTY_ORDER.map((level) => {
                      const config = DIFFICULTIES[level];
                      const isCurrent = difficulty === level;
                      return (
                        <button
                          key={level}
                          onClick={() => handleSelectDifficulty(level)}
                          className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between text-xs font-bold transition-all mb-0.5 cursor-pointer ${
                            isCurrent
                              ? 'bg-[#34d399] text-[#052014]'
                              : 'text-[#e2e8f0] hover:bg-[#1a3828] hover:text-[#34d399]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono font-black">{config.name}</span>
                            <span className="text-[9px] font-normal opacity-75">({config.sublabel})</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-90">
                            {formatCountdown(timeline.duration)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Main Title Banner (AOT Rumbling / Hange Stand Off) */}
          <div className="text-center my-0.5">
            <h1 className="text-xl sm:text-2xl font-black tracking-wider text-[#34d399] drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] font-mono">
              SAVE HANGE
            </h1>
            <p className="text-[11px] font-bold text-[#bbf7d0] tracking-wide mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              {hasStarted ? '在终曲播放完毕前护送 韩吉 突围登上飞机' : '拖动 / 点击方块开始突围'}
            </p>
          </div>

          {/* Compact HUD Stats & Actions Bar */}
          <div className="grid grid-cols-12 gap-1.5 mt-1.5 mb-1 bg-[#0b1711]/90 border border-[#234533] px-2 py-1.5 rounded-lg text-[#f0fdf4] shadow-md backdrop-blur-md">
            {/* Remaining Time（= 音频时长 - 音频已播放位置） */}
            <div className="col-span-5 flex flex-col items-center justify-center py-0.5 border-r border-[#1c3829]">
              <span className="text-[9px] font-bold text-[#86efac] tracking-wider leading-tight">
                剩余时间
              </span>
              <span
                className={`text-base sm:text-lg font-mono font-black tracking-wider leading-none mt-0.5 ${
                  timeRemaining < 30 && hasStarted ? 'text-red-400 animate-pulse' : 'text-[#facc15]'
                }`}
              >
                {formatCountdown(timeRemaining)}
              </span>
            </div>

            {/* Moves Count：移动操作次数（一次拖拽 = 1 次，与滑动格数无关） */}
            <div className="col-span-4 flex flex-col items-center justify-center py-0.5 border-r border-[#1c3829]">
              <span className="text-[9px] font-bold text-[#86efac] tracking-wider leading-tight">
                移动次数
              </span>
              <span className="text-base sm:text-lg font-mono font-black text-white tracking-wider leading-none mt-0.5">
                {moves}
              </span>
            </div>

            {/* Reset Action (Icon ONLY) */}
            <div className="col-span-3 flex items-center justify-center">
              <button
                id="reset-game-btn"
                onClick={handleReset}
                className="w-full h-8 flex items-center justify-center bg-[#34d399] hover:bg-[#4ade80] text-[#062417] rounded border border-[#1b7552] shadow active:translate-y-0.5 transition-all cursor-pointer"
                title="重新开局"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Main Board Container (Centered in 9:16 interior space; min-h-0 让棋盘自适应高度) */}
        <div className="relative z-10 flex-1 min-h-0 w-full flex items-center justify-center my-auto py-1">
          <GameBoard
            pieces={pieces}
            onMovePiece={commitMove}
            isGameOver={boardLocked}
          />
        </div>

        {/* Bottom Wood Floor Base Strip matching retro frame */}
        <div className="relative z-10 h-3.5 sm:h-4 bg-[#785338] border-t-2 border-[#543823] -mx-3 sm:-mx-4 -mb-3 sm:-mb-4 shadow-inner" />
      </div>

      {/* Victory Modal */}
      {hasWon && (
        <VictoryModal
          timeUsedSeconds={timeUsedSeconds}
          moves={moves}
          onRestart={handleReset}
          onClose={() => setHasWon(false)}
        />
      )}

      {/* Defeat Modal */}
      {isGameOver && !hasWon && <DefeatModal onRestart={handleReset} />}
    </div>
  );
};

export default SaveHangeGame;
