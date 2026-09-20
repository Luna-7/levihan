import React, { useState, useEffect, useRef } from 'react';
import { GROUP_INFO } from '../data/initialData';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
}

interface NoticeItem {
  id: string;
  type: 'notice' | 'group' | 'tip' | 'quote' | 'survey';
  tag: string;
  icon: string;
  text: string;
  detail?: string;
  number?: string;
}

const SURVEY_REPORT_URL = '/cp-community-survey-report.html';

// 徽章配色：调查结论用兵团绿，与日常公告的棕色区分
const TAG_STYLE: Record<NoticeItem['type'], string> = {
  survey: 'bg-[#1E4334] border-[#1C1611] text-[#F9E79F]',
  notice: 'bg-[#4A2D16] border-[#1C1611] text-[#F9E79F]',
  group: 'bg-[#4A2D16] border-[#1C1611] text-[#F9E79F]',
  tip: 'bg-[#4A2D16] border-[#1C1611] text-[#F9E79F]',
  quote: 'bg-[#4A2D16] border-[#1C1611] text-[#F9E79F]',
};

// 2026.07 CP 社群调查（225 份有效问卷 / 1289 条开放反馈）结论公示
const SURVEY_NOTICES: NoticeItem[] = [
  {
    id: 's-1',
    type: 'survey',
    icon: '📊',
    tag: '调查出炉',
    text: '225 份问卷 + 1289 条留言，社群调查分析报告已上线 📄',
    detail:
      '数据收集于 2026 年 7 月，覆盖约 11.2% 的成员、27 个省级行政区、3 个国家/地区。报告只是把大家说过的话整理出来，不是投票结果，不是多数决，也不代表管理组的任何判断或后续调整方向。全文可在「兵团驻地」底部点开。',
  },
  {
    id: 's-2',
    type: 'survey',
    icon: '🥔',
    tag: '土豆画像',
    text: '93.3% 女生 · 55.1% 是 18–22 岁 · 91.5% 来这儿只为吃粮',
    detail:
      '1 年以内新粉合计 41.4%，社群还在快速长新土豆。上号时间很随机（73.8% 不固定），所以好粮一不小心就被刷走。群感受评分：友好度 4.60、管理尺度 4.54、活跃度 4.29、归属感 4.23（满分 5）——氛围是好评，融入感还能再攒攒。',
  },
  {
    id: 's-3',
    type: 'survey',
    icon: '🍚',
    tag: '留下理由',
    text: '70.7% 说：留下来是因为这里有稳定的好粮',
    detail:
      '其余是「习惯了，日常看一眼」15.1%、「群氛围舒服」9.3%、「有聊得来的同好」2.2%。社群的核心竞争力是资源供给能力，不是社交关系链——粮不断，人就还在。',
  },
  {
    id: 's-4',
    type: 'survey',
    icon: '🚫',
    tag: '三条硬边界',
    text: '公开对线 72.4% · 偏激言论 68.4% · R18 无预警 65.8%',
    detail:
      '三项「坚决抵制」比例最高的行为，构成社群的硬边界：将群内私人纠纷公开对线 72.4%、群内发表偏激负面言论 68.4%、R18 图文无预警直接发 65.8%。共同点是「人在现场制造冲突」或「不给别人知情选择权」。抵制强度呈清晰层级：人际冲突类 > 内容规范类 > 边界模糊类。',
  },
  {
    id: 's-5',
    type: 'survey',
    icon: '⚖️',
    tag: '对家内容',
    text: '非恶意提及 57.8% 能接受，但安利/拉踩 90.7% 拒绝',
    detail:
      '社群对对家内容是「程度敏感型」，不是「绝对零容忍型」：对家被提及（非安利）57.8% 可接受，一旦升级为安利或拉踩，拒绝率飙到 90.7%。所以规则走分级管理——提及可以，安利和拉踩不行，而不是简单一刀切。',
  },
  {
    id: 's-6',
    type: 'survey',
    icon: '📚',
    tag: '粮仓整理',
    text: '跨群文件不统一 57.3%、文件难搜 28.0%——在改了',
    detail:
      '「资源/文件」是开放反馈里出现最多的词（136 次），「索引/整理/归档」50 次，「好粮被聊天刷掉」19.1%。83.6% 表示愿意参与资源维护。下一步：统一资源索引、规范文件命名、定期归档精品。想搭把手的可以直接找管理组。',
  },
  {
    id: 's-7',
    type: 'survey',
    icon: '🤖',
    tag: 'AI 标注',
    text: 'AI 内容不是不能发，标注一下就行（未标注 53.3% 抵制）',
    detail:
      '自己生成并标注：约 45% 接受 / 欢迎；转发别人的 AI 作品：约 40% 反感。差别不在 AI 本身，而在「是不是你的劳动」和「有没有提前说清楚」。一句话：用 AI 可以，标出来就行。',
  },
  {
    id: 's-8',
    type: 'survey',
    icon: '🎉',
    tag: '活动偏好',
    text: '联文/围谈最受欢迎，49.8% 觉得节日办就够了',
    detail:
      '内容共创型最吃香：联文/接龙创作 61.3%、剧情设定围谈 60.0%。频率上 49.8% 认为「重大节日/糖点日举办即可」，32.9% 明确更喜欢自由聊天。活动会做轻一点：低门槛、有产出、不强社交。',
  },
  {
    id: 's-9',
    type: 'survey',
    icon: '🗓️',
    tag: '下次调查',
    text: '42.7% 希望「偶尔就好」，66.2% 更认正式问卷',
    detail:
      '频率上 42.7% 倾向半年一次或重大事件后发起，31.6% 支持每季度一次；形式上正式问卷（66.2%）远优于群投票（28.9%）——大家觉得认真的事值得认真回答。下次见。',
  },
];

const NOTICES: NoticeItem[] = [
  ...SURVEY_NOTICES,
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
    soundManager.playCopySuccess();
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
    if (selectedNotice?.id === item.id) {
      soundManager.playSoftSwoosh();
      setSelectedNotice(null);
    } else {
      soundManager.playScrollOpen();
      setSelectedNotice(item);
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playPageTurn();
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playPageTurn();
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
            <span className="font-pixel text-xs sm:text-[11px] font-bold tracking-widest text-center leading-tight">
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
                    className="flex items-center justify-between gap-1.5 px-0.5 text-[#FFF8EC] font-pixel text-[13px] sm:text-xs select-none border-b border-white/5 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors"
                    onMouseEnter={() => soundManager.playCardHover()}
                    onClick={() => handleNoticeClick(item)}
                    title="点击查看详情"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span
                        className={`px-1.5 py-0.2 border text-[11px] sm:text-[10px] shrink-0 font-bold ${TAG_STYLE[item.type]}`}
                      >
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
                          className="px-1.5 py-0.5 bg-[#8C5828] hover:bg-[#A36730] active:scale-90 text-[#F9E79F] border border-[#1C1611] text-[11px] sm:text-[10px] font-bold cursor-pointer shadow-xs whitespace-nowrap"
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
