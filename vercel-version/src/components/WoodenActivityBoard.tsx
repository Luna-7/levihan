import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Calendar, ArrowRight, ExternalLink, ChevronRight, X } from 'lucide-react';
import { ActivityItem, INITIAL_LEVIHAN_ACTIVITIES } from '../data/activityData';
import { SvgPotatoBannerIcon, SvgLeviSitAvatar, SvgHangeSmileAvatar } from './HomeSvgDecorations';
import { soundManager } from '../utils/audio';
import { PopupSketchOverlay } from './PopupSketchOverlay';

const STORAGE_KEY = 'levihan_custom_activities_v1';

interface Props {
  onShowToast: (msg: string) => void;
  onNavigateTab: (tabId: string) => void;
  onOpenDetails?: () => void;
}

export const WoodenActivityBoard: React.FC<Props> = ({
  onShowToast,
  onNavigateTab,
}) => {
  const [activities, setActivities] = useState<ActivityItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed && parsed.length > 0 ? parsed : INITIAL_LEVIHAN_ACTIVITIES;
      }
    } catch {
      // fallback
    }
    return INITIAL_LEVIHAN_ACTIVITIES;
  });

  const [activeIdx, setActiveIdx] = useState(0);
  const [modalActivity, setModalActivity] = useState<ActivityItem | null>(null);

  // 轮播当前活动
  useEffect(() => {
    if (activities.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % activities.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [activities.length]);

  const current = activities[activeIdx] || activities[0];

  const handleOpenDetail = (act: ActivityItem) => {
    soundManager.playScrollOpen();
    setModalActivity(act);
  };

  const handleActionClick = (act: ActivityItem) => {
    soundManager.playWarpJump();
    if (!act.linkUrl) return;
    if (act.linkUrl.startsWith('/') || act.linkUrl.startsWith('http')) {
      window.open(act.linkUrl, '_blank', 'noopener,noreferrer');
    } else {
      onNavigateTab(act.linkUrl);
    }
  };

  return (
    <>
      {/* 顶部可爱清新活页手账大画板：拉长、占比最大 (还原 image.png 笔记本造型) */}
      <div className="relative w-full h-full flex flex-col select-none pt-0 pb-0">
        {/* 手账活页顶部的可爱彩虹标签 (还原 image.png 顶部书签标签) */}
        <div className="relative z-10 flex items-end gap-1 px-3 sm:px-4 -mb-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => {
              soundManager.playPageTurn();
              setActiveIdx(0);
            }}
            onMouseEnter={() => soundManager.playCardHover()}
            className={`px-3 py-1 font-pixel text-[10px] sm:text-xs font-bold rounded-t-lg border-2 border-b-0 transition-all cursor-pointer whitespace-nowrap shadow-2xs ${
              activeIdx === 0
                ? 'bg-[#4E8A6F] text-white border-[#5F977E] -translate-y-0.5'
                : 'bg-[#E8F2E7] text-[#2F6B52] border-[#5F977E]/60 hover:bg-[#D7E8DF]'
            }`}
          >
            🌸 利韩企划
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playPageTurn();
              setActiveIdx(1 % activities.length);
            }}
            onMouseEnter={() => soundManager.playCardHover()}
            className={`px-3 py-1 font-pixel text-[10px] sm:text-xs font-bold rounded-t-lg border-2 border-b-0 transition-all cursor-pointer whitespace-nowrap shadow-2xs ${
              activeIdx === 1
                ? 'bg-[#FBD38D] text-[#744210] border-[#F6AD55] -translate-y-0.5'
                : 'bg-[#FEFCBF] text-[#975A16] border-[#F6AD55]/60 hover:bg-[#FEEBC8]'
            }`}
          >
            🥔 粮仓丰收
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playPageTurn();
              setActiveIdx(2 % activities.length);
            }}
            onMouseEnter={() => soundManager.playCardHover()}
            className={`px-3 py-1 font-pixel text-[10px] sm:text-xs font-bold rounded-t-lg border-2 border-b-0 transition-all cursor-pointer whitespace-nowrap shadow-2xs ${
              activeIdx === 2
                ? 'bg-[#3B0764] text-[#F3E8FF] border-[#5B21B6] -translate-y-0.5'
                : 'bg-[#5B21B6] text-[#E9D5FF] border-[#3B0764]/80 hover:bg-[#3B0764]'
            }`}
          >
            🎮 塔塔开
          </button>
        </div>

        {/* 手账活页实体：明亮柔和米白质感与粉色双层边框 (还原 image.png 居中大活页) */}
        <div className="relative w-full h-full flex flex-col bg-[#FFFDF9] border-3 border-[#5F977E] rounded-2xl overflow-hidden shadow-[0_6px_20px_rgba(255,168,188,0.35)] transition-all">
          {/* 四个角的可爱像素爱心花饰 */}
          <div className="absolute top-1.5 left-1.5 text-xs text-[#5F977E] pointer-events-none z-20">✿</div>
          <div className="absolute top-1.5 right-1.5 text-xs text-[#5F977E] pointer-events-none z-20">✿</div>
          <div className="absolute bottom-1.5 left-1.5 text-xs text-[#5F977E] pointer-events-none z-20">✿</div>
          <div className="absolute bottom-1.5 right-1.5 text-xs text-[#5F977E] pointer-events-none z-20">✿</div>

          {/* 活页顶头小招牌：粉色渐变饰条与两只可爱趴趴伴侣 */}
          <div className="relative z-10 shrink-0 bg-gradient-to-r from-[#E8F2E7] via-[#F1F7F3] to-[#E8F2E7] border-b-2 border-[#5F977E] px-2.5 sm:px-4 py-1.5 flex items-center justify-between text-[#153025]">
            {/* 左侧：小土豆与利韩专属活动企划标题 */}
            <div className="flex items-center gap-1.5">
              <div className="animate-pulse shrink-0">
                <SvgPotatoBannerIcon size={22} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-pixel text-xs sm:text-sm font-black text-[#285A46] tracking-wide whitespace-nowrap drop-shadow-2xs">
                  利韩专属活动企划
                </span>
                <span className="text-[9px] sm:text-[10px] bg-[#68D391] border border-[#38A169] text-white px-1.5 py-0.2 font-pixel rounded-full whitespace-nowrap shadow-2xs">
                  企划特报
                </span>
              </div>
            </div>

            {/* 右侧：两只趴趴 / 坐姿可爱头像陪伴 */}
            <div className="flex items-center gap-1 opacity-95 shrink-0">
              <span className="hidden xs:inline-block font-retro-jp text-[10px] text-[#285A46] mr-1 whitespace-nowrap font-bold">
                LEVIHAN
              </span>
              <div className="w-5 h-5 sm:w-6 sm:h-6 bg-white border border-[#5F977E] rounded-full flex items-center justify-center overflow-hidden shadow-2xs">
                <SvgLeviSitAvatar size={20} />
              </div>
              <div className="w-5 h-5 sm:w-6 sm:h-6 bg-white border border-[#5F977E] rounded-full flex items-center justify-center overflow-hidden shadow-2xs">
                <SvgHangeSmileAvatar size={20} />
              </div>
            </div>
          </div>

          {/* 活动主体展示区 (清爽米白内页，拉长填充，占比最大) */}
          <div className="relative z-10 flex-1 min-h-0 p-2 sm:p-3 flex flex-col">
            <div className="bg-[#FFFDF7] border-2 border-dashed border-[#C6DED1] rounded-xl flex-1 min-h-0 p-2.5 sm:p-3.5 text-[#374151] relative overflow-hidden flex flex-col justify-between">
              <div className="min-h-0 overflow-hidden flex flex-col">
                {/* 顶部状态与日期 */}
                <div className="flex items-center justify-between gap-1 mb-1 text-xs shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 font-bold text-[10px] sm:text-[11px] bg-[#FEF3C7] text-[#B45309] border border-[#FCD34D] rounded-full whitespace-nowrap shrink-0 shadow-2xs">
                      <Sparkles size={10} className="text-[#F59E0B]" />
                      {current.badge}
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-[#9CA3AF] flex items-center gap-0.5 font-mono whitespace-nowrap truncate font-bold">
                      <Calendar size={10} />
                      {current.date}
                    </span>
                  </div>

                  {/* 轮播指示可爱切换小圆点 */}
                  <div className="flex items-center gap-1 shrink-0">
                    {activities.map((act, i) => (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => {
                          soundManager.playBlip();
                          setActiveIdx(i);
                        }}
                        className={`h-2 sm:h-2.5 rounded-full transition-all cursor-pointer ${
                          i === activeIdx ? 'w-4 sm:w-5 bg-[#2F6B52]' : 'w-2 bg-[#C6DED1] hover:bg-[#3D7B62]'
                        }`}
                        title={act.title}
                      />
                    ))}
                  </div>
                </div>

                {/* 活动标题：拉长空间，字号适度加大 */}
                <h3
                  onClick={() => handleOpenDetail(current)}
                  className="font-pixel text-xs xs:text-sm sm:text-base font-bold text-[#1F2937] hover:text-[#285A46] transition-colors cursor-pointer leading-snug tracking-wide line-clamp-2 shrink-0"
                  title="点击查看完整活动细则"
                >
                  {current.title}
                </h3>

                {/* 活动简述：提供更宽裕舒适的展示行数 */}
                <p className="mt-1 font-retro-jp text-[11px] xs:text-xs text-[#4B5563] leading-relaxed line-clamp-2 sm:line-clamp-3 shrink-0">
                  {current.description}
                </p>

                {/* 活动亮点速览条：在拉长后展现丰富活动指南 */}
                {current.highlights && current.highlights.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-0.5 border-t border-dashed border-[#FCE7F3] pt-1 shrink-0">
                    {current.highlights.slice(0, 2).map((point, pIdx) => (
                      <div key={pIdx} className="flex items-start gap-1 text-[10px] sm:text-[11px] text-[#6B7280] font-retro-jp line-clamp-1">
                        <span className="text-[#2F6B52] font-bold shrink-0">♥</span>
                        <span className="truncate">{point}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 底部操作快捷入口：直接使用还原 image.png 中 COOK 按钮的粉色立体像素按钮 */}
              <div className="mt-2 pt-1.5 border-t border-dashed border-[#FCE7F3] flex items-center justify-between gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenDetail(current)}
                  className="font-retro-jp text-[10px] sm:text-[11px] text-[#6B7280] hover:text-[#1F2937] font-bold flex items-center gap-0.5 cursor-pointer whitespace-nowrap shrink-0 px-2 py-0.5 bg-white border border-[#E5E7EB] rounded-md shadow-2xs hover:bg-[#F9FAFB]"
                >
                  <span>📜 详情细则</span>
                  <ChevronRight size={12} />
                </button>

                {current.linkText && (
                  <button
                    type="button"
                    onClick={() => handleActionClick(current)}
                    className="pixel-cute-green-btn px-3 sm:px-4 py-1 rounded-full text-[10px] sm:text-xs font-pixel font-black flex items-center gap-1 active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span>{current.linkText}</span>
                    {current.linkUrl?.startsWith('http') || current.linkUrl?.endsWith('.html') ? (
                      <ExternalLink size={11} />
                    ) : (
                      <ArrowRight size={11} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 点击弹出的完整活动可爱手账卡片弹窗 (垂直居中) */}
      {typeof document !== 'undefined' && modalActivity && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg my-auto bg-[#FFFDF9] border-3 border-[#5F977E] rounded-2xl shadow-[0_12px_32px_rgba(255,168,188,0.4)] p-4 sm:p-6 text-[#374151] overflow-hidden">
            <PopupSketchOverlay />
            {/* 关闭按键 */}
            <div className="absolute top-3 right-3">
              <button
                type="button"
                onClick={() => {
                  soundManager.playBlip();
                  setModalActivity(null);
                }}
                className="w-7 h-7 rounded-full bg-[#E8F2E7] text-[#2F6B52] hover:bg-[#D7E8DF] flex items-center justify-center cursor-pointer transition-colors shadow-2xs"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <div className="relative flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded-full font-bold text-xs bg-[#FEF3C7] text-[#B45309] border border-[#FCD34D]">
                {modalActivity.badge}
              </span>
              <span className="text-xs text-[#9CA3AF] font-mono">
                {modalActivity.date}
              </span>
            </div>

            <h2 className="relative font-pixel text-base sm:text-lg font-black text-[#1F2937] leading-snug">
              {modalActivity.title}
            </h2>

            <div className="my-3 border-t border-dashed border-[#FCE7F3]" />

            <p className="font-retro-jp text-xs sm:text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap">
              {modalActivity.description}
            </p>

            {modalActivity.highlights && modalActivity.highlights.length > 0 && (
              <div className="mt-3 bg-[#FFF5F7] border border-[#D7E8DF] p-3 rounded-xl space-y-1.5">
                <div className="font-pixel text-xs text-[#2F6B52] font-bold">
                  📌 活动要点与参展指南：
                </div>
                {modalActivity.highlights.map((h, i) => (
                  <div key={i} className="text-xs text-[#4B5563] flex items-start gap-1.5 leading-relaxed">
                    <span className="text-[#2F6B52] font-bold">♥</span>
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-dashed border-[#FCE7F3] flex items-center justify-between">
              <span className="text-[11px] text-[#9CA3AF]">
                利韩同好驻地 · 管理员活动公告栏
              </span>

              {modalActivity.linkText && (
                <button
                  type="button"
                  onClick={() => {
                    handleActionClick(modalActivity);
                    setModalActivity(null);
                  }}
                  className="pixel-cute-green-btn px-4 py-1.5 rounded-full text-xs font-pixel font-bold active:scale-95 cursor-pointer flex items-center gap-1"
                >
                  <span>{modalActivity.linkText}</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
