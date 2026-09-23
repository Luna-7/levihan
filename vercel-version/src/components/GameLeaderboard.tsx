import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  fetchLeaderboard,
  readLocalBest,
  GAME_KEYS,
  GAME_META,
  type GameKey,
  type LeaderboardData,
  type TotalRow,
} from '../utils/gameScores';

type Tab = 'total' | GameKey;

interface Props {
  onShowToast: (msg: string) => void;
}

const MEDALS = ['#C5A059', '#9CA3AF', '#B9770E'];

const TABS: Array<{ key: Tab; label: string; title: string }> = [
  { key: 'total', label: '总榜', title: '三款游戏综合积分' },
  { key: 'daxigua', label: '大西皮', title: '利韩 · 合成大西皮' },
  { key: 'hange', label: '拯救韩吉', title: '利韩 · 拯救韩吉（仅绝境难度）' },
  { key: 'lihan', label: '利了个韩', title: '利韩 · 利了个韩（按通关时间）' },
];

const formatTime = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

const Breakdown = ({ row }: { row: TotalRow }) => (
  <span className="flex gap-2 text-[11px] font-pixel shrink-0">
    {GAME_KEYS.map((key) => (
      <span key={key} style={{ color: row.breakdown[key] ? GAME_META[key].color : '#C9BFAB' }}>
        {row.breakdown[key] ?? '—'}
      </span>
    ))}
  </span>
);

export const GameLeaderboard: React.FC<Props> = ({ onShowToast }) => {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [tab, setTab] = useState<Tab>('total');
  const [refreshing, setRefreshing] = useState(false);
  const [localBest] = useState(() => readLocalBest());

  const load = useCallback(async () => {
    const result = await fetchLeaderboard();
    setData(result);
    setStatus(result ? 'ready' : 'unavailable');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load().finally(() => {
      setRefreshing(false);
      onShowToast('榜单已刷新');
    });
  };

  const rows: TotalRow[] = !data
    ? []
    : tab === 'total'
      ? data.total
      : (data[tab] || []).map((row) => ({ ...row, breakdown: { [tab]: row.merit } }));

  const hasLocal = GAME_KEYS.some((key) => (localBest[key] || 0) > 0);

  return (
    <div className="flex flex-col w-full">
      {/* 标题行 + 榜单切换 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="font-pixel text-[12px] text-[#16273B] font-bold">🏆 头号玩家</span>
        <div className="flex items-center gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.title}
              onClick={() => setTab(item.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-pixel cursor-pointer transition-colors ${
                tab === item.key
                  ? 'bg-[#16273B] text-[#F9E79F]'
                  : 'bg-white text-[#715431] border border-[#D5C19A] hover:bg-[#F5EFE0]'
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRefresh}
            title="刷新榜单"
            className="w-5 h-5 flex items-center justify-center text-[#8A7968] hover:text-[#16273B] cursor-pointer"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 榜单主体 */}
      <div className="mt-2 overflow-y-auto max-h-[46dvh] pr-0.5">
        {status === 'loading' && (
          <div className="space-y-1.5 py-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-[#EFE7D6] rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {status === 'unavailable' && (
          <p className="py-4 text-center font-retro-jp text-[11px] text-[#8A7968] leading-relaxed">
            榜单暂时无法加载
            <br />
            <span className="text-[#A09381]">成绩仍会记录在本机</span>
          </p>
        )}

        {status === 'ready' && rows.length === 0 && (
          <p className="py-4 text-center font-retro-jp text-[11px] text-[#8A7968] leading-relaxed">
            还没有人上榜
            <br />
            <span className="text-[#A09381]">去拿下第一个首杀 ⚔️</span>
          </p>
        )}

        {status === 'ready' && rows.length > 0 && (
          <div className="space-y-1.5 pb-1">
            {rows.map((row, index) => (
              <div
                key={`${row.uid}-${index}`}
                className="flex items-center gap-2 bg-[#FFFDF5] border border-[#D5C19A] rounded-lg px-2.5 py-1.5"
              >
                {index < 3 ? (
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] text-white font-pixel shrink-0"
                    style={{ background: MEDALS[index] }}
                  >
                    {index + 1}
                  </span>
                ) : (
                  <span className="w-5 text-center text-[12px] text-[#A09381] font-pixel shrink-0">{index + 1}</span>
                )}
                <span className="flex-1 min-w-0 truncate font-serif-title text-[13px] text-[#16273B]">
                  {row.nickname}
                </span>
                {tab === 'total' && <Breakdown row={row} />}
                <span className="min-w-9 text-right font-pixel text-[14px] text-[#16273B] shrink-0">
                  {tab === 'lihan' ? formatTime(row.timeUsedSeconds) : row.merit}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 我的战绩 */}
      <div className="mt-2 pt-2 border-t border-dashed border-[#D5C19A] shrink-0">
        {data?.me ? (
          <div className="flex items-center gap-2 bg-[#F5EFE0] border border-[#C5A059] rounded-lg px-2.5 py-1.5">
            <span className="font-pixel text-[11px] text-[#715431] shrink-0">我的战绩</span>
            <span className="flex-1 min-w-0 truncate font-retro-jp text-[12px] text-[#16273B]">
              第 {data.me.ranks[tab] ?? '—'} 名 · 积分 <b className="font-pixel">{tab === 'total' ? data.me.merit : data.me.breakdown[tab] ?? '—'}</b>
            </span>
            {tab === 'total' && <Breakdown row={data.me} />}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-retro-jp text-[11px] text-[#8A7968]">
              登录后成绩会同步到头号玩家
              {hasLocal && (
                <>
                  {' · '}
                  本机最佳
                  {GAME_KEYS.filter((key) => (localBest[key] || 0) > 0).map((key) => (
                    <span key={key} className="font-pixel ml-1" style={{ color: GAME_META[key].color }}>
                      {GAME_META[key].short} {localBest[key]}
                    </span>
                  ))}
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
