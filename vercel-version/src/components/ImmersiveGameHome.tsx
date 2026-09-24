import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
} from 'lucide-react';
import { MiniProgramJumpGrid } from './MiniProgramJumpGrid';
import { HomeAnnouncementGrid } from './HomeAnnouncementGrid';
import { HomeTodaysUpdates } from './HomeTodaysUpdates';
const RestaurantForum = React.lazy(() => import('./RestaurantForum').then(m => ({ default: m.RestaurantForum })));
const TatakaruGame = React.lazy(() => import('./TatakaruGame').then(m => ({ default: m.TatakaruGame })));
const GameLeaderboard = React.lazy(() => import('./GameLeaderboard').then(m => ({ default: m.GameLeaderboard })));
const PotatoMarket = React.lazy(() => import('./PotatoMarket').then(m => ({ default: m.PotatoMarket })));
const ResourceHub = React.lazy(() => import('./ResourceHub').then(m => ({ default: m.ResourceHub })));
import { soundManager } from '../utils/audio';
import { GROUP_INFO } from '../data/initialData';
import { UserEntry } from './UserEntry';
import { UiSprite } from './UiSprite';
import { CardPatternOverlay } from './CardPatternOverlay';
import { useAppShellStore } from '../stores/appShellStore';

interface Props {
  onNavigateTab: (tabId: string) => void;
  onShowToast: (msg: string) => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
}

export const ImmersiveGameHome: React.FC<Props> = ({
  onNavigateTab,
  onShowToast,
  isSoundMuted,
  onToggleSound,
}) => {
  // 选中的沉浸游戏（点击下方街机进入后全屏直接玩）
  const [activeGame, setActiveGame] = useState<'daxigua' | 'hange' | 'lihan' | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('victory-preview') === 'lihan' ? 'lihan' : null;
  });
  const [activeModal, setActiveModal] = useState<'game' | 'leaderboard' | 'rules' | 'doujinshi' | 'resources' | null>(null);
  const [isForumOpen, setIsForumOpen] = useState(false);
  const pendingDoujinOpen = useAppShellStore((state) => state.pendingDoujinOpen);

  // 接龙合订本跳转意图：自动跳转到巨树餐厅典藏阁（取代 window 隐式事件）。
  // 首页的 isForumOpen / activeModal 是首页局部的弹窗态，需要在跳转前一并收起。
  useEffect(() => {
    if (pendingDoujinOpen === 0) return;
    setIsForumOpen(false);
    setActiveModal(null);
    onNavigateTab('resources');
    // 只关注意图信号的跳变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDoujinOpen]);

  if (isForumOpen) {
    return <React.Suspense fallback={null}><RestaurantForum onBack={() => setIsForumOpen(false)} onShowToast={onShowToast} /></React.Suspense>;
  }

  return (
    <div
      id="view-main"
      className="relative w-full h-full select-none flex flex-col justify-between overflow-y-auto no-scrollbar overscroll-contain bg-[#FFFEEF]/80 md:bg-[#FFFEEF]/55 md:backdrop-blur-md"
    >
      {/* 滚动行为：手机端内容恰好一屏 → 不出现滚动（矮屏兜底仍可滚）；
          桌面端 lg 下公告区不再内部滚动，整页随内容自然增高、可滚动。 */}
      {/* ====================================================
          1. 顶部 Header 横幅（不再使用卡片容器）
          打开网页时 header PNG 自动向下移入（animate-header-slide-down）
         ==================================================== */}
      <div className="relative shrink-0 animate-header-slide-down w-full max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto">
        {/* header 横幅：宽度始终与导航栏对齐，高度按图片比例等比缩放 */}
        <img
          src="/images/header.webp"
          alt="LEVI × HANS WAREHOUSE 调查兵团特别驻地 · 情报与粮草整备"
          className="home-header-art w-full h-auto max-w-full block"
          referrerPolicy="no-referrer"
          fetchPriority="high"
        />

        {/* 顶部控制条：悬浮在横幅上 (Avoid top notch / status bar) */}
        <header
          className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 sm:pt-4 px-1"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
          {/* 左侧：无边框无背景音量键 */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                onToggleSound();
              }}
              className="p-1 sm:p-1.5 bg-transparent border-0 shadow-none flex items-center justify-center transition-all cursor-pointer active:scale-90 hover:opacity-80 shrink-0"
              title={isSoundMuted ? '开启音效 🔊' : '静音 🔇'}
              id="btn-header-volume"
            >
              <UiSprite
                name="volume"
                width={44}
                role="img"
                label={isSoundMuted ? '开启音效' : '静音'}
                className={isSoundMuted ? 'opacity-40 grayscale drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]' : 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]'}
              />
            </button>
          </div>

          {/* 右侧：登录按钮 */}
          <div className="flex items-center shrink-0">
            <UserEntry variant="pill" onShowToast={onShowToast} />
          </div>
        </header>
      </div>

      {/* ====================================================
          2. 主体内容区：按照参考图排版
          （【上段】公告栏自身滚动，最多 3 条公告在其中滚动查看；
            【下段】3 个入口按钮固定不跟随滚动。
            窄屏恰好放得下、公告不滚动；只有公告超出时才在卡片区内滚动。
            矮屏/桌面（header 占高大）空间不足时，main 仍保留兜底滚动，
            避免按钮被裁掉看不见。）
         ==================================================== */}
      {/* 桌面端(lg)：整个首页可随内容自然增高滚动；手机端：保持一屏固定不滚动
          （内容超高时仅公告卡内部滚动，页面本身不滚）。 */}
      <main className="w-full max-w-xl sm:max-w-2xl lg:max-w-3xl lg:flex-none lg:overflow-visible mx-auto px-2.5 sm:px-4 lg:px-6 pt-1 sm:pt-2 lg:pt-4 clear-adventure-nav-home flex-1 min-h-0 flex flex-col justify-start gap-4 sm:gap-5 lg:gap-8 overflow-y-auto no-scrollbar">
        {/* ====================================================
            【上段】：首页最多 3 条公告卡片 (显现内容、时间、发布人)
            —— 手机端：这一块是唯一的滚动容器；
               桌面端(lg)：不再内部滚动，随整页一起滚动。
           ==================================================== */}
        <section
          id="home-announce-scroll"
          className="w-full flex-1 min-h-[132px] lg:flex-none lg:min-h-0 lg:overflow-visible flex flex-col overflow-y-auto overflow-x-hidden no-scrollbar px-1 py-1"
        >
          <HomeAnnouncementGrid
            onNavigateTab={onNavigateTab}
            onShowToast={onShowToast}
          />
        </section>

        {/* ====================================================
            【中段】今日上新（漫画本 / 小说本 / 接力棒）
            —— 固定高度不滚动；今天无更新时整栏自动隐藏
           ==================================================== */}
        <HomeTodaysUpdates
          onNavigateTab={onNavigateTab}
          onShowToast={onShowToast}
        />

        {/* ====================================================
            【下段】：3 个大复古羊皮纸入口 (塔塔开 + 影视厅 + 巨人资源)
            —— 固定不滚动
           ==================================================== */}
        <section className="w-full shrink-0 short-screen-m-neg">
          <div className="short-screen-scale">
            <MiniProgramJumpGrid
              onOpenGameModal={() => setActiveModal('game')}
              onOpenResourceModal={() => setActiveModal('resources')}
            />
          </div>
        </section>
      </main>

      {/* ====================================================
          4. 弹窗模块：小游戏快捷启动 (塔塔开异形军徽战术框)
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'game' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setActiveModal(null);
          }}
        >
          {/* 异形外框战术切角: 复古银金属 */}
          <div
            className="relative w-full max-w-sm bg-gradient-to-br from-[#FFFFFF] via-[#8FA69D] to-[#1E4334] p-[2.5px] shadow-[0_16px_36px_rgba(18,43,33,0.35)] overflow-hidden"
            style={{
              clipPath:
                'polygon(0 16px, 16px 0, calc(100% - 16px) 0, 100% 16px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 16px 100%, 0 calc(100% - 16px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 内层卡面: 磨砂透光玻璃 */}
            <div
              className="w-full bg-gradient-to-b from-white/95 via-[#F6FAF8]/90 to-[#E8F2ED]/85 backdrop-blur-md p-4 sm:p-5 text-[#16273B] relative"
              style={{
                clipPath:
                  'polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px))',
              }}
            >
              {/* 玻璃斜向高光 */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/50 via-transparent to-transparent pointer-events-none" />
              <CardPatternOverlay
                opacity={0.08}
                mode="multiply"
                clipPath="polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px))"
              />
              {/* 四角银质金属铆钉 */}
              <span className="silver-rivet top-2 left-2" />
              <span className="silver-rivet top-2 right-2" />
              <span className="silver-rivet bottom-2 left-2" />
              <span className="silver-rivet bottom-2 right-2" />

              {/* 标题栏与关闭 */}
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b-2 border-dashed border-[#8FA69D]/60">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-[#1E4334] text-[#F8FAFC] text-xs shadow-xs border border-[#C5A059]/40">⚔️</span>
                  <div>
                    <h2 className="font-serif-title text-base font-black text-[#1E4334] leading-none">
                      塔塔开 · 街机训练场
                    </h2>
                    <p className="font-retro-jp text-[10px] text-[#557B6B] mt-0.5">
                      调查兵团绝境小游戏 · 突破极限高分
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setActiveModal(null);
                  }}
                  className="w-7 h-7 rounded-full bg-[#1E4334] hover:bg-[#2C5C46] text-[#F8FAFC] flex items-center justify-center cursor-pointer shadow-xs transition-colors z-20 shrink-0 border border-[#C5A059]/40"
                  title="关闭"
                >
                  <X size={15} />
                </button>
              </div>

              {/* 三款游戏卡带 - 异形切边与银金属玻璃效果 */}
              <div className="space-y-2.5 pt-1">
                {/* 游戏 1: 利韩 · 合成大西皮 */}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playCoin();
                    setActiveModal(null);
                    setActiveGame('daxigua');
                    onShowToast('⚔️ 已进入「利韩 · 合成大西皮」');
                  }}
                  className="relative w-full group bg-white/80 hover:bg-white border-2 border-[#8FA69D] p-2.5 sm:p-3 cursor-pointer transition-all shadow-md active:scale-98 flex items-center gap-3 text-left overflow-hidden rounded-lg backdrop-blur-sm"
                  style={{
                    clipPath:
                      'polygon(0 8px, 10px 0, calc(100% - 10px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 8px))',
                  }}
                >
                  <UiSprite
                    name="game-watermelon"
                    width={44}
                    role="img"
                    label="合成大西皮"
                    className="relative z-10 group-hover:scale-110 transition-transform shrink-0 drop-shadow-sm"
                  />
                  <div className="relative z-10 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-serif-title text-sm sm:text-base font-black text-[#1E4334] truncate">
                        利韩 · 合成大西皮
                      </span>
                    </div>
                    <p className="text-[10px] text-[#557B6B] mt-0.5">
                      解压西瓜合成消除 · 收集利韩各阶形态
                    </p>
                  </div>
                </button>

                {/* 游戏 2: 利韩 · 拯救韩吉 */}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playCoin();
                    setActiveModal(null);
                    setActiveGame('hange');
                    onShowToast('⚔️ 已进入「利韩 · 拯救韩吉」');
                  }}
                  className="relative w-full group bg-white/80 hover:bg-white border-2 border-[#8FA69D] p-2.5 sm:p-3 cursor-pointer transition-all shadow-md active:scale-98 flex items-center gap-3 text-left overflow-hidden rounded-lg backdrop-blur-sm"
                  style={{
                    clipPath:
                      'polygon(0 8px, 10px 0, calc(100% - 10px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 8px))',
                  }}
                >
                  <UiSprite
                    name="game-hange"
                    width={52}
                    role="img"
                    label="拯救韩吉"
                    className="relative z-10 group-hover:scale-110 transition-transform shrink-0 drop-shadow-sm"
                  />
                  <div className="relative z-10 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-serif-title text-sm sm:text-base font-black text-[#1E4334] truncate">
                        利韩 · 拯救韩吉
                      </span>
                    </div>
                    <p className="text-[10px] text-[#557B6B] mt-0.5">
                      绝境闪避跳跃战术 · 避开超大型巨人
                    </p>
                  </div>
                </button>

                {/* 游戏 3: 利韩 · 利了个韩 */}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playBlip();
                    setActiveModal(null);
                    setActiveGame('lihan');
                  }}
                  className="relative w-full group bg-white/80 hover:bg-white border-2 border-[#8FA69D] p-2.5 sm:p-3 cursor-pointer transition-all shadow-md active:scale-98 flex items-center gap-3 text-left overflow-hidden rounded-lg backdrop-blur-sm"
                  style={{
                    clipPath:
                      'polygon(0 8px, 10px 0, calc(100% - 10px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 8px))',
                  }}
                >
                  <UiSprite
                    name="game-lihan"
                    width={52}
                    role="img"
                    label="利了个韩"
                    className="relative z-10 group-hover:scale-110 transition-transform shrink-0 drop-shadow-sm"
                  />
                  <div className="relative z-10 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-serif-title text-sm sm:text-base font-black text-[#1E4334] truncate">
                        利韩 · 利了个韩
                      </span>
                    </div>
                    <p className="text-[10px] text-[#557B6B] mt-0.5">
                      卡牌堆叠三消 · 凑齐三张同款即消除
                    </p>
                  </div>
                </button>
              </div>

              {/* 头号玩家跳转入口 */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setActiveModal('leaderboard');
                }}
                className="w-full mt-3 pt-2.5 border-t-2 border-dashed border-[#C5A059] flex items-center justify-between gap-2 cursor-pointer group hover:bg-[#F2EADB]/60 p-1.5 rounded-lg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg">🏆</span>
                  <div>
                    <span className="font-serif-title text-xs sm:text-sm font-bold text-[#16273B] block leading-tight">
                      全服头号玩家排行榜
                    </span>
                    <span className="text-[9px] text-[#715431]">实时汇总三款游戏的最佳纪录</span>
                  </div>
                </span>
                <span className="font-pixel text-[11px] text-[#8C6226] group-hover:translate-x-0.5 transition-transform font-bold">
                  查看榜单 ›
                </span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          4.1 弹窗模块：头号玩家（独立弹窗）
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'leaderboard' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setActiveModal(null);
          }}
        >
          <div
            className="relative w-full max-w-sm max-h-[86dvh] bg-[#FAF6ED] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 text-[#16273B] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <CardPatternOverlay opacity={0.14} mode="multiply" />
            <div className="relative z-10 flex items-center justify-between pb-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <p className="font-retro-jp text-[11px] text-[#715431]">大西皮 + 拯救韩吉（绝境）统一排名</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setActiveModal(null);
                }}
                className="w-7 h-7 rounded-full bg-[#16273B] text-[#F4EADB] hover:bg-[#2A4465] flex items-center justify-center cursor-pointer shadow-xs"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <React.Suspense fallback={null}><GameLeaderboard onShowToast={onShowToast} /></React.Suspense>
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          4.2 弹窗模块：无边框沉浸对局 (控制栏内嵌无遮挡)
         ==================================================== */}
      {typeof document !== 'undefined' && activeGame && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-0 overflow-hidden animate-in fade-in duration-200 select-none ${activeGame === 'lihan' ? 'bg-transparent lihan-themed-root' : 'bg-black/95 backdrop-blur-md'}`}
          onClick={() => {
            soundManager.playWoodTap();
            setActiveGame(null);
          }}
        >
          <div
            className="relative w-full h-full max-w-[100vw] max-h-[100dvh] flex flex-col items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 居中沉浸式游戏画面 (内部自带顶部集成控制条，零遮挡) */}
            <div className="w-full h-full flex flex-col items-center justify-center p-0 m-0">
              <React.Suspense fallback={null}><TatakaruGame
                onShowToast={onShowToast}
                initialGame={activeGame}
                onExit={() => setActiveGame(null)}
              /></React.Suspense>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          5. 弹窗模块：兵团誓约与公约 (Corps Rules & Oath)
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'rules' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setActiveModal(null);
          }}
        >
          <div
            className="w-full max-w-lg bg-[#FAF6ED] popup-frame-border rounded-2xl p-4 text-[#16273B] shadow-2xl relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <CardPatternOverlay opacity={0.14} mode="multiply" />
            <div className="relative z-10 flex items-center justify-between border-b border-[#C5A059] pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📜</span>
                <div>
                  <h3 className="font-serif-title text-base sm:text-lg font-black text-[#16273B]">
                    利韩同好驻地公约 · 誓约之壁
                  </h3>
                  <p className="text-xs text-[#715431]">
                    调查兵团特别同好会 · 内部交流守则
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setActiveModal(null);
                }}
                className="w-7 h-7 rounded-full bg-[#16273B] text-[#F4EADB] hover:bg-[#2A4465] flex items-center justify-center cursor-pointer shadow-xs shrink-0"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto">
            <div className="space-y-2.5 text-xs sm:text-sm text-[#4A4036] leading-relaxed bg-white/90 p-3.5 rounded-xl border border-[#D5C19A]">
                <div className="p-2 bg-[#FAF6ED] rounded-lg border-l-4 border-[#16273B]">
                  <p className="font-bold text-[#16273B]">
                    1. 🚫 绝对红线：严禁商用、倒卖与盗印
                  </p>
                  <p className="text-[11px] text-[#6B553E] mt-0.5">
                    站内所有同人本扫描件与精修汉化作品仅供同好学习交流，严禁二手倒卖、有偿分享或作为商业附赠。
                  </p>
                </div>

                <div className="p-2 bg-[#FAF6ED] rounded-lg border-l-4 border-[#C5A059]">
                  <p className="font-bold text-[#8C6226]">
                    2. ⚔️ 专一守护：圈地自萌，文明交流
                  </p>
                  <p className="text-[11px] text-[#6B553E] mt-0.5">
                    利韩无差、互攻均尊重彼此喜好。请勿在非同好公共空间刷屏拉踩，不上升角色与原作者攻击。
                  </p>
                </div>

                <div className="p-2 bg-[#FAF6ED] rounded-lg border-l-4 border-[#285A46]">
                  <p className="font-bold text-[#285A46]">
                    3. 🥔 献出心脏：与你共享每一个烤土豆
                  </p>
                  <p className="text-[11px] text-[#6B553E] mt-0.5">
                    “韩吉，把心脏献给我吧。” 在八十一重平行宇宙里，我们依然因对利威尔与韩吉的爱相聚在此。
                  </p>
                </div>
              </div>

              {/* QQ交流群指引 */}
              <div className="mt-3 bg-[#FAF6ED] p-2.5 rounded-xl border border-[#C5A059] flex items-center justify-between">
                <div>
                  <span className="font-serif-title text-xs font-bold text-[#16273B] block">
                    兵团同好 QQ 交流群
                  </span>
                  <span className="text-[10px] text-[#715431]">
                    {GROUP_INFO.qqGroups.map((g) => `${g.name}: ${g.number}`).join(' | ')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playCoin();
                    const txt = GROUP_INFO.qqGroups.map((g) => g.number).join(' ');
                    if (navigator.clipboard) navigator.clipboard.writeText(txt);
                    onShowToast('📋 群号已复制');
                  }}
                  className="px-2.5 py-1 bg-[#16273B] text-[#F4EADB] rounded-lg font-bold text-xs hover:bg-[#2A4465] cursor-pointer"
                >
                  复制群号
                </button>
              </div>

              <div className="mt-4 pt-3 border-t border-[#D5C19A] flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setActiveModal(null);
                  }}
                  className="px-4 py-1.5 bg-[#16273B] text-[#F4EADB] text-xs font-serif-title font-bold rounded-lg cursor-pointer hover:bg-[#243E60] shadow-md"
                >
                  谨遵誓约
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          6. 弹窗模块：土豆市集 · 互助流转 (卡片弹窗直开)
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'doujinshi' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setActiveModal(null);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[92dvh] bg-[#FAF5EA] popup-frame-border rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
            onClick={(e) => e.stopPropagation()}
          >
            <CardPatternOverlay opacity={0.12} mode="multiply" />

            {/* 弹窗顶部标题栏 */}
            <div className="relative z-10 flex items-center justify-between px-3 sm:px-4 py-2.5 bg-gradient-to-r from-[#2E1E12] via-[#4A3525] to-[#2E1E12] text-[#F8FAFC] border-b-2 border-[#C5A059] shrink-0 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-xl">🥔</span>
                <div>
                  <h3 className="font-serif-title text-sm sm:text-base font-black text-[#F8FAFC] leading-none">
                    土豆市集 · 互助流转
                  </h3>
                  <p className="font-retro-jp text-[10px] text-[#E8D5A7] mt-0.5">
                    个人手作制品发布 · 闲置转卖回血
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setActiveModal(null);
                }}
                className="w-7 h-7 rounded-full bg-[#1A110A] text-[#F8FAFC] hover:bg-[#3D2C1F] flex items-center justify-center cursor-pointer shadow-xs shrink-0 transition-colors border border-[#C5A059]/40"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            {/* 弹窗内容区：包含完整的 PotatoMarket 组件 */}
            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 sm:p-4">
              <React.Suspense fallback={null}><PotatoMarket
                onShowToast={onShowToast}
              /></React.Suspense>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          7. 弹窗模块：巨人资源 · 官方典藏 (卡片弹窗直开)
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'resources' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setActiveModal(null);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[92dvh] bg-[#FAF5EA] popup-frame-border rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
            onClick={(e) => e.stopPropagation()}
          >
            <CardPatternOverlay opacity={0.12} mode="multiply" />

            {/* 弹窗顶部标题栏 */}
            <div className="relative z-10 flex items-center justify-between px-3 sm:px-4 py-2.5 bg-gradient-to-r from-[#16273B] via-[#243E60] to-[#16273B] text-[#F8FAFC] border-b-2 border-[#C5A059] shrink-0 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-xl">📚</span>
                <div>
                  <h3 className="font-serif-title text-sm sm:text-base font-black text-[#F8FAFC] leading-none">
                    官方典藏 · 巨人资源
                  </h3>
                  <p className="font-retro-jp text-[10px] text-[#E9D5FF] mt-0.5">
                    动漫原片 · 漫画手稿 · 二创素材 · AU官方小说 · 周边橱窗
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setActiveModal(null);
                }}
                className="w-7 h-7 rounded-full bg-[#0E1A29] text-[#F8FAFC] hover:bg-[#203652] flex items-center justify-center cursor-pointer shadow-xs shrink-0 transition-colors border border-[#C5A059]/40"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            {/* 弹窗内容区：包含完整的 ResourceHub 组件 */}
            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 sm:p-4">
              <React.Suspense fallback={null}><ResourceHub
                onCopyCode={(code) => {
                  soundManager.playCopySuccess();
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(code).then(
                      () => onShowToast(`已复制提取码：${code} 📋`),
                      () => onShowToast(`提取码为：${code}`)
                    );
                  } else {
                    onShowToast(`提取码为：${code}`);
                  }
                }}
                onShowToast={onShowToast}
                onGoToDoujin={() => {
                  soundManager.playPageTurn();
                  setActiveModal('doujinshi');
                }}
              /></React.Suspense>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
