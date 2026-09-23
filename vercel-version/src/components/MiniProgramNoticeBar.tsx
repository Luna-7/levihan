import React, { useState, useEffect } from 'react';
import { Volume2, Copy, Check, ChevronRight, ShieldAlert, Sparkles } from 'lucide-react';
import { GROUP_INFO } from '../data/initialData';
import { soundManager } from '../utils/audio';

const NOTICE_ITEMS = [
  {
    id: 'n1',
    tag: '公约',
    tagColor: 'bg-[#16273B] text-[#F4EADB]',
    text: '严正声明：本站所有同人本与汉化资源严禁商用、倒卖、私印与二传！',
    actionType: 'rules',
  },
  {
    id: 'n2',
    tag: '交流',
    tagColor: 'bg-[#C5A059] text-[#16273B]',
    text: `调查兵团同好交流群：${GROUP_INFO.qqGroups.map((g) => g.number).join(' / ')} 点击一键复制`,
    actionType: 'copy',
  },
  {
    id: 'n3',
    tag: '粮仓',
    tagColor: 'bg-[#8B5CF6] text-white',
    text: '土豆粮仓：A~Z卷汉化同人本高清重修完成，支持移动端双页阅览！',
    actionType: 'doujinshi',
  },
];

interface Props {
  onShowToast: (msg: string) => void;
  onOpenRulesModal: () => void;
  onNavigateTab: (tabId: string) => void;
}

export const MiniProgramNoticeBar: React.FC<Props> = ({
  onShowToast,
  onOpenRulesModal,
  onNavigateTab,
}) => {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setIndex((prev) => (prev + 1) % NOTICE_ITEMS.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const currentNotice = NOTICE_ITEMS[index];

  const handleCopyGroups = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playCoin();
    const numbers = GROUP_INFO.qqGroups.map((g) => `${g.name}: ${g.number}`).join(' | ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(numbers).then(
        () => {
          setCopied(true);
          onShowToast('📋 全部QQ群号已复制成功！');
          setTimeout(() => setCopied(false), 2200);
        },
        () => onShowToast(`QQ群号：${numbers}`)
      );
    } else {
      onShowToast(`QQ群号：${numbers}`);
    }
  };

  const handleBarClick = () => {
    soundManager.playWoodTap();
    if (currentNotice.actionType === 'rules') {
      onOpenRulesModal();
    } else if (currentNotice.actionType === 'copy') {
      handleCopyGroups({ stopPropagation: () => {} } as React.MouseEvent);
    } else if (currentNotice.actionType === 'doujinshi') {
      onNavigateTab('doujinshi');
    }
  };

  return (
    <div className="w-full my-2 select-none">
      <div
        onClick={handleBarClick}
        className="w-full bg-[#FAF6ED] border border-[#C5A059] rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 shadow-[0_2px_8px_rgba(22,39,59,0.08)] cursor-pointer hover:bg-[#F5EFE0] transition-colors"
      >
        {/* 左侧喇叭图标 */}
        <div className="shrink-0 flex items-center justify-center w-6 h-6 rounded-lg bg-[#16273B] text-[#C5A059] shadow-2xs">
          <span className="text-xs">📢</span>
        </div>

        {/* 中间文字轮播 */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
          <span
            className={`font-serif-title text-[9px] sm:text-[10px] font-bold px-1.5 py-0.2 rounded-xs shrink-0 whitespace-nowrap ${currentNotice.tagColor}`}
          >
            {currentNotice.tag}
          </span>
          <p className="text-xs sm:text-[13px] text-[#2C241D] font-medium truncate font-sans">
            {currentNotice.text}
          </p>
        </div>

        {/* 右侧快捷按钮 */}
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyGroups}
            className="px-2 py-0.8 bg-[#C5A059] hover:bg-[#B38F48] active:scale-95 text-[#16273B] rounded-md font-serif-title text-[9px] sm:text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-2xs whitespace-nowrap"
            title="一键复制全部群号"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-900" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? '已复制' : '复制群号'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
