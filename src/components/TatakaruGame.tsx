import React, { useState, useRef, useEffect } from 'react';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
}

// 背景音乐：两个游戏共用一首循环曲（切换游戏不断播；浏览器限制：首次用户手势后才开始）
const BGM_SRC = '/sounds/bgm.mp3';
const BGM_PREF_KEY = 'tatakaru-bgm-enabled';

export const TatakaruGame: React.FC<Props> = ({ onShowToast }) => {
  type GameKey = 'daxigua' | 'hange';
  const [activeGame, setActiveGame] = useState<GameKey>(() => {
    // 支持 ?game=hange 直达拯救韩吉对局（?game=2048 为旧链接，兼容映射到拯救韩吉）
    if (typeof window !== 'undefined') {
      const g = new URLSearchParams(window.location.search).get('game');
      if (g === 'hange' || g === '2048') return 'hange';
    }
    return 'daxigua';
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 拯救韩吉对局音乐播放中：期间外部共用 BGM 强制关闭且开关禁用，结束后自动恢复
  const [gameBgmActive, setGameBgmActive] = useState<boolean>(false);

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

  // 拯救韩吉 iframe 汇报对局音乐状态：
  // start = 对局专属音乐（Bauklötze）开始 → 关闭外部共用 BGM 并禁用开关；
  // end   = 对局音乐停止（胜利/超时/曲目播完/重开/切难度）→ 自动恢复共用 BGM 与开关
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; state?: string } | null;
      if (!d || d.type !== 'save-hange-bgm') return;
      if (d.state === 'start') {
        setGameBgmActive(true);
        setBgmOn(false);
      } else if (d.state === 'end') {
        setGameBgmActive(false);
        setBgmOn(true);
        onShowToast('🎵 对局结束，已恢复背景音乐');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onShowToast]);

  // 切换游戏：只挂载当前游戏的 iframe（cocos 画布在被 display:none 隐藏后恢复会损坏，
  // 因此切换即卸载重建，保证每次都是干净的加载流程）。BGM 不受切换影响；
  // 若拯救韩吉对局音乐播放中切走，iframe 卸载即音乐终止 → 恢复共用 BGM。
  const switchGame = (g: GameKey) => {
    if (g === activeGame) return;
    soundManager.playBlip();
    if (gameBgmActive) {
      setGameBgmActive(false);
      setBgmOn(true);
    }
    setActiveGame(g);
    setIsLoading(true);
  };

  const handleToggleFullscreen = () => {
    soundManager.playCoin();
    setIsFullscreen(!isFullscreen);
    onShowToast(!isFullscreen ? '已进入沉浸式对局 ⚔️' : '已退出沉浸对局 🛡️');
  };

  // 沉浸模式时给 body 打标：隐藏卡片边框上的像素装饰
  //（带 scale/z-20 的装饰在 Chrome 下会穿透 fixed 全屏遮罩，详见 index.css 注释）
  useEffect(() => {
    document.body.classList.toggle('immersive-on', isFullscreen);
    return () => document.body.classList.remove('immersive-on');
  }, [isFullscreen]);

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
                switchGame('hange');
              }}
              className={`px-3 py-1 text-xs font-pixel rounded-2xs cursor-pointer transition-all whitespace-nowrap ${
                activeGame === 'hange'
                  ? 'bg-[#B3402F] text-[#F9E79F] shadow-xs'
                  : 'text-[#D5C9AF] hover:text-[#FAF5E8]'
              }`}
            >
              🛡️ 拯救韩吉
            </button>
          </div>
        </div>
      </div>

      {/* 游戏操作小工具栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md px-3 py-2 flex flex-wrap items-center justify-end gap-2 shadow-2xs text-xs font-retro-jp">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleBgm}
            disabled={gameBgmActive}
            className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-2xs transition-all flex items-center gap-1 text-[10px] sm:text-[11px] font-bold shadow-2xs border ${
              gameBgmActive
                ? 'bg-[#EFE7D2] text-[#B9AA93] border-[#D5C9AF] cursor-not-allowed'
                : bgmOn
                ? 'bg-[#FAF5E8] hover:bg-[#F3EAD5] text-[#1E4334] border-[#D5C9AF] cursor-pointer'
                : 'bg-[#EFE7D2] text-[#8A7968] border-[#D5C9AF] cursor-pointer'
            }`}
            title={gameBgmActive ? '对局音乐播放中，结束后自动恢复' : bgmOn ? '关闭背景音乐' : '开启背景音乐'}
          >
            <span>{gameBgmActive || bgmOn ? '🔊' : '🔇'}</span>
            <span>{gameBgmActive ? '对局 BGM' : bgmOn ? 'BGM 开' : 'BGM 关'}</span>
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

      {/* 游戏内嵌主容器 (9:16 标准竖屏移动游戏比例约束)。
          沉浸模式：整层只用游戏底色 #080d0a，无 padding / 无毛玻璃 / 无机框装饰，
          仅保留一条全宽宿主控制条（h-9），画面在其下尽量铺满，杜绝“外框混入”。 */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-50 bg-[#080d0a] flex flex-col'
            : 'relative w-full flex justify-center py-1'
        }
      >
        {isFullscreen && (
          <div className="w-full h-9 shrink-0 flex items-center justify-between px-3 bg-[#0d1c14] border-b border-[#1E4334] text-[#FAF5E8]">
            <div className="flex items-center gap-1.5 font-pixel text-xs text-[#F9E79F]">
              <span>⚔️</span>
              <span>塔塔开 · 沉浸对局中</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleBgm}
                disabled={gameBgmActive}
                className={`px-2 py-0.5 border rounded-2xs text-xs font-pixel ${
                  gameBgmActive
                    ? 'bg-[#1A382B] text-[#8A7968] border-[#2B5E4A] cursor-not-allowed'
                    : 'bg-[#1E4334] text-[#F9E79F] border-[#3B7E64] cursor-pointer'
                }`}
                title={gameBgmActive ? '对局音乐播放中，结束后自动恢复' : bgmOn ? '关闭背景音乐' : '开启背景音乐'}
              >
                {gameBgmActive ? '🎮' : bgmOn ? '🔊' : '🔇'}
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

        {/* 游戏机框体：普通模式带机框装饰（边框 + 顶灯条），沉浸模式全部剥离只留画面。
            宽度由 CSS 动态推导，严格保持 9:16，随设备视口自适应。
            ⚠ 禁止用 JS 改写 iframe 宽高（会破坏 cocos 引擎初始化），只用纯 CSS */}
        <div
          className={
            isFullscreen
              ? 'relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden'
              : 'relative w-fit max-w-full bg-[#142B21] border-3 sm:border-4 border-[#1E4334] rounded-md shadow-2xl overflow-hidden flex flex-col items-center'
          }
        >
          {/* 顶部怀旧指示灯（仅普通模式） */}
          {!isFullscreen && (
            <div className="w-full h-7 bg-[#1A382B] px-3 border-b border-[#2B5E4A] flex items-center justify-between select-none shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#E74C3C] animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-[#F39C12]" />
                <span className="w-2 h-2 rounded-full bg-[#2ECC71]" />
                <span className="text-[10px] font-pixel text-[#F9E79F] ml-1">TATAKARU STAGE</span>
              </div>
            </div>
          )}

          {/* 加载骨架屏动画 */}
          {isLoading && (
            <div
              className={`absolute inset-0 ${isFullscreen ? '' : 'top-7'} bg-[#142B21] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel`}
            >
              <div className="text-3xl animate-bounce">{activeGame === 'daxigua' ? '🥔 🍉 ⚔️' : '🛡️ ✈️ ⚔️'}</div>
              <p className="text-xs tracking-wider animate-pulse">
                {activeGame === 'daxigua' ? '正在进入利韩战斗舞台...' : '正在集结地鸣战场，护送韩吉突围...'}
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
                ? 'min(100vw, calc((100dvh - 36px) * 9 / 16))'
                : 'min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 9 / 16), 460px)',
            }}
          />}
          {/* 原生内嵌游戏 Iframe 二：拯救韩吉（华容道）。9:16 竖屏，与合成大西皮同宽度规则 */}
          {activeGame === 'hange' && <iframe
            ref={iframeRef}
            src="/save-hange/index.html"
            title="利韩·拯救韩吉"
            onLoad={() => setIsLoading(false)}
            allow="autoplay"
            className="border-0 bg-[#080d0a]"
            style={{
              aspectRatio: '9 / 16',
              height: 'auto',
              width: isFullscreen
                ? 'min(100vw, calc((100dvh - 36px) * 9 / 16))'
                : 'min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 9 / 16), 460px)',
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
          <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
            <li>
              <b>目标：</b>在终曲播放完毕前，把带「拯救韩吉」标签的 2×2 方块护送到<b>底部飞机出口</b>！
            </li>
            <li>
              <b>操作方式：</b>拖拽方块移动（可一次滑动多格，松手自动吸附），也支持方向键 / WASD；点击方块仅选中。
            </li>
            <li>
              <b>难度与倒计时：</b>三档难度仅布局不同（简单 / 经典 / 绝境），倒计时均为 Bauklötze 终曲全长（3:56），走第一步后开始计时并播放专属音乐。
            </li>
            <li>
              <b>音乐规则：</b>对局中播放游戏专属音乐，外部共用 BGM 暂停；对局结束（突围 / 超时 / 乐曲终了 / 重开）后自动恢复。
            </li>
          </ul>
        )}
      </div>
    </div>
  );
};
