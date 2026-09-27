import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Megaphone, FileText, AlertCircle, ArrowRight } from 'lucide-react';
import { soundManager } from '../utils/audio';
import { submitToInbox } from '../utils/submissionInbox';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { useAppShellStore } from '../stores/appShellStore';
import { useAuthStore } from '../stores/authStore';
import { getAccessToken } from '../utils/cloudbaseToken';

/** 与后台 announcementSave 的字段契约保持一致（id/tag/title/author/time/link/description/image） */
export interface AnnouncementItem {
  id: string;
  tag: string;
  title: string;
  author: string;
  time?: string;
  link?: string;
  description?: string;
  image?: string;
}

/** 后台标签是自由文本，按内容语义归类；首页以调查兵团绿与主题紫为主。 */
function badgeStyle(tag: string) {
  if (/功能|更新|版本|新增|优化|企划|活动|祭|展|招募/.test(tag)) {
    return { bg: 'bg-[#563B68]', tone: 'purple', Icon: Megaphone } as const;
  }
  if (/维护|修复|服务器|站务|通知|公告|重要|调整/.test(tag)) {
    return { bg: 'bg-[#1E4334]', tone: 'green', Icon: AlertCircle } as const;
  }
  return { bg: 'bg-[#1E4334]', tone: 'green', Icon: FileText } as const;
}

const HANGE_TEA_LINES = [
  '很好喝的茶呢～',
  '细则读完啦？真乖。',
  '茶要凉了，快去逛展吧',
  '展品都很可爱的哦',
  '下次再来陪我喝茶呀',
];


interface Props {
  onNavigateTab: (tabId: string) => void;
  onPreloadTab?: (tabId: string) => void;
  onShowToast: (msg: string) => void;
}

export const HomeAnnouncementGrid: React.FC<Props> = React.memo(({
  onNavigateTab,
  onPreloadTab,
  onShowToast,
}) => {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [showDetailModal, setShowDetailModal] = useState<AnnouncementItem | null>(null);
  const [showProposal, setShowProposal] = useState(false);
  const [proposal, setProposal] = useState({ title: '', time: '', author: '', link: '', description: '' });
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalImage, setProposalImage] = useState<File | null>(null);
  const [proposalPreview, setProposalPreview] = useState('');
  const profile = useAuthStore((state) => state.profile);
  const submissionRequest = useAppShellStore((state) => state.submissionRequest);
  const clearSubmissionRequest = useAppShellStore((state) => state.clearSubmissionRequest);

  useEffect(() => {
    let cancelled = false;

    const load = (silent: boolean) => {
      if (!silent) setLoadingAnnouncements(true);
      fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ action: 'announcementList' }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('公告读取失败'))))
        .then((data: { items?: Array<Partial<AnnouncementItem>> }) => {
          if (cancelled) return;
          // 完全以管理台数据为准：后台为空则首页也为空，不回落到任何内置假数据
          const cloudItems: AnnouncementItem[] = (Array.isArray(data.items) ? data.items : [])
            .filter((item) => item && item.id && item.title)
            .map((item) => ({
              id: String(item.id),
              tag: String(item.tag || '公告').trim(),
              title: String(item.title || '').trim(),
              author: String(item.author || '').trim(),
              time: item.time ? String(item.time) : '',
              link: item.link ? String(item.link) : '',
              description: item.description ? String(item.description) : '',
              image: item.image ? String(item.image) : '',
            }));
          setAnnouncements(cloudItems);
        })
        .catch(() => {
          if (!cancelled && !silent) setAnnouncements([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingAnnouncements(false);
        });
    };

    // 首次加载 + 定时轮询（管理台改动后无需刷新页面即可同步）
    load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 120_000);

    // 切回页面时立即静默刷新，保证看到最新公告
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const openProposal = () => {
    soundManager.playWoodTap();
    if (!profile?.uid || !profile.nickname) {
      onShowToast('请先登录账号再投递');
      useAppShellStore.getState().openLogin();
      return;
    }
    setShowDetailModal(null);
    setProposal((current) => ({ ...current, author: profile.nickname }));
    setShowProposal(true);
  };

  useEffect(() => {
    if (submissionRequest !== 'announcement') return;
    openProposal();
    clearSubmissionRequest();
  }, [submissionRequest, clearSubmissionRequest]);

  const hangeLine = useMemo(
    () => HANGE_TEA_LINES[Math.floor(Math.random() * HANGE_TEA_LINES.length)],
    [showDetailModal]
  );

  const handleActionClick = (item: AnnouncementItem) => {
    soundManager.playScrollOpen();
    if (!item.link) return;
    // 站内 tab 深链（如 /?tab=resources）走前端切页，避免整页刷新
    const tabMatch = item.link.match(/[?&]tab=([a-zA-Z]+)/);
    if (tabMatch && !/^https?:\/\//i.test(item.link)) {
      onNavigateTab(tabMatch[1]);
      return;
    }
    if (/^https?:\/\//i.test(item.link)) window.open(item.link, '_blank', 'noopener,noreferrer');
    else window.location.assign(item.link);
  };

  const submitProposal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proposal.title.trim() || !proposal.author.trim() || !proposal.description.trim()) {
      return onShowToast('请填写企划标题、发布人和企划宣传文本');
    }
    setProposalBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('登录状态已失效，请重新登录');
      let image = '';
      if (proposalImage && proposalPreview) {
        const converted = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const maxSide = 1800;
              const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
              canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
              canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/webp', 0.86).split(',')[1] || '');
            } catch (error) {
              reject(error);
            }
          };
          img.onerror = reject;
          img.src = proposalPreview;
        });
        const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'announcementImageUpload', imageBase64: converted }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || '图片上传失败');
        image = result.url;
      }
      await submitToInbox('submitAnnouncement', { ...proposal, image, tag: '利韩企划' });
      if (proposalPreview) URL.revokeObjectURL(proposalPreview);
      setProposal({ title: '', time: '', author: '', link: '', description: '' });
      setProposalImage(null);
      setProposalPreview('');
      setShowProposal(false);
      onShowToast('企划已提交，管理员审核通过后会显示在公告栏 ✨');
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '企划提交失败');
    } finally {
      setProposalBusy(false);
    }
  };

  const handleCardHover = (item: AnnouncementItem) => {
    if (item.link) {
      const tabMatch = item.link.match(/[?&]tab=([a-zA-Z]+)/);
      if (tabMatch) {
        onPreloadTab?.(tabMatch[1]);
        return;
      }
    }
    const combined = (item.title + item.tag + (item.description || '')).toLowerCase();
    if (/茶会|接龙|安科|论坛|茶室/.test(combined)) {
      onPreloadTab?.('doujinshi');
    } else if (/小说|合订本|同人|粮仓|巨树餐厅|典藏|资源/.test(combined)) {
      onPreloadTab?.('resources');
    } else if (/联络|信使|投稿|反馈|群|飞鸽/.test(combined)) {
      onPreloadTab?.('dispatch');
    }
  };

  return (
    <div className="home-announcement-region w-full flex flex-col select-none my-auto">
      {/* ====================================================
          首页公告卡片：完全由管理台公告数据驱动（最多 3 条）
          外层设为容器查询上下文（container-type: inline-size），
          卡片用 cqw 取「宽度的 28.63%」当最小高度 —— 即底图 337/1177
          的原始比例，窄屏恰好等于自然高度、宽屏会被撑到接近原比例，
          避免底图在宽屏上被压扁。上限 204px 防止桌面端卡片过高。
         ==================================================== */}
      <div
        className="home-announcement-list w-full flex flex-col gap-2 sm:gap-2.5 max-w-md sm:max-w-2xl lg:max-w-3xl mx-auto no-scrollbar"
        style={{ containerType: 'inline-size' }}
      >
        {loadingAnnouncements && (
          <div className="py-5 text-center font-retro-jp text-[11px] text-[#9A8B77]">公告加载中…</div>
        )}

        {!loadingAnnouncements && announcements.length === 0 && (
          <div className="py-5 text-center">
            <p className="font-retro-jp text-[11px] text-[#9A8B77]">暂无公告 ✦</p>
          </div>
        )}

        {announcements.map((item) => {
          const { bg: badgeBg, tone, Icon: BadgeIcon } = badgeStyle(item.tag);

          return (
            <div
              key={item.id}
              onClick={() => {
                soundManager.playWoodTap();
                setShowDetailModal(item);
              }}
              onMouseEnter={() => handleCardHover(item)}
              onTouchStart={() => handleCardHover(item)}
              className={`announcement-board announcement-board--${tone} group relative hover:shadow-md transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 sm:gap-4 active:scale-[0.99]`}
            >
              {/* 左侧内容区：徽章 + 文本 + 日期 */}
              <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
                {/* 类别胶囊标 */}
                <div
                  className={`announcement-badge mt-0.5 ${badgeBg} text-white px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0`}
                >
                  <BadgeIcon size={14} className="shrink-0" />
                  <span className="whitespace-nowrap">{item.tag}</span>
                </div>

                {/* 标题、描述、发布人 */}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-serif-title text-[15px] sm:text-[17px] font-black text-[#253C31] leading-snug tracking-tight truncate group-hover:text-[#1E4334] transition-colors min-w-0 flex-1">
                      {item.title}
                    </h4>

                    {/* 日期：贴在公告栏右上角（取管理台「时间」字段，未填写则不显示） */}
                    {item.time && (
                      <time className="shrink-0 font-retro-jp text-xs text-[#8C7A65] leading-snug whitespace-nowrap pt-px">
                        {item.time}
                      </time>
                    )}
                  </div>

                  {/* 公告正文（管理台 description） */}
                  {item.description && (
                    <p className="font-serif-title text-xs sm:text-sm text-[#665343] mt-1.5 line-clamp-2 leading-normal">
                      {item.description}
                    </p>
                  )}

                  {/* 发布人（管理台 author） */}
                  {item.author && (
                    <div className="hidden sm:flex items-center gap-2 mt-1 text-xs text-[#7A6048] leading-none">
                      <span className="font-retro-jp text-[#8C7A65] truncate">· {item.author}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧进入/展开指示图标 (仅图标，移除文字按钮) */}
              <div
                className="announcement-arrow w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-105 shrink-0 ml-1"
                title="点击展开公告"
              >
                <ArrowRight size={17} strokeWidth={2.4} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ====================================================
          展品细则弹窗 (Detail Modal)
         ==================================================== */}
      {typeof document !== 'undefined' && showDetailModal && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setShowDetailModal(null);
          }}
        >
          <div
            className="relative w-full max-w-md text-[#1E4334] drop-shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                setShowDetailModal(null);
              }}
              className="absolute top-4 right-3 z-30 w-7 h-7 bg-[#1E4334] text-[#F4EADB] rounded-full flex items-center justify-center text-xs font-bold hover:bg-[#2C5C46] cursor-pointer shadow-xs"
              title="收起卷轴"
            >
              ✕
            </button>

            {/* 顶轴 */}
            <div className="rules-scroll-rod z-20 w-full" aria-hidden="true" />

            {/* 卷轴纸面 */}
            <div className="rules-scroll-paper relative z-10 mx-3 px-4 sm:px-5 pt-4 pb-5 max-h-[70dvh] overflow-y-auto">
              <div className="relative flex items-center justify-between border-b-2 border-[#C5A059] pb-2 mb-2.5 pr-8">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xl">✨</span>
                  <span className="font-serif-title font-bold text-sm sm:text-base text-[#1E4334] truncate">
                    {showDetailModal.title}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#1E4334] text-[#F9E79F] text-[10px] font-bold shrink-0 shadow-2xs">
                  {showDetailModal.tag}
                </span>
              </div>

              {/* 时间与发布人（管理台 time / author） */}
              {(showDetailModal.time || showDetailModal.author) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B5138] mb-3 bg-[#FAF3E3] p-2 rounded-lg border border-[#DECDB3]">
                  {showDetailModal.time && (
                    <div className="flex items-center gap-1">
                      <Calendar size={12} className="text-[#8C6226] shrink-0" />
                      <span>{showDetailModal.time}</span>
                    </div>
                  )}
                  {showDetailModal.author && (
                    <div className="flex items-center gap-1">
                      <span>✍️</span>
                      <span>{showDetailModal.author}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 封面图 */}
              {showDetailModal.image && (
                <img
                  src={showDetailModal.image}
                  alt=""
                  className="w-full aspect-video object-cover rounded-lg border border-[#D5C19A] mb-3 shadow-xs"
                />
              )}

              {/* 公告正文（管理台 description） */}
              {showDetailModal.description && (
                <p className="text-xs sm:text-sm text-[#4A4036] font-medium leading-relaxed whitespace-pre-wrap bg-[#FAF6ED] p-2.5 rounded-lg border border-[#E5DAC4]">
                  {showDetailModal.description}
                </p>
              )}

              {/* 底部彩蛋：韩吉端茶简笔画 + 台词气泡 */}
              <figure className="rules-scroll-hange relative mt-4 pt-3 border-t border-dashed border-[#C5A059] flex items-center justify-center gap-3 flex-wrap">
                <img
                  src="/images/rules-hange-tea.png"
                  alt="端着茶杯淡定喝茶的像素简笔画"
                  className="pixel-art w-20 sm:w-24 shrink-0 cursor-pointer transition-transform active:scale-90"
                  title="点我试试"
                  onClick={() => onShowToast('☕ 韩吉：细则都背下来了？展品可不会自己跑掉，快去逛展吧！')}
                />
                <div className="relative bg-[#FAF6ED] border-2 border-[#1E4334] rounded-xl px-3 py-1.5 font-retro-jp text-[11px] text-[#1E4334] leading-snug max-w-[9.5rem] shadow-xs">
                  {hangeLine}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -left-[7px] w-3 h-3 bg-[#FAF6ED] border-l-2 border-b-2 border-[#1E4334] rotate-45"
                    aria-hidden="true"
                  />
                </div>
                {showDetailModal.link && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playWoodTap();
                      const target = showDetailModal;
                      setShowDetailModal(null);
                      handleActionClick(target);
                    }}
                    className="px-4 py-1.5 bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#C5A059] rounded-lg font-bold text-xs hover:scale-102 active:scale-95 transition-all cursor-pointer shadow-md flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span>前往链接 ➜</span>
                  </button>
                )}
              </figure>
            </div>

            {/* 底轴 */}
            <div className="rules-scroll-rod rules-scroll-rod-bottom z-20 w-full" aria-hidden="true" />
          </div>
        </div>,
        document.body
      )}

      {/* ====================================================
          投递企划弹窗 (Proposal Submission Modal)
         ==================================================== */}
      {typeof document !== 'undefined' && showProposal && createPortal(
        <div
          className="fixed inset-0 z-[110] bg-black/55 flex items-center justify-center p-3 select-none"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              soundManager.playWoodTap();
              setShowProposal(false);
            }
          }}
        >
          <form
            onSubmit={submitProposal}
            className="relative overflow-hidden w-full max-w-lg rounded-2xl border-2 border-[#1E4334] bg-[#FBF7EC] p-4 sm:p-5 space-y-3 shadow-2xl"
          >
            <div className="relative flex justify-between items-start">
              <div>
                <h3 className="font-serif-title font-bold text-[#1E4334] text-base">
                  投递利韩企划 / 公告
                </h3>
                <p className="text-xs text-[#8C7A65] mt-0.5">
                  投递范围包括但不限于：only展、接力活动、庆生活动与同人发布等。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setShowProposal(false);
                }}
                className="w-6 h-6 rounded-full bg-[#1E4334] text-[#F4EADB] flex items-center justify-center text-xs font-bold hover:bg-[#2C5C46] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <label className="block text-xs font-bold text-[#1E4334]">
              标签
              <input
                value="利韩企划"
                disabled
                className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-[#EEE8D8] text-[#1E4334]"
              />
            </label>
            <label className="block text-xs font-bold text-[#1E4334]">
              标题 *
              <input
                value={proposal.title}
                onChange={(e) => setProposal({ ...proposal, title: e.target.value })}
                maxLength={100}
                className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-white text-[#16273B]"
                required
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-[#1E4334]">
                时间（选填）
                <input
                  type="date"
                  value={proposal.time}
                  onChange={(e) => setProposal({ ...proposal, time: e.target.value })}
                  className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-white text-[#16273B]"
                />
              </label>
              <label className="block text-xs font-bold text-[#1E4334]">
                发布人 *
                <input
                  value={profile?.nickname || proposal.author}
                  readOnly
                  className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-[#EEE8D8] text-[#16273B]"
                  required
                />
              </label>
            </div>
            <label className="block text-xs font-bold text-[#1E4334]">
              跳转链接（选填）
              <input
                type="url"
                value={proposal.link}
                onChange={(e) => setProposal({ ...proposal, link: e.target.value })}
                className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-white text-[#16273B]"
              />
            </label>
            <label className="block text-xs font-bold text-[#1E4334]">
              企划宣传文本 *
              <textarea
                value={proposal.description}
                onChange={(e) => setProposal({ ...proposal, description: e.target.value })}
                rows={3}
                maxLength={2000}
                className="mt-1 w-full p-2 border border-[#D5C19A] rounded-lg bg-white text-[#16273B]"
                required
              />
            </label>
            <div>
              <span className="block text-xs font-bold text-[#1E4334]">上传图片（选填）</span>
              <label className="mt-1 flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#B7791F] bg-[#FFF8E8] px-3 py-3 text-[#6B4515] transition-colors hover:bg-[#F8EBCB]">
                <span className="text-xl">🖼️</span>
                <span className="text-sm font-bold">{proposalImage ? proposalImage.name : '选择企划或公告图片'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (proposalPreview) URL.revokeObjectURL(proposalPreview);
                    setProposalImage(file);
                    setProposalPreview(file ? URL.createObjectURL(file) : '');
                  }}
                  className="sr-only"
                />
              </label>
              <p className="mt-1 text-[10px] text-[#8C7A68]">保留原图宽高比，提交时自动转换为 WebP。</p>
            </div>
            {proposalPreview && (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border-2 border-[#C5A059] bg-[#E8E0CB]">
                  <img
                    src={proposalPreview}
                    alt="企划图片预览"
                    className="block max-h-64 w-full object-contain"
                  />
                </div>
              </div>
            )}
            <button
              disabled={proposalBusy}
              className="w-full py-2.5 bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] rounded-xl font-bold disabled:opacity-50 transition-colors shadow-md cursor-pointer"
            >
              {proposalBusy ? '提交中…' : '提交'}
            </button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
});
