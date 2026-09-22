import React, { useEffect, useMemo, useState } from 'react';
import { soundManager } from '../utils/audio';
import { cosService } from '../services/cosClient';
import { GroupNovel } from '../types/doujinArchive';
import { fmtTime } from '../utils/forumFormat';
import type { ForumPost } from './RestaurantForum';
import { ADMIN_UPLOAD_ENDPOINT } from '../utils/cloudbaseEndpoint';
import { useAppShellStore } from '../stores/appShellStore';

/** 三种更新来源的归类 */
type UpdateKind = 'novel' | 'relay';

interface UpdateItem {
  id: string;
  kind: UpdateKind;
  text: string;
  createdAt: string;
}

interface Props {
  onNavigateTab: (tabId: string) => void;
  onShowToast: (msg: string) => void;
}

/** 类别 → 徽章（与公告栏同款配色语言，仅色相区分类型） */
const KIND_META: Record<UpdateKind, { label: string; cls: string }> = {
  novel: { label: '小说本', cls: 'bg-[#1D9E75] text-[#F2FFF9] border-[#0F6E56]' },
  relay: { label: '接力棒', cls: 'bg-[#BA7517] text-[#FFF8EA] border-[#854F0B]' },
};

/** 今日 0 点时间戳（本地时区） */
function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 相对排序键：缺时间戳一律视为最旧，不参与「今日」 */
function timeOf(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** 作者名兜底：未知/空 → 匿名说法 */
function byLine(author: string | undefined): string {
  const a = (author || '').trim();
  if (!a || a === '未知') return '有人';
  return `『${a}』`;
}

export const HomeTodaysUpdates: React.FC<Props> = ({ onNavigateTab, onShowToast }) => {
  const [items, setItems] = useState<UpdateItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      const start = todayStart();

      const push = (list: UpdateItem[], it: UpdateItem) => {
        if (timeOf(it.createdAt) >= start) list.push(it);
      };

      Promise.resolve().then(() => {
          if (cancelled) return;
          const acc: UpdateItem[] = [];

          cosService
            .loadNovelList()
            .then((novels: GroupNovel[]) => {
              if (cancelled) return;
              novels.forEach((n) => {
                const t = timeOf(n.createdAt || n.updatedAt);
                if (t < start) return;
                push(acc, {
                  id: `novel-${n.id}`,
                  kind: 'novel',
                  text: `${byLine(n.author)}投了篇新文《${n.title}》`,
                  createdAt: n.createdAt || n.updatedAt || '',
                });
              });

              // 接力棒：论坛接龙帖 comments 里今天新增的棒（含开头第 1 棒）
              const requestForum = (action: 'forumTodayRelay' | 'forumList') => fetch(ADMIN_UPLOAD_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({ action, since: start }),
              });
              requestForum('forumTodayRelay')
                .then((r) => r.status === 400 ? requestForum('forumList') : r)
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error('list fail'))))
                .then((data: { posts?: ForumPost[] }) => {
                  if (cancelled) return;
                  (Array.isArray(data.posts) ? data.posts : []).forEach((post) => {
                    if (post.category !== 'relay') return;
                    const title = post.title || '未命名接龙';
                    const isNewPost = timeOf(post.createdAt) >= start;
                    if (isNewPost) {
                      push(acc, {
                        id: `relay-open-${post.id}`,
                        kind: 'relay',
                        text: `${byLine(post.author)}开了头棒《${title}》`,
                        createdAt: post.createdAt,
                      });
                    }
                    (post.comments || []).forEach((c) => {
                      const t = timeOf(c.createdAt);
                      if (t < start) return;
                      const step = c.relayStep != null ? `第 ${c.relayStep} 棒` : '新的一棒';
                      push(acc, {
                        id: `relay-${post.id}-${c.id}`,
                        kind: 'relay',
                        text: `${byLine(c.author)}接下了${step}《${title}》`,
                        createdAt: c.createdAt,
                      });
                    });
                  });
                  if (!cancelled) {
                    setItems(acc.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, 3));
                  }
                })
                .catch(() => {
                  if (!cancelled) setItems(acc.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, 3));
                });
            })
            .catch(() => {
              if (!cancelled) setItems(acc.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, 3));
            });
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    };

    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 120_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const handleClick = useMemo(
    () => (it: UpdateItem) => {
      soundManager.playWoodTap();
      if (it.kind === 'relay') {
        onNavigateTab('doujinshi');
        return;
      }
      if (it.kind === 'novel') {
        onNavigateTab('resources');
        useAppShellStore.getState().openNovelCategory();
        return;
      }
    },
    [onNavigateTab]
  );

  // 今天没有任何上新 → 整栏隐藏，保持首页干净
  if (items.length === 0) return null;

  return (
    <section className="w-full shrink-0 px-1">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1 h-3 bg-[#C5A059] rounded-full" aria-hidden="true" />
        <h3 className="font-pixel text-[10px] sm:text-[11px] text-[#8C7A65] tracking-wider">今日上新</h3>
      </div>

      <div className="flex flex-col gap-1">
        {items.map((it) => {
          const meta = KIND_META[it.kind];
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => handleClick(it)}
              className="group flex items-center gap-2 text-left cursor-pointer transition-all active:scale-[0.99] bg-[#F8F1DE] border-[1.5px] border-[#E0D2B4] hover:border-[#C5A059] rounded-lg px-2.5 py-1"
            >
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-pixel font-bold border whitespace-nowrap ${meta.cls}`}
              >
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 font-retro-jp text-xs text-[#3B2818] truncate">
                {it.text}
              </span>
              <span className="shrink-0 font-retro-jp text-[10px] text-[#8C7A65] whitespace-nowrap">
                {fmtTime(it.createdAt)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
