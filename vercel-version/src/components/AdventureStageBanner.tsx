import React from 'react';
import { NavigationTab } from '../types';

interface Props {
  activeTab: NavigationTab;
}

const STAGE_CONFIGS: Partial<Record<
  NavigationTab,
  {
    stage: string;
    location: string;
    landmark: string;
    desc: string;
    status: string;
    borderCol: string;
    bgBadge: string;
  }
>> = {
  home: {
    stage: 'STAGE 1',
    location: '兵团要塞大本营',
    landmark: '🏰',
    desc: '勇者探险队出发据点：利韩企划展板、兵团公告与街机训练室',
    status: '集结整装中',
    borderCol: 'border-[#5F977E]',
    bgBadge: 'bg-[#E8F2E7] text-[#285A46] border border-[#5F977E]',
  },
  resources: {
    stage: 'STAGE 2',
    location: '壁外调查情报所',
    landmark: '🌲',
    desc: '勇者小人已抵达古木书库：收集到140+画师、AO3珍藏与官方原案资料！',
    status: '情报搜集完成',
    borderCol: 'border-[#5B21B6]',
    bgBadge: 'bg-[#3B0764] text-[#F3E8FF] border border-[#5B21B6]',
  },
  doujinshi: {
    stage: 'STAGE 3',
    location: '黄金土豆粮仓',
    landmark: '🥔',
    desc: '勇者小人已推开粮仓重门：A-Z卷汉化精修、同人画册与珍贵特典满载！',
    status: '粮仓大丰收',
    borderCol: 'border-[#FCD34D]',
    bgBadge: 'bg-[#FEF3C7] text-[#B45309] border border-[#FCD34D]',
  },
  dispatch: {
    stage: 'STAGE 4',
    location: '前线飞鸽通讯站',
    landmark: '🕊️',
    desc: '勇者小人已登上信号高塔：飞鸽整装待发，等待呈递你的专属战术心意！',
    status: '信号就绪',
    borderCol: 'border-[#5B21B6]',
    bgBadge: 'bg-[#3B0764] text-[#F3E8FF] border border-[#5B21B6]',
  },
};

export const AdventureStageBanner: React.FC<Props> = ({ activeTab }) => {
  const config = STAGE_CONFIGS[activeTab] || STAGE_CONFIGS.home!;

  return (
    <div
      className={`w-full mb-3 px-3 py-2 bg-[#FFFDF9] border-2 ${config.borderCol} rounded-xl shadow-[0_2px_12px_rgba(255,168,188,0.25)] flex items-center justify-between gap-2`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xl sm:text-2xl shrink-0 drop-shadow-2xs">{config.landmark}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`font-pixel text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-black uppercase shadow-2xs ${config.bgBadge}`}
            >
              {config.stage}
            </span>
            <span className="font-pixel text-xs sm:text-sm font-black text-[#1F2937] tracking-wide truncate">
              {config.location}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-[#6B7280] mt-0.5 line-clamp-1 font-medium">
            {config.desc}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right hidden xs:block">
        <span className="inline-flex items-center gap-1.5 font-pixel text-[9px] sm:text-[10px] text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 rounded-full shadow-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-ping" />
          <span>{config.status}</span>
        </span>
      </div>
    </div>
  );
};
