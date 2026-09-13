import React, { useState, useRef, useEffect } from 'react';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
}

// 背景音乐：两个游戏共用一首循环曲（切换游戏不断播；浏览器限制：首次用户手势后才开始）
const BGM_SRC = '/sounds/bgm.mp3';
const BGM_PREF_KEY = 'tatakaru-bgm-enabled';

export const TatakaruGame: React.FC<Props> = ({ onShowToast }) => {
  type GameKey = 'daxigua' | 'g2048';
  const [activeGame, setActiveGame] = useState<GameKey>(() => {
    // 支持 ?game=2048 直达 2048 对局
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('game') === '2048') {
      return 'g2048';
    }
    return 'daxigua';
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ---- 背景音乐（单例，两个游戏共用，切换游戏不断播）----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmOn, setBgmOn] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BGM_PREF_KEY) !== '0';
    } catch {
      return true;
    }
  });

  // 创建 audio 元素：单曲循环，src 只设一次，与游戏切换完全解耦
  useEffect(() => {
    const el = new Audio(BGM_SRC);
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

  // 开关状态变化：播放 / 暂停（需用户手势后浏览器才放行）
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (bgmOn) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
    try {
      window.localStorage.setItem(BGM_PREF_KEY, bgmOn ? '1' : '0');
    } catch { /* 私密模式忽略 */ }
  }, [bgmOn]);

  // 首次用户手势解锁自动播放限制
  useEffect(() => {
    const unlock = () => {
      const el = audioRef.current;
      if (el && bgmOn) el.play().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [bgmOn]);

  const handleToggleBgm = () => {
    setBgmOn((v) => {
      const next = !v;
      onShowToast(next ? '🎵 背景音乐已开启' : '🔇 背景音乐已关闭');
      return next;
    });
  };

  // 切换游戏：只挂载当前游戏的 iframe（cocos 画布在被 display:none 隐藏后恢复会损坏，
  // 因此切换即卸载重建，保证每次都是干净的加载流程）。BGM 不受切换影响。
  const switchGame = (g: GameKey) => {
    if (g === activeGame) return;
    soundManager.playBlip();
    setActiveGame(g);
    setIsLoading(true);
  };

  const handleToggleFullscreen = () => {
    soundManager.playCoin();
    setIsFullscreen(!isFullscreen);
    onShowToast(!isFullscreen ? '已进入沉浸式对局 ⚔️' : '已退出沉浸对局 🛡️');
  };

  return (
    <div id="tatakaru-embedded-root" className="space-y-4 text-[#2C241D]">
      {/* 顶部标牌 */}
      <div className="bg-[#1E4334] text-[#FAF5E8] border-2 sm:border-[3px] border-[#153025] rounded-md p-3.5 sm:p-5 shadow-md relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl">⚔️</span>
              <h2 className="font-pixel text-base sm:text-xl text-[#F9E79F] font-bold tracking-wide">
                塔塔开
              </h2>
            </div>
            <p className="font-retro-jp text-xs sm:text-sm text-[#D5F5E3] leading-relaxed">
              将心脏献给土豆，献给每一次并肩作战与永不熄灭的勇气。
            </p>
          </div>

          {/* 小游戏选择器 */}
          <div className="flex items-center gap-1.5 bg-[#142B21] border border-[#2B5E4A] p-1 rounded-xs">
            <button
              onClick={() => {
                soundManager.playBlip();
                switchGame('daxigua');
              }}
              className={`px-3 py-1 text-xs font-pixel rounded-2xs cursor-pointer transition-all whitespace-nowrap ${
                activeGame === 'daxigua'
                  ? 'bg-[#B3402F] text-[#F9E79F] shadow-xs'
                  : 'text-[#D5C9AF] hover:text-[#FAF5E8]'
              }`}
            >
              🍉 合成大西皮
            </button>
            <button
              onClick={() => {
                soundManager.playBlip();
                switchGame('g2048');
              }}
              className={`px-3 py-1 text-xs font-pixel rounded-2xs cursor-pointer transition-all whitespace-nowrap ${
                activeGame === 'g2048'
                  ? 'bg-[#B3402F] text-[#F9E79F] shadow-xs'
                  : 'text-[#D5C9AF] hover:text-[#FAF5E8]'
              }`}
            >
              🧩 2048
            </button>
          </div>
        </div>
      </div>

      {/* 游戏操作小工具栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-2xs text-xs font-retro-jp">
        <div className="flex items-center gap-2 text-[#5B4636]">
          <span className="font-pixel text-[#1E4334] font-bold">🎮 当前对局：</span>
          <span className="bg-[#FAF5E8] border border-[#D5C9AF] px-2 py-0.5 rounded-2xs text-[11px] text-[#B3402F] font-bold">
            {activeGame === 'daxigua' ? '利韩·合成大西皮' : '利韩·2048 合成'}
          </span>
          <span className="hidden md:inline text-[11px] text-[#7A6958]">
            {activeGame === 'daxigua' ? '（点击或滑动屏幕放下水果）' : '（方向键 / WASD / 滑动屏幕移动方块）'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleBgm}
            className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-2xs cursor-pointer transition-all flex items-center gap-1 text-[10px] sm:text-[11px] font-bold shadow-2xs border ${
              bgmOn
                ? 'bg-[#FAF5E8] hover:bg-[#F3EAD5] text-[#1E4334] border-[#D5C9AF]'
                : 'bg-[#EFE7D2] text-[#8A7968] border-[#D5C9AF]'
            }`}
            title={bgmOn ? '关闭背景音乐' : '开启背景音乐'}
          >
            <span>{bgmOn ? '🔊' : '🔇'}</span>
            <span>{bgmOn ? 'BGM 开' : 'BGM 关'}</span>
          </button>

          <button
            onClick={handleToggleFullscreen}
            className="px-2 sm:px-2.5 py-0.5 sm:py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] rounded-2xs cursor-pointer transition-all flex items-center gap-1 text-[10px] sm:text-[11px] font-pixel shadow-2xs"
            title="沉浸全屏对局"
          >
            <span>⛶</span>
            <span>{isFullscreen ? '退出全屏' : '沉浸模式'}</span>
          </button>
        </div>
      </div>

      {/* 游戏内嵌主容器 (9:16 标准竖屏移动游戏比例约束) */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-50 bg-[#121A15]/95 backdrop-blur-md flex flex-col items-center justify-center p-2 sm:p-4'
            : 'relative w-full flex justify-center py-1'
        }
      >
        {isFullscreen && (
          <div className="w-full max-w-[460px] flex items-center justify-between pb-2 text-[#FAF5E8]">
            <div className="flex items-center gap-1.5 font-pixel text-xs text-[#F9E79F]">
              <span>⚔️</span>
              <span>塔塔开 · 沉浸对局中</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleBgm}
                className="px-2 py-0.5 bg-[#1E4334] text-[#F9E79F] border border-[#3B7E64] rounded-2xs text-xs font-pixel cursor-pointer"
                title={bgmOn ? '关闭背景音乐' : '开启背景音乐'}
              >
                {bgmOn ? '🔊' : '🔇'}
              </button>
              <button
                onClick={handleToggleFullscreen}
                className="px-2.5 py-0.5 bg-[#B3402F] text-[#FAF5E8] rounded-2xs text-xs font-pixel cursor-pointer"
              >
                ✕ 退出
              </button>
            </div>
          </div>
        )}

        {/* 游戏机框体：宽度由 CSS 动态推导，严格保持 720:1280（9:16），
            随设备视口自适应，任何屏幕都不会产生上下黑边。
            ⚠ 禁止用 JS 改写 iframe 宽高（会破坏 cocos 引擎初始化），只用纯 CSS */}
        <div className="relative w-fit max-w-full bg-[#142B21] border-3 sm:border-4 border-[#1E4334] rounded-md shadow-2xl overflow-hidden flex flex-col items-center">
          {/* 顶部怀旧指示灯 */}
          <div className="w-full h-7 bg-[#1A382B] px-3 border-b border-[#2B5E4A] flex items-center justify-between select-none shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E74C3C] animate-pulse" />
              <span className="w-2 h-2 rounded-full bg-[#F39C12]" />
              <span className="w-2 h-2 rounded-full bg-[#2ECC71]" />
              <span className="text-[10px] font-pixel text-[#F9E79F] ml-1">TATAKARU STAGE</span>
            </div>
          </div>

          {/* 加载骨架屏动画 */}
          {isLoading && (
            <div className="absolute inset-0 top-7 bg-[#142B21] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel">
              <div className="text-3xl animate-bounce">{activeGame === 'daxigua' ? '🥔 🍉 ⚔️' : '2️⃣ 0️⃣ 4️⃣ 8️⃣'}</div>
              <p className="text-xs tracking-wider animate-pulse">
                {activeGame === 'daxigua' ? '正在进入利韩战斗舞台...' : '正在布置 2048 合成棋盘...'}
              </p>
              <div className="w-32 bg-[#0D1C16] h-1.5 rounded-full overflow-hidden border border-[#2B5E4A]">
                <div className="bg-[#EAA83B] h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}

          {/* 原生内嵌游戏 Iframe 一：合成大西皮。aspect-ratio 锁定 9:16，宽度按视口高/宽动态取最小。
              ⚠ 禁止用 JS 改写 iframe 宽高（会破坏 cocos 引擎初始化），只用纯 CSS */}
          {activeGame === 'daxigua' && <iframe
            ref={iframeRef}
            src="/daxigua/index.html"
            title="利韩合成大西皮"
            onLoad={() => setIsLoading(false)}
            allow="autoplay; fullscreen"
            className="border-0 bg-[#142B21]"
            style={{
              aspectRatio: '720 / 1280',
              height: 'auto',
              width: isFullscreen
                ? 'min(100vw, calc((100dvh - 96px) * 9 / 16))'
                : 'min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 9 / 16), 460px)',
            }}
          />}
          {activeGame === 'g2048' && <iframe
            src="/2048/index.html"
            title="利韩2048合成"
            onLoad={() => setIsLoading(false)}
            allow="autoplay"
            className="border-0 bg-[#FBF7EC]"
            style={{
              aspectRatio: '3 / 4',
              height: 'auto',
              width: isFullscreen
                ? 'min(100vw, calc((100dvh - 96px) * 3 / 4))'
                : 'min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 3 / 4), 560px)',
            }}
          />}
        </div>
      </div>

      {/* 底部玩法提示与免责声明 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-3 sm:p-4 text-xs font-retro-jp space-y-2 text-[#5B4636] shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-pixel text-[#1E4334] font-bold text-xs">
            <span>📜</span>
            <span>作战指南与玩法规则</span>
          </div>
          <span className="text-[11px] text-[#B3402F] font-bold">
            ⚠️ 图源网络，侵删
          </span>
        </div>

        {activeGame === 'daxigua' ? (
          <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
            <li>
              <b>操作方式：</b>鼠标左键点击或手指在屏幕左右轻扫，松开即可投下掉落物。
            </li>
            <li>
              <b>合成规则：</b>两个相同形态的水果/头像发生碰撞即可融合升级为更高阶形态，目标是向着终极巨大形态进发！
            </li>
            <li>
              <b>防触顶警戒：</b>掉落物堆积超过顶部虚线警戒线时游戏将结算，请合理规划堆叠布局。
            </li>
          </ul>
        ) : (
          <div className="space-y-2">
            {/* 2048 图片方块对照表（五档图片方块 2/4/8/16/32，32 封顶） */}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 py-1">
              {([
                ['/2048/image01.webp', '2'],
                ['/2048/image02.webp', '4'],
                ['/2048/image03.webp', '8'],
                ['/2048/image04.webp', '16'],
                ['/2048/image05.webp', '32'],
              ] as const).map(([src, num]) => (
                <div key={num} className="flex flex-col items-center gap-0.5">
                  <img
                    src={src}
                    alt={`方块 ${num}`}
                    className="w-11 h-11 sm:w-12 sm:h-12 object-cover border-2 border-[#1E4334] shadow-2xs bg-[#FAF5E8]"
                  />
                  <span className="font-pixel text-[10px] text-[#1E4334] font-bold">= {num}</span>
                </div>
              ))}
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
              <li>
                <b>操作方式：</b>方向键 / WASD，或手指在棋盘上滑动，全部方块会一起移动。
              </li>
              <li>
                <b>合成规则：</b>相同方块相碰即合体升级：<b>2+2→4 · 4+4→8 · 8+8→16 · 16+16→32</b>；<b>32 封顶不再合并</b>，合出 <b>32</b> 达成胜利，点「继续挑战」可接着玩！
              </li>
              <li>
                <b>小提示：</b>全部方块均为图片方块，对照上方图表认脸不认数，轻松开局。
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
