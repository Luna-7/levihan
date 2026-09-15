import React, { useState, useRef, useEffect } from 'react';
import { soundManager } from '../utils/audio';
import { LiLeGeHanGame } from './LiLeGeHanGame';

interface Props {
  onShowToast: (msg: string) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
}

// 塔塔开大厅保持静音；利了个韩对局沿用其专属音乐。
const LIHAN_BGM_SRC = '/sounds/lihan-bgm.mp3';
const BGM_PREF_KEY = 'tatakaru-bgm-enabled';

export const TatakaruGame: React.FC<Props> = ({ onShowToast, onPlayingChange }) => {
  type GameKey = 'daxigua' | 'hange' | 'lihan';
  
  // Selected game: null means user is in the "Game Selection Lobby" (长方形像素选择游戏界面)
  // When set to 'daxigua' | 'hange' | 'lihan', jumps into the immersive game arena (沉浸式游戏界面)
  const [selectedGame, setSelectedGame] = useState<GameKey | null>(() => {
    if (typeof window !== 'undefined') {
      const g = new URLSearchParams(window.location.search).get('game');
      if (g === 'hange' || g === '2048') return 'hange';
      if (g === 'daxigua') return 'daxigua';
      if (g === 'lihan' || g === 'yang' || g === 'tilematch' || g === 'miegua') return 'lihan';
    }
    return null;
  });

  // Notify parent component whether immersive game is currently active
  useEffect(() => {
    onPlayingChange?.(selectedGame !== null);
    return () => {
      onPlayingChange?.(false);
    };
  }, [selectedGame, onPlayingChange]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
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

  // 点击长方形游戏卡片二次跳转进入沉浸式游戏
  const handleLaunchGame = (game: GameKey) => {
    soundManager.playCoin();
    if (game === 'lihan' && bgmOn) audioRef.current?.play().catch(() => {});
    setSelectedGame(game);
    setIsLoading(game !== 'lihan');
    const names: Record<GameKey, string> = {
      daxigua: '利韩·合成大西皮',
      hange: '利韩·拯救韩吉',
      lihan: '利韩·利了个韩',
    };
    onShowToast(`⚔️ 已进入「${names[game]}」沉浸游戏`);
  };

  // 返回游戏选择大厅
  const handleBackToLobby = () => {
    soundManager.playBlip();
    audioRef.current?.pause();
    setSelectedGame(null);
    setIsFullscreen(false);
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

  // ==========================================
  // VIEW 1: 长方形像素游戏选择大厅 (第一层)
  // ==========================================
  if (!selectedGame) {
    return (
      <div id="tatakaru-embedded-root" className="space-y-4 text-[#2C241D]">
        {/* 长方形像素游戏选择卡片网格 (三款街机卡带) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-4.5 pt-1">
          {/* 游戏卡片 1: 利韩合成大西皮 */}
          <div
            onClick={() => handleLaunchGame('daxigua')}
            className="group relative bg-[#FFFDF5] border-4 border-[#1E4334] rounded-none p-4 sm:p-5 cursor-pointer select-none transition-all duration-150 shadow-[6px_6px_0px_#10241B] hover:shadow-[8px_8px_0px_#10241B] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-[2px_2px_0px_#10241B] flex flex-col justify-between min-h-[160px]"
            title="利韩 · 合成大西皮"
          >
            {/* 像素卡带角标螺丝 */}
            <span className="absolute top-1 left-1 w-1.5 h-1.5 bg-[#1E4334]/30 pointer-events-none" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#1E4334]/30 pointer-events-none" />
            <span className="absolute bottom-1 left-1 w-1.5 h-1.5 bg-[#1E4334]/30 pointer-events-none" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[#1E4334]/30 pointer-events-none" />

            <div>
              {/* 顶部像素游戏卡条 */}
              <div className="flex items-center justify-between border-b-2 border-dashed border-[#1E4334]/25 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl sm:text-3xl group-hover:scale-110 transition-transform">🍉</span>
                  <div>
                    <div className="font-pixel text-[10px] sm:text-xs text-[#C8922A] tracking-wider font-bold">
                      STAGE 01
                    </div>
                    <h3 className="font-pixel text-sm sm:text-base font-black text-[#1E4334] group-hover:text-[#B3402F] transition-colors">
                      利韩 · 合成大西皮
                    </h3>
                  </div>
                </div>
                <span className="font-pixel text-[11px] text-[#1E4334] font-bold bg-[#E8F8F0] border border-[#1E4334]/40 px-2 py-0.5 group-hover:bg-[#1E4334] group-hover:text-[#F9E79F] transition-colors">
                  ▶ START
                </span>
              </div>

              <p className="font-retro-jp text-xs sm:text-sm text-[#5C4838] leading-relaxed">
                手指左右轻扫投下掉落物，相同形态的水果与利韩立绘碰撞升级，向终极巨大西皮进发！
              </p>
            </div>
          </div>

          {/* 游戏卡片 2: 利韩拯救韩吉 (华容道) */}
          <div
            onClick={() => handleLaunchGame('hange')}
            className="group relative bg-[#FFFDF5] border-4 border-[#5B3F8A] rounded-none p-4 sm:p-5 cursor-pointer select-none transition-all duration-150 shadow-[6px_6px_0px_#341B52] hover:shadow-[8px_8px_0px_#341B52] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-[2px_2px_0px_#341B52] flex flex-col justify-between min-h-[160px]"
            title="利韩 · 拯救韩吉"
          >
            {/* 像素卡带角标螺丝 */}
            <span className="absolute top-1 left-1 w-1.5 h-1.5 bg-[#5B3F8A]/30 pointer-events-none" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#5B3F8A]/30 pointer-events-none" />
            <span className="absolute bottom-1 left-1 w-1.5 h-1.5 bg-[#5B3F8A]/30 pointer-events-none" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[#5B3F8A]/30 pointer-events-none" />

            <div>
              {/* 顶部像素游戏卡条 */}
              <div className="flex items-center justify-between border-b-2 border-dashed border-[#5B3F8A]/25 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl sm:text-3xl group-hover:scale-110 transition-transform">🛡️</span>
                  <div>
                    <div className="font-pixel text-[10px] sm:text-xs text-[#8E44AD] tracking-wider font-bold">
                      STAGE 02
                    </div>
                    <h3 className="font-pixel text-sm sm:text-base font-black text-[#5B3F8A] group-hover:text-[#872D20] transition-colors">
                      利韩 · 拯救韩吉
                    </h3>
                  </div>
                </div>
                <span className="font-pixel text-[11px] text-[#5B3F8A] font-bold bg-[#F4ECF7] border border-[#5B3F8A]/40 px-2 py-0.5 group-hover:bg-[#5B3F8A] group-hover:text-[#F9E79F] transition-colors">
                  ▶ START
                </span>
              </div>

              <p className="font-retro-jp text-xs sm:text-sm text-[#5C4838] leading-relaxed">
                伴随 Bauklötze 原声阻击地鸣！在终曲播放完毕前护送韩吉方块突围到底部飞机出口！
              </p>
            </div>
          </div>

          {/* 游戏卡片 3: 利韩 · 利了个韩 (羊了个羊卡牌堆叠三消) */}
          <div
            onClick={() => handleLaunchGame('lihan')}
            className="group relative bg-[#FFFDF5] border-4 border-[#935116] rounded-none p-4 sm:p-5 cursor-pointer select-none transition-all duration-150 shadow-[6px_6px_0px_#5E330D] hover:shadow-[8px_8px_0px_#5E330D] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-[2px_2px_0px_#5E330D] flex flex-col justify-between min-h-[160px]"
            title="利韩 · 利了个韩"
          >
            {/* 像素卡带角标螺丝 */}
            <span className="absolute top-1 left-1 w-1.5 h-1.5 bg-[#935116]/30 pointer-events-none" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#935116]/30 pointer-events-none" />
            <span className="absolute bottom-1 left-1 w-1.5 h-1.5 bg-[#935116]/30 pointer-events-none" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[#935116]/30 pointer-events-none" />

            <div>
              {/* 顶部像素游戏卡条 */}
              <div className="flex items-center justify-between border-b-2 border-dashed border-[#935116]/25 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl sm:text-3xl group-hover:scale-110 transition-transform">🥔</span>
                  <div>
                    <div className="font-pixel text-[10px] sm:text-xs text-[#D35400] tracking-wider font-bold">
                      STAGE 03 · NEW
                    </div>
                    <h3 className="font-pixel text-sm sm:text-base font-black text-[#935116] group-hover:text-[#B9770E] transition-colors">
                      利韩 · 利了个韩
                    </h3>
                  </div>
                </div>
                <span className="font-pixel text-[11px] text-[#935116] font-bold bg-[#FEF5E7] border border-[#935116]/40 px-2 py-0.5 group-hover:bg-[#935116] group-hover:text-[#F9E79F] transition-colors">
                  ▶ START
                </span>
              </div>

              <p className="font-retro-jp text-xs sm:text-sm text-[#5C4838] leading-relaxed">
                经典羊了个羊层叠三消机制！移开立体交错的兵团卡牌，集齐 3 样相同道具立即消除，向着第二关地狱突围进发！
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: 沉浸式游戏对局界面 (第二层 - 画面最大化 & 强像素街机风)
  // ==========================================
  return (
    <div id="tatakaru-embedded-root" className={`space-y-2 sm:space-y-2.5 w-full ${selectedGame === 'lihan' ? 'text-[#263819]' : 'text-[#2C241D]'}`}>
      {/* 像素街机顶栏：带有退出对局按钮 + 游戏名称/LIVE状态 + BGM/全屏控制 */}
      <div className={`border-3 sm:border-4 rounded-none px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between gap-2 transition-all ${selectedGame === 'lihan' ? 'bg-[#244118] text-[#F5FFCD] border-[#46691D] shadow-[4px_4px_0px_#254312]' : 'bg-[#0D1C16] text-[#FAF5E8] border-[#1E4334] shadow-[4px_4px_0px_#07140E]'}`}>
        {/* 返回游戏选择大厅 (经典红色街机按钮) */}
        <button
          onClick={handleBackToLobby}
          className={`px-2 sm:px-3 py-1 border-2 active:translate-x-0.5 active:translate-y-0.5 text-[11px] sm:text-xs font-pixel cursor-pointer transition-transform flex items-center gap-1 shrink-0 select-none ${selectedGame === 'lihan' ? 'bg-[#577D25] hover:bg-[#709A37] text-[#F5FFCD] border-[#325116] shadow-[2px_2px_0px_#233D12]' : 'bg-[#A93226] hover:bg-[#C0392B] text-[#FFFDF5] border-[#E74C3C] shadow-[2px_2px_0px_#5A1C13]'}`}
          title="退出对局并返回游戏选择列表"
        >
          <span>◀</span>
          <span>退出对局</span>
        </button>

        {/* 当前对局名称与像素绿灯 */}
        <div className={`flex items-center gap-1.5 min-w-0 font-pixel text-xs sm:text-sm truncate font-bold ${selectedGame === 'lihan' ? 'text-[#F5FFCD]' : 'text-[#F9E79F]'}`}>
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
            ? 'fixed inset-0 z-50 bg-[#050B08] flex flex-col'
            : 'relative w-full flex justify-center py-0'
        }
      >
        {isFullscreen && (
          <div className="w-full h-9 shrink-0 flex items-center justify-between px-3 bg-[#0d1c14] border-b-2 border-[#1E4334] text-[#FAF5E8]">
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
              ? 'relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden'
              : `relative w-fit max-w-full border-4 sm:border-[5px] rounded-none overflow-hidden flex flex-col items-center ${selectedGame === 'lihan' ? 'bg-[#1F3318] border-[#46691D] shadow-[6px_6px_0px_#254312]' : 'bg-[#07140E] border-[#10241B] shadow-[6px_6px_0px_#10241B]'}`
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
                  : 'min(calc(100vw - 8px), calc((100dvh - 58px) * 9 / 16), 560px)',
                maxHeight: isFullscreen ? 'calc(100dvh - 38px)' : 'calc(100dvh - 58px)',
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
                  : 'min(calc(100vw - 8px), calc((100dvh - 58px) * 9 / 16), 560px)',
                maxHeight: isFullscreen ? 'calc(100dvh - 38px)' : 'calc(100dvh - 58px)',
              }}
            />
          )}

          {/* 原生组件游戏 三：利了个韩 (羊了个羊卡牌堆叠三消 - 9:16 最大化) */}
          {selectedGame === 'lihan' && (
            <div
              className="bg-[#1F3318] flex flex-col items-center justify-center overflow-hidden block"
              style={{
                width: isFullscreen ? 'min(100vw, 560px)' : 'min(calc(100vw - 14px), 560px)',
                height: isFullscreen ? 'calc(100dvh - 38px)' : 'min(calc(100dvh - 84px), 840px)',
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

      {/* 折叠式作战指南与玩法规则 (不占用游戏纵向视野，点击可展开) */}
      <details className={`group border-2 rounded-none p-2.5 sm:p-3 text-xs font-retro-jp transition-all ${selectedGame === 'lihan' ? 'bg-[#F8FFE7] border-[#46691D] text-[#526548] shadow-[3px_3px_0px_#254312]' : 'bg-[#FFFDF5] border-[#1E4334] text-[#5B4636] shadow-[3px_3px_0px_#10241B]'}`}>
        <summary className="cursor-pointer font-pixel text-xs text-[#1E4334] font-bold flex items-center justify-between select-none">
          <div className="flex items-center gap-1.5">
            <span>📜</span>
            <span>作战指南与玩法说明（图源网络，侵删）</span>
          </div>
        </summary>

        <div className="pt-2 border-t border-dashed border-[#1E4334]/20 mt-2">
          {selectedGame === 'daxigua' ? (
            <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
              <li>
                <b>操作方式：</b>鼠标左键点击或手指在屏幕左右轻扫，松开即可投下掉落物。
              </li>
              <li>
                <b>合成规则：</b>两个相同形态发生碰撞即可融合升级为更高阶形态，向着终极巨大形态进发！
              </li>
              <li>
                <b>防触顶警戒：</b>掉落物堆积超过顶部虚线警戒线时游戏将结算，请合理规划堆叠布局。
              </li>
            </ul>
          ) : selectedGame === 'hange' ? (
            <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
              <li>
                <b>目标：</b>在终曲播放完毕前，把带「拯救韩吉」标签的 2×2 方块护送到<b>底部飞机出口</b>！
              </li>
              <li>
                <b>操作方式：</b>拖拽方块移动（可一次滑动多格，松手自动吸附），也支持方向键 / WASD；点击方块仅选中。
              </li>
              <li>
                <b>难度与倒计时：</b>三档难度（简单 / 经典 / 绝境），倒计时均为 Bauklötze 终曲全长（3:56），走第一步后开始计时并播放专属音乐。
              </li>
            </ul>
          ) : (
            <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
              <li>
                <b>目标与规则：</b>经典《羊了个羊》堆叠三消机制！点击场上未被遮挡的明牌存入收集槽，每 <b>3 张相同图案</b>自动消除，清空全场卡牌即可胜利！
              </li>
              <li>
                <b>立体遮挡判断：</b>被上方卡牌压住的暗牌无法点击，必须先消除上方遮盖物方能解锁。
              </li>
              <li>
                <b>槽位上限与绝境救援：</b>卡槽最多容纳 <b>7 张</b>卡牌。若卡槽填满且无三消则失败；失败时利威尔与韩吉将提供一次<b>绝境支援</b>清空槽位！
              </li>
              <li>
                <b>三大神技道具：</b>善用「移出暂存」腾出 3 格槽位、「战术撤回」悔棋回退、以及「阵型重洗」打破死局！
              </li>
            </ul>
          )}
        </div>
      </details>
    </div>
  );
};
