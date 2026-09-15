import React, { useState, useEffect, useRef } from 'react';
import { GROUP_INFO } from '../data/initialData';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
}

interface NoticeItem {
  id: string;
  type: 'notice' | 'group' | 'tip' | 'quote';
  tag: string;
  icon: string;
  text: string;
  number?: string;
}

const NOTICES: NoticeItem[] = [
  {
    id: 'n-1',
    type: 'notice',
    icon: '📢',
    tag: '最新公告',
    text: '利韩土豆仓支持离线秒开，已可直接在顶部点击【下载到桌面】💻',
  },
  {
    id: 'n-2',
    type: 'group',
    icon: '🥔',
    tag: '土豆一仓',
    text: `主群：${GROUP_INFO.qqGroups[0]?.number || '719875459'} (同好交流/吃粮)`,
    number: GROUP_INFO.qqGroups[0]?.number || '719875459',
  },
  {
    id: 'n-3',
    type: 'group',
    icon: '🥔',
    tag: '土豆二仓',
    text: `二仓：${GROUP_INFO.qqGroups[1]?.number || '552554761'} (日常碎碎念/同好)`,
    number: GROUP_INFO.qqGroups[1]?.number || '552554761',
  },
  {
    id: 'n-4',
    type: 'group',
    icon: '🥔',
    tag: '土豆三仓',
    text: `三仓：${GROUP_INFO.qqGroups[2]?.number || '901243128'} (日常磕糖/安利)`,
    number: GROUP_INFO.qqGroups[2]?.number || '901243128',
  },
  {
    id: 'n-5',
    type: 'group',
    icon: '⚔️',
    tag: '兵团招募',
    text: '招募群：979246377 (汉化/美工/管理)',
    number: '979246377',
  },
  {
    id: 'n-6',
    type: 'tip',
    icon: '📝',
    tag: '入群提示',
    text: '入群申请请务必认真填写三条利韩真实磕点',
  },
  {
    id: 'n-7',
    type: 'tip',
    icon: '🍠',
    tag: '粮仓指南',
    text: '汉化同人本、全员周边图鉴、塔塔开小游戏已全线更新',
  },
  {
    id: 'n-8',
    type: 'quote',
    icon: '☕',
    tag: '利韩誓言',
    text: '“韩吉，把心脏献给我吧。”——生死契阔，唯有此誓',
  },
];

const ITEM_HEIGHT = 28; // height of each line in px
const VISIBLE_COUNT = 3; // exactly 3 lines visible simultaneously
const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT; // 84px

export const WoodenAnnouncementBoard: React.FC<Props> = ({ onShowToast }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAnimating, setIsAnimating] = useState(true);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const total = NOTICES.length;
  // Duplicate the first 3 items at the end to allow seamless loop
  const displayItems = [...NOTICES, ...NOTICES.slice(0, VISIBLE_COUNT)];

  useEffect(() => {
    if (isPaused || selectedNotice !== null) return;

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => prev + 1);
      setIsAnimating(true);
    }, 3200);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, selectedNotice, total]);

  // Handle wrap-around when reaching duplicate boundary
  useEffect(() => {
    if (currentIndex === total) {
      const resetTimer = setTimeout(() => {
        setIsAnimating(false);
        setCurrentIndex(0);
      }, 500); // match transition duration
      return () => clearTimeout(resetTimer);
    }
  }, [currentIndex, total]);

  const handleCopy = (tag: string, number?: string) => {
    if (!number) return;
    soundManager.playCoin();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(number).then(
        () => onShowToast(`已复制${tag}：${number} 📋`),
        () => onShowToast(`${tag}：${number}`)
      );
    } else {
      onShowToast(`${tag}：${number}`);
    }
  };

  const handleNoticeClick = (item: NoticeItem) => {
    soundManager.playBlip();
    if (selectedNotice?.id === item.id) {
      setSelectedNotice(null);
    } else {
      setSelectedNotice(item);
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playBlip();
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playBlip();
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev < total ? prev + 1 : 1));
  };

  return (
    <div className="relative w-full select-none pt-2.5 pb-0.5">
      {/* 顶部左侧金属挂钉 (8-bit 木牌设计) */}
      <div className="absolute top-0 left-7 sm:left-10 z-20 pointer-events-none flex flex-col items-center">
        <div className="w-3.5 sm:w-4 h-5 sm:h-6 bg-[#34343F] border-2 border-[#181410] rounded-sm relative shadow-xs overflow-hidden">
          <span className="absolute top-0 left-0.5 w-1 h-full bg-[#9E9EAE]" />
          <span className="absolute top-0.5 left-0.5 w-0.5 h-full bg-[#FFFFFF]/80" />
        </div>
      </div>

      {/* 顶部右侧金属挂钉 (8-bit 木牌设计) */}
      <div className="absolute top-0 right-7 sm:right-10 z-20 pointer-events-none flex flex-col items-center">
        <div className="w-3.5 sm:w-4 h-5 sm:h-6 bg-[#34343F] border-2 border-[#181410] rounded-sm relative shadow-xs overflow-hidden">
          <span className="absolute top-0 left-0.5 w-1 h-full bg-[#9E9EAE]" />
          <span className="absolute top-0.5 left-0.5 w-0.5 h-full bg-[#FFFFFF]/80" />
        </div>
      </div>

      {/* 复古原木长方形公告板主体 */}
      <div
        className="relative w-full bg-gradient-to-b from-[#C78550] via-[#BA7745] to-[#AD6B3B] border-[3px] border-[#1C1611] rounded-none shadow-[2px_2px_0px_#1C1611] p-2 sm:p-2.5 overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {/* 顶部高光木边 */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#DE9968]" />

        {/* 钉子下方投影 */}
        <div className="absolute top-0 left-[26px] sm:left-[38px] w-4 h-1 bg-[#6A3716] pointer-events-none" />
        <div className="absolute top-0 right-[26px] sm:right-[38px] w-4 h-1 bg-[#6A3716] pointer-events-none" />

        {/* 长方形内部内容布局：左侧公告徽章 + 中间同时显示3条信息并上翻滚动 + 右侧微调翻页 */}
        <div className="relative z-10 flex items-stretch gap-2">
          {/* 左侧：复古像素喇叭徽章 */}
          <div
            className="flex flex-col items-center justify-center gap-1 bg-[#4A2D16] border-2 border-[#1C1611] px-2 py-1.5 text-[#F9E79F] shadow-xs shrink-0 select-none"
          >
            <span className="text-base sm:text-lg animate-pulse">📢</span>
            <span className="font-pixel text-[10px] sm:text-[11px] font-bold tracking-widest text-center leading-tight">
              兵团
              <br />
              公告
            </span>
          </div>

          {/* 中间：长方形内嵌木槽，默认同时显示3条信息，上翻滚动，点击查看详情 */}
          <div className="flex-1 bg-[#2C180C]/95 border-2 border-[#1C1611] shadow-[inset_1px_1px_4px_rgba(0,0,0,0.7)] px-1.5 py-1 overflow-hidden relative min-h-[84px]">
            <div
              style={{ height: `${CONTAINER_HEIGHT}px` }}
              className="overflow-hidden relative"
            >
              <div
                style={{
                  transform: `translateY(-${currentIndex * ITEM_HEIGHT}px)`,
                  transition: isAnimating ? 'transform 450ms ease-in-out' : 'none',
                }}
              >
                {displayItems.map((item, idx) => (
                  <div
                    key={`${item.id}-${idx}`}
                    style={{ height: `${ITEM_HEIGHT}px` }}
                    className="flex items-center justify-between gap-1.5 px-0.5 text-[#FFF8EC] font-pixel text-[11px] sm:text-xs select-none border-b border-white/5 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => handleNoticeClick(item)}
                    title="点击查看详情"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="px-1.5 py-0.2 bg-[#4A2D16] border border-[#1C1611] text-[#F9E79F] text-[9px] sm:text-[10px] shrink-0 font-bold">
                        {item.icon} {item.tag}
                      </span>
                      <span
                        className="truncate text-[#FFF8EC] hover:text-[#F9E79F] transition-colors hover:underline"
                      >
                        {item.text}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {item.number && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(item.tag, item.number);
                          }}
                          className="px-1.5 py-0.5 bg-[#8C5828] hover:bg-[#A36730] active:scale-90 text-[#F9E79F] border border-[#1C1611] text-[9px] sm:text-[10px] font-bold cursor-pointer shadow-xs whitespace-nowrap"
                          title="点击复制群号"
                        >
                          复制
                        </button>
                      )}
                      <span className="text-[9px] text-[#E0C070] hidden sm:inline-block">
                        详情 ▸
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧微调翻页按钮 */}
          <div className="flex flex-col justify-between py-0.5 shrink-0 select-none gap-1">
            <button
              type="button"
              onClick={handlePrev}
              className="w-5 h-[38px] bg-[#4A2D16] hover:bg-[#5C391C] text-[#F9E79F] border border-[#1C1611] flex items-center justify-center font-pixel text-[9px] cursor-pointer active:scale-90 shadow-xs"
              title="上翻一条"
              aria-label="上翻一条"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="w-5 h-[38px] bg-[#4A2D16] hover:bg-[#5C391C] text-[#F9E79F] border border-[#1C1611] flex items-center justify-center font-pixel text-[9px] cursor-pointer active:scale-90 shadow-xs"
              title="下翻一条"
              aria-label="下翻一条"
            >
              ▼
            </button>
          </div>
        </div>

        {/* 单击某一条公告时直接展示的完整详情羊皮纸弹条 */}
        {selectedNotice && (
          <div className="relative z-20 mt-2 p-2 sm:p-2.5 bg-[#FAF0D7] border-2 border-[#1C1611] text-[#2C180C] font-retro-jp text-xs shadow-[2px_2px_0px_#1C1611] animate-fadeIn flex items-start justify-between gap-2 select-text">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1 select-none">
                <span className="px-1.5 py-0.5 bg-[#4A2D16] text-[#F9E79F] font-pixel text-[10px] font-bold">
                  {selectedNotice.icon} {selectedNotice.tag}
                </span>
              </div>
              <p className="leading-relaxed text-[#2C180C] select-text font-bold">
                {selectedNotice.text}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 select-none">
              {selectedNotice.number && (
                <button
                  type="button"
                  onClick={() => handleCopy(selectedNotice.tag, selectedNotice.number)}
                  className="px-2 py-1 bg-[#8C5828] hover:bg-[#A36730] text-[#F9E79F] text-[10px] font-bold border border-[#1C1611] cursor-pointer active:scale-95 transition-colors"
                  title="点击复制群号"
                >
                  复制群号
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                className="px-2 py-1 bg-[#4A2D16] hover:bg-[#5C391C] text-[#F9E79F] text-[10px] font-bold border border-[#1C1611] cursor-pointer active:scale-95 transition-colors"
                title="关闭详情"
              >
                ✕ 关闭
              </button>
            </div>
          </div>
        )}

        {/* 底部木纹阴影 */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#874A21]" />
      </div>
    </div>
  );
};
