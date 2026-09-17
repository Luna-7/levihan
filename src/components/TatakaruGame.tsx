import React, { useState, useRef, useEffect, useCallback } from 'react';
import { soundManager } from '../utils/audio';
import { LiLeGeHanGame } from './LiLeGeHanGame';
import { submitScore, GAME_META, type HangeRaw } from '../utils/gameScores';

interface Props {
  onShowToast: (msg: string) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  /** 从首页快捷启动弹窗直接指定游戏，跳过选择大厅，避免二次选择 */
  initialGame?: 'daxigua' | 'hange' | 'lihan' | null;
  /** 退出对局：直接关闭整个游戏弹层（选择大厅页已删除） */
  onExit?: () => void;
}

// 塔塔开大厅保持静音；利了个韩对局沿用其专属音乐。
const LIHAN_BGM_SRC = '/sounds/lihan-bgm.mp3';
const BGM_PREF_KEY = 'tatakaru-bgm-enabled';

type TatakaruGameKey = 'daxigua' | 'hange' | 'lihan';

export const TatakaruGame: React.FC<Props> = ({ onShowToast, onPlayingChange, initialGame = null, onExit }) => {
  // Selected game: null means user is in the "Game Selection Lobby" (长方形像素选择游戏界面)
  // When set to 'daxigua' | 'hange' | 'lihan', jumps into the immersive game arena (沉浸式游戏界面)
  // 优先级：快捷启动弹窗直入 > URL ?game= 参数 > 选择大厅
  const initialKey: TatakaruGameKey | null = (() => {
    if (initialGame === 'daxigua' || initialGame === 'hange' || initialGame === 'lihan') return initialGame;
    if (typeof window !== 'undefined') {
      const g = new URLSearchParams(window.location.search).get('game');
      if (g === 'hange' || g === '2048') return 'hange';
      if (g === 'daxigua') return 'daxigua';
      if (g === 'lihan' || g === 'yang' || g === 'tilematch' || g === 'miegua') return 'lihan';
    }
    return null;
  })();

  const [selectedGame, setSelectedGame] = useState<TatakaruGameKey | null>(initialKey);

  // 直入利了个韩（原生组件）时无需加载骨架屏
  const [isLoading, setIsLoading] = useState<boolean>(initialKey !== null && initialKey !== 'lihan');

  // Notify parent component whether immersive game is currently active
  useEffect(() => {
    onPlayingChange?.(selectedGame !== null);
    return () => {
      onPlayingChange?.(false);
    };
  }, [selectedGame, onPlayingChange]);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // ---- 利了个韩对局音乐 ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmOn, setBgmOn] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BGM_PREF_KEY) !== '0';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const el = new Audio(LIHAN_BGM_SRC);
    el.loop = true;
    el.volume = 0.35;
    el.preload = 'auto';
    audioRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute('src');
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      if (selectedGame === 'lihan' && bgmOn) el.play().catch(() => {});
      else el.pause();
    }
    try {
      window.localStorage.setItem(BGM_PREF_KEY, bgmOn ? '1' : '0');
    } catch { /* 私密模式忽略 */ }
  }, [selectedGame, bgmOn]);

  // 直接在用户手势中播放，避免浏览器拦截对局音乐。
  const handleToggleBgm = () => {
    const next = !bgmOn;
    if (next) audioRef.current?.play().catch(() => {});
    else audioRef.current?.pause();
    setBgmOn(next);
    onShowToast(next ? '🎵 对局音乐已开启' : '🔇 对局音乐已关闭');
  };

  // 本局成绩暂存：退出对局时统一提交到头号玩家
  // 大西皮在一次进入里可能玩多局，取其中最高分
  const daxiguaBestRef = useRef<number>(0);
  const hangeResultRef = useRef<HangeRaw | null>(null);

  // 监听两款 iframe 游戏回传的成绩
  useEffect(() => {
    type Incoming = {
      type?: string;
      score?: number;
      difficulty?: string;
      moves?: number;
      timeUsedSeconds?: number;
      duration?: number;
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Incoming | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'daxigua-result') {
        const score = Number(data.score) || 0;
        if (score > daxiguaBestRef.current) daxiguaBestRef.current = score;
        return;
      }

      if (data.type === 'save-hange-result' && data.difficulty === 'hard') {
        hangeResultRef.current = {
          moves: Number(data.moves) || 0,
          timeUsedSeconds: Number(data.timeUsedSeconds) || 0,
          duration: Number(data.duration) || 0,
          outcome: 'win',
        };
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** 把暂存的成绩提交到头号玩家；只在刷新纪录时提示，避免打断玩家 */
  const flushScores = useCallback(() => {
    if (daxiguaBestRef.current > 0) {
      const score = daxiguaBestRef.current;
      daxiguaBestRef.current = 0;
      void submitScore('daxigua', { score }).then((result) => {
        if (result.improved) {
          onShowToast(`⚔️ 新纪录 · ${GAME_META.daxigua.short} 积分 ${result.merit}${result.localOnly ? '（仅本机）' : ''}`);
        }
      });
    }

    if (hangeResultRef.current) {
      const raw = hangeResultRef.current;
      hangeResultRef.current = null;
      void submitScore('hange', raw).then((result) => {
        if (result.improved) {
          onShowToast(`⚔️ 新纪录 · ${GAME_META.hange.short} 积分 ${result.merit}${result.localOnly ? '（仅本机）' : ''}`);
        }
      });
    }
  }, [onShowToast]);

  // 组件卸载（关闭沉浸对局）时补交一次
  const flushRef = useRef(flushScores);
  flushRef.current = flushScores;
  useEffect(() => () => flushRef.current(), []);

  // 退出对局：提交成绩并直接关闭整个游戏弹层（STAGE 选择大厅页已删除）
  const handleBackToLobby = () => {
    soundManager.playBlip();
    flushScores();
    audioRef.current?.pause();
    setIsFullscreen(false);
    if (onExit) {
      onExit();
    } else {
      setSelectedGame(null);
    }
  };

  const handleToggleFullscreen = () => {
    soundManager.playCoin();
    setIsFullscreen(!isFullscreen);
    onShowToast(!isFullscreen ? '已进入全屏沉浸对局 ⚔️' : '已退出全屏 🛡️');
  };

  // 沉浸全屏模式时给 body 打标
  useEffect(() => {
    document.body.classList.toggle('immersive-on', isFullscreen);
    return () => document.body.classList.remove('immersive-on');
  }, [isFullscreen]);

  // STAGE 选择大厅页已删除：进入组件即直接对局（由 initialGame / URL 参数指定），
  // 退出对局由 handleBackToLobby 关闭整个弹层。兜底：无对局时不渲染任何内容。
  if (!selectedGame) return null;

  // ==========================================
  // VIEW 2: 沉浸式游戏对局界面 (第二层 - 画面最大化 & 强像素街机风)
  // ==========================================
  return (
    <div id="tatakaru-embedded-root" className={`relative overflow-x-hidden space-y-2 sm:space-y-2.5 w-full max-h-full overflow-y-auto ${selectedGame === 'lihan' ? 'text-[#263819]' : 'text-[#2C241D]'}`}>
      {/* 像素街机顶栏：带有退出对局按钮 + 游戏名称/LIVE状态 + BGM/全屏控制 */}
      <div className={`relative z-10 shrink-0 rounded-none px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between gap-2 transition-all ${selectedGame === 'lihan' ? 'bg-transparent border-0 shadow-none text-[#1F3318]' : 'bg-[#0D1C16] text-[#FAF5E8] border-3 sm:border-4 border-[#1E4334] shadow-[4px_4px_0px_#07140E]'}`}>
        {/* 返回游戏选择大厅 (经典红色街机按钮) */}
        <button
          onClick={handleBackToLobby}
          className={`px-2 sm:px-3 py-1 border-2 active:translate-x-0.5 active:translate-y-0.5 text-[11px] sm:text-xs font-pixel cursor-pointer transition-transform flex items-center gap-1 shrink-0 select-none ${selectedGame === 'lihan' ? 'bg-[#577D25] hover:bg-[#709A37] text-[#F5FFCD] border-[#325116] shadow-[2px_2px_0px_#233D12]' : 'bg-[#A93226] hover:bg-[#C0392B] text-[#FFFDF5] border-[#E74C3C] shadow-[2px_2px_0px_#5A1C13]'}`}
          title="退出对局并关闭游戏"
        >
          <span>◀</span>
          <span>退出对局</span>
        </button>

        {/* 当前对局名称与像素绿灯 */}
        <div className={`flex items-center gap-1.5 min-w-0 font-pixel text-xs sm:text-sm truncate font-bold ${selectedGame === 'lihan' ? 'text-[#1F3318]' : 'text-[#F9E79F]'}`}>
          <span className="w-2 h-2 rounded-none bg-[#2ECC71] shadow-[0_0_6px_#2ECC71] shrink-0 animate-pulse" />
          <span className="shrink-0">
            {selectedGame === 'daxigua' ? '🍉' : selectedGame === 'hange' ? '🛡️' : '🥔'}
          </span>
          <span className="truncate">
            {selectedGame === 'daxigua' ? '合成大西皮' : selectedGame === 'hange' ? '拯救韩吉' : '利了个韩'}
          </span>
        </div>

        {/* 工具栏: 街机式 BGM + 全屏 */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {selectedGame === 'lihan' && (
            <button
              onClick={handleToggleBgm}
              className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-none transition-transform flex items-center gap-1 text-[10px] sm:text-xs font-pixel border-2 ${
                bgmOn
                  ? 'bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] border-[#37755c] shadow-[2px_2px_0px_#07140E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'
                  : 'bg-[#142B21] text-[#8A7968] border-[#2B5E4A] shadow-[2px_2px_0px_#07140E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'
              }`}
              title={bgmOn ? '关闭对局音乐' : '开启对局音乐'}
            >
              <span>{bgmOn ? '🔊' : '🔇'}</span>
              <span className="hidden xs:inline">{bgmOn ? 'BGM' : '静音'}</span>
            </button>
          )}

          <button
            onClick={handleToggleFullscreen}
            className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] border-2 border-[#37755c] rounded-none shadow-[2px_2px_0px_#07140E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer transition-transform flex items-center gap-1 text-[10px] sm:text-xs font-pixel select-none"
            title="全屏切换"
          >
            <span>⛶</span>
            <span className="hidden xs:inline">{isFullscreen ? '还原' : '全屏'}</span>
          </button>
        </div>
      </div>

      {/* 游戏内嵌主容器 (最大化画面尺寸，适配手机屏高与桌面超大尺寸) */}
      <div
        className={
          isFullscreen
            ? selectedGame === 'lihan'
              ? 'fixed inset-0 z-50 flex flex-col overflow-hidden lihan-themed-root'
              : 'fixed inset-0 z-50 bg-[#050B08] flex flex-col'
            : 'relative z-10 w-full flex justify-center py-0'
        }
      >
        {isFullscreen && (
          <div className={`relative z-10 w-full h-9 shrink-0 flex items-center justify-between px-3 ${selectedGame === 'lihan' ? 'bg-transparent border-0 text-[#1F3318]' : 'bg-[#0d1c14] border-b-2 border-[#1E4334] text-[#FAF5E8]'}`}>
            <div className="flex items-center gap-1.5 font-pixel text-xs text-[#F9E79F]">
              <span className="w-2 h-2 rounded-none bg-[#2ECC71] animate-pulse" />
              <span>塔塔开 · 街机全屏对局</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedGame === 'lihan' && (
                <button
                  onClick={handleToggleBgm}
                  className="px-2 py-0.5 border-2 rounded-none text-xs font-pixel bg-[#1E4334] text-[#F9E79F] border-[#3B7E64] cursor-pointer"
                  title={bgmOn ? '关闭对局音乐' : '开启对局音乐'}
                >
                  {bgmOn ? '🔊' : '🔇'}
                </button>
              )}

              <button
                onClick={handleToggleFullscreen}
                className="px-2.5 py-0.5 bg-[#A93226] text-[#FAF5E8] border-2 border-[#E74C3C] rounded-none text-xs font-pixel cursor-pointer"
              >
                ✕ 退出全屏
              </button>
            </div>
          </div>
        )}

        {/* 像素街机机框框体 */}
        <div
          className={
            isFullscreen
              ? 'relative z-10 flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden'
              : `relative z-10 w-fit max-w-full rounded-none overflow-hidden flex flex-col items-center ${selectedGame === 'lihan' ? 'bg-transparent border-0 shadow-none' : 'border-4 sm:border-[5px] bg-[#07140E] border-[#10241B] shadow-[6px_6px_0px_#10241B]'}`
          }
        >
          {/* 四个角的街机像素金属螺丝 */}
          <span className="absolute top-1 left-1 w-1.5 h-1.5 bg-[#3D6652] pointer-events-none z-20" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#3D6652] pointer-events-none z-20" />
          <span className="absolute bottom-1 left-1 w-1.5 h-1.5 bg-[#3D6652] pointer-events-none z-20" />
          <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[#3D6652] pointer-events-none z-20" />

          {/* 加载骨架屏动画 */}
          {isLoading && (
            <div
              className="absolute inset-0 bg-[#07140E] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel"
            >
              <div className="text-3xl animate-bounce">
                {selectedGame === 'daxigua' ? '🥔 🍉 ⚔️' : '🛡️ ✈️ ⚔️'}
              </div>
              <p className="text-xs tracking-wider animate-pulse text-center px-4">
                {selectedGame === 'daxigua'
                  ? 'STAGE 01 · 正在载入利韩作战舞台...'
                  : 'STAGE 02 · 正在集结地鸣战场，护送韩吉突围...'}
              </p>
              <div className="w-36 bg-[#040A07] h-2 rounded-none overflow-hidden border-2 border-[#2B5E4A]">
                <div className="bg-[#EAA83B] h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}

          {/* 原生内嵌游戏 Iframe 一：合成大西皮 (尺寸最大化) */}
          {selectedGame === 'daxigua' && (
            <iframe
              ref={iframeRef}
              src="/daxigua/index.html"
              title="利韩合成大西皮"
              onLoad={() => setIsLoading(false)}
              allow="autoplay; fullscreen"
              className="border-0 bg-[#07140E] block"
              style={{
                aspectRatio: '720 / 1280',
                height: 'auto',
                width: isFullscreen
                  ? 'min(100vw, calc((100dvh - 38px) * 9 / 16))'
                  : 'min(calc(100vw - 8px), calc((100dvh - 104px) * 9 / 16), 560px)',
                maxHeight: isFullscreen ? 'calc(100dvh - 38px)' : 'calc(100dvh - 104px)',
              }}
            />
          )}

          {/* 原生内嵌游戏 Iframe 二：拯救韩吉 (尺寸最大化) */}
          {selectedGame === 'hange' && (
            <iframe
              ref={iframeRef}
              src="/save-hange/index.html"
              title="利韩·拯救韩吉"
              onLoad={() => setIsLoading(false)}
              allow="autoplay"
              className="border-0 bg-[#07140E] block"
              style={{
                aspectRatio: '9 / 16',
                height: 'auto',
                width: isFullscreen
                  ? 'min(100vw, calc((100dvh - 38px) * 9 / 16))'
                  : 'min(calc(100vw - 8px), calc((100dvh - 104px) * 9 / 16), 560px)',
                maxHeight: isFullscreen ? 'calc(100dvh - 38px)' : 'calc(100dvh - 104px)',
              }}
            />
          )}

          {/* 原生组件游戏 三：利了个韩 (羊了个羊卡牌堆叠三消 - 9:16 最大化) */}
          {selectedGame === 'lihan' && (
            <div
              className="bg-transparent flex flex-col items-center justify-center overflow-hidden block"
              style={{
                width: isFullscreen ? 'min(100vw, 560px)' : 'min(calc(100vw - 14px), 560px)',
                height: isFullscreen ? 'calc(100dvh - 38px)' : 'min(calc(100dvh - 104px), 840px)',
              }}
            >
              <LiLeGeHanGame
                onBack={handleBackToLobby}
                onShowToast={onShowToast}
                isFullscreen={isFullscreen}
              />
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
