import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
} from 'lucide-react';
import { PopUpShopBanner } from './PopUpShopBanner';
import { MiniProgramJumpGrid } from './MiniProgramJumpGrid';
import { RestaurantForum } from './RestaurantForum';
import { TatakaruGame } from './TatakaruGame';
import { GameLeaderboard } from './GameLeaderboard';
import { soundManager } from '../utils/audio';
import { GROUP_INFO } from '../data/initialData';
import { UserEntry } from './UserEntry';
import { UiSprite } from './UiSprite';

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
  const [activeGame, setActiveGame] = useState<'daxigua' | 'hange' | 'lihan' | null>(null);

  const [activeModal, setActiveModal] = useState<'game' | 'leaderboard' | 'rules' | null>(null);
  const [isForumOpen, setIsForumOpen] = useState(false);

  if (isForumOpen) {
    return <RestaurantForum onBack={() => setIsForumOpen(false)} onShowToast={onShowToast} />;
  }

  return (
    <div
      id="view-main"
      className="relative w-full h-[100dvh] max-h-[100dvh] select-none pb-20 sm:pb-22 flex flex-col justify-between overflow-hidden"
    >
      {/* ====================================================
          1. 顶栏 (Top Bar)
          包含：左侧微章与“Levi✖️Hans的土豆仓”，最右侧登录按键与音量键
         ==================================================== */}
      <header className="shrink-0 w-full max-w-xl mx-auto px-2.5 sm:px-3 py-1 sm:py-1.5 backdrop-blur-md bg-[#FAF6ED]/95 border-b border-[#D5C19A] shadow-xs z-30">
        <div className="flex items-center justify-between gap-2">
          {/* 左侧：登录入口放在原双头像位置，后接站点标题 */}
          <div className="flex items-center gap-1.5 min-w-0">
            <UserEntry onShowToast={onShowToast} />

            <span className="font-serif-title text-xs sm:text-sm font-black text-[#16273B] tracking-wide truncate">
              Levi✖️Hans的土豆仓
            </span>
          </div>

          {/* 最右侧：仅保留音量键 */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 音效/静音切换 */}
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                onToggleSound();
              }}
              className="p-0 bg-transparent border-0 transition-transform active:scale-90 cursor-pointer flex items-center justify-center"
              title={isSoundMuted ? '开启音效 🔊' : '静音 🔇'}
              id="btn-header-volume"
            >
              <UiSprite name="volume" width={42} role="img" label={isSoundMuted ? '开启音效' : '静音'} className={isSoundMuted ? 'opacity-45 grayscale' : 'drop-shadow-sm'} />
            </button>
          </div>
        </div>
      </header>

      {/* ====================================================
          2. 小程序固定主体内容区 (Fixed Content Container)
          上面是宣传公告，下面是跳转按钮（严格固定且仅2个方块，无滚轮）
         ==================================================== */}
      <main className="w-full max-w-xl mx-auto px-2 sm:px-3 pt-1.5 sm:pt-2 pb-2 flex-1 min-h-0 flex flex-col justify-start gap-2 sm:gap-3 overflow-hidden">
        {/* ====================================================
            【上面】：宣传公告区 (Promotional Announcements)
            POP UP SHOP 官方画卷展位 (展出轮播)
           ==================================================== */}
        <section className="w-full flex-1 min-h-0 flex flex-col">
          {/* POP UP SHOP 官方画卷宣传展位 */}
          <PopUpShopBanner
            onNavigateTab={onNavigateTab}
            onShowToast={onShowToast}
            onOpenGameModal={() => setActiveModal('game')}
            onOpenRulesModal={() => setActiveModal('rules')}
          />
        </section>

        {/* ====================================================
            【下面】：跳转按钮区 (2个方块: 塔塔开 + 餐厅展示，紧凑平铺在公告栏下方)
           ==================================================== */}
        <section className="w-full h-[20dvh] min-h-[138px] max-h-[210px] shrink-0">
          <MiniProgramJumpGrid
            onOpenGameModal={() => setActiveModal('game')}
            onOpenRestaurant={() => setIsForumOpen(true)}
          />
        </section>
      </main>

      {/* ====================================================
          4. 弹窗模块：小游戏快捷启动
         ==================================================== */}
      {typeof document !== 'undefined' && activeModal === 'game' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200 select-none"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="relative w-full max-w-sm bg-[#FAF6ED] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 text-[#16273B] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                setActiveModal(null);
              }}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#16273B] text-[#F4EADB] hover:bg-[#2A4465] flex items-center justify-center cursor-pointer shadow-xs z-20"
              title="关闭"
            >
              <X size={15} />
            </button>

            {/* 三款游戏卡带 - 极简无边框冗余文字 */}
            <div className="space-y-2.5 pt-2">
              {/* 游戏 1: 利韩 · 合成大西皮 */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playCoin();
                  setActiveModal(null);
                  setActiveGame('daxigua');
                  onShowToast('⚔️ 已进入「利韩 · 合成大西皮」');
                }}
                className="relative w-full group bg-white hover:bg-[#F5EFE0] border-2 border-[#16273B] rounded-xl p-3 cursor-pointer transition-all shadow-[0_2px_8px_rgba(22,39,59,0.1)] active:scale-98 flex items-center gap-3 text-left overflow-hidden"
              >
                <UiSprite name="game-watermelon" width={42} role="img" label="合成大西皮" className="relative z-10 group-hover:scale-110 transition-transform" />
                <span className="relative z-10 font-serif-title text-base font-black text-[#16273B]">
                  利韩 · 合成大西皮
                </span>
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
                className="relative w-full group bg-white hover:bg-[#F5EFE0] border-2 border-[#16273B] rounded-xl p-3 cursor-pointer transition-all shadow-[0_2px_8px_rgba(22,39,59,0.1)] active:scale-98 flex items-center gap-3 text-left overflow-hidden"
              >
                <UiSprite name="game-hange" width={54} role="img" label="拯救韩吉" className="relative z-10 group-hover:scale-110 transition-transform" />
                <span className="relative z-10 font-serif-title text-base font-black text-[#16273B]">
                  利韩 · 拯救韩吉
                </span>
              </button>

              {/* 游戏 3: 利韩 · 利了个韩 */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playBlip();
                  onShowToast('🥔「利了个韩」即将上线');
                }}
                className="relative w-full group bg-[#F1EEE6] border-2 border-[#8C7A68] rounded-xl p-3 cursor-pointer transition-all shadow-[0_2px_8px_rgba(22,39,59,0.08)] active:scale-98 flex items-center gap-3 text-left overflow-hidden opacity-75"
              >
                <UiSprite name="game-lihan" width={54} role="img" label="利了个韩" className="relative z-10 group-hover:scale-110 transition-transform" />
                <span className="relative z-10 font-serif-title text-base font-black text-[#16273B]">
                  利韩 · 利了个韩
                </span>
                <span className="ml-auto text-xs font-bold text-[#8C6226]">即将上线</span>
              </button>
            </div>

            {/* 头号玩家跳转入口：榜单本身在独立弹窗里 */}
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                setActiveModal('leaderboard');
              }}
              className="w-full mt-3 pt-3 border-t-2 border-dashed border-[#C5A059] flex items-center justify-between gap-2 cursor-pointer group"
            >
              <span className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <span className="font-serif-title text-sm font-bold text-[#16273B]">头号玩家</span>
              </span>
              <span className="font-pixel text-[11px] text-[#8C6226] group-hover:translate-x-0.5 transition-transform">
                查看 ›
              </span>
            </button>
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
          onClick={() => setActiveModal(null)}
        >
          <div
            className="relative w-full max-w-sm max-h-[86dvh] bg-[#FAF6ED] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 text-[#16273B] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-1">
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

            <GameLeaderboard onShowToast={onShowToast} />
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
          onClick={() => setActiveGame(null)}
        >
          <div
            className="relative w-full h-full max-w-[100vw] max-h-[100dvh] flex flex-col items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 居中沉浸式游戏画面 (内部自带顶部集成控制条，零遮挡) */}
            <div className="w-full h-full flex flex-col items-center justify-center p-0 m-0">
              <TatakaruGame
                onShowToast={onShowToast}
                initialGame={activeGame}
                onExit={() => setActiveGame(null)}
              />
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
          onClick={() => setActiveModal(null)}
        >
          <div
            className="w-full max-w-lg bg-[#FAF6ED] popup-frame-border rounded-2xl p-4 text-[#16273B] shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#C5A059] pb-2 mb-3">
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

    </div>
  );
};
