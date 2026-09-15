import React, { useState, useRef } from 'react';
import { soundManager } from '../utils/audio';
import { submitToInbox } from '../utils/submissionInbox';

interface Props {
  onShowToast: (msg: string) => void;
}

interface UploadedFileItem {
  id: string;
  name: string;
  size: number;
  file: File;
}

export const DispatchHub: React.FC<Props> = ({ onShowToast }) => {
  // Main Tab: 'feedback' (战术研讨) | 'share' (作品分享)
  const [mainTab, setMainTab] = useState<'feedback' | 'share'>('feedback');

  // Share Submodule: 'self' (投递自作) | 'recommend' (安利推荐) | 'translate' (汉化请求)
  const [shareSub, setShareSub] = useState<'self' | 'recommend' | 'translate'>('self');

  // Self-work Type: 'translate-release' (汉化发布) | 'novel' (同人小说) | 'art-comic' (同人插画短漫)
  const [workType, setWorkType] = useState<'translate-release' | 'novel' | 'art-comic'>('translate-release');

  // Loading animation overlay state for retro transition
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Custom Order Modal State
  const [isCustomModalOpen, setIsCustomModalOpen] = useState<boolean>(false);

  // Form States - Feedback
  const [feedbackCategory, setFeedbackCategory] = useState<string>('🎮 玩法手感');
  const [feedbackName, setFeedbackName] = useState<string>('');
  const [feedbackEmail, setFeedbackEmail] = useState<string>('');
  const [feedbackContent, setFeedbackContent] = useState<string>('');

  // Form States - Translate Release
  const [trBookName, setTrBookName] = useState<string>('');
  const [trSource, setTrSource] = useState<string>('web');
  const [trOriginalAuthor, setTrOriginalAuthor] = useState<string>('');
  const [trTranslator, setTrTranslator] = useState<string>('');
  const [trTypesetter, setTrTypesetter] = useState<string>('');
  const [trHomepage, setTrHomepage] = useState<string>('');
  const [trEmail, setTrEmail] = useState<string>('');
  const [trNotes, setTrNotes] = useState<string>('');
  const [trFiles, setTrFiles] = useState<UploadedFileItem[]>([]);

  // Form States - Novel
  const [nvTitle, setNvTitle] = useState<string>('');
  const [nvAuthor, setNvAuthor] = useState<string>('');
  const [nvHomepage, setNvHomepage] = useState<string>('');
  const [nvEmail, setNvEmail] = useState<string>('');
  const [nvNotes, setNvNotes] = useState<string>('');
  const [nvBody, setNvBody] = useState<string>('');
  const [isSubmittingNovel, setIsSubmittingNovel] = useState(false);
  const [nvFiles, setNvFiles] = useState<UploadedFileItem[]>([]);

  // Form States - Art Comic
  const [artTitle, setArtTitle] = useState<string>('');
  const [artAuthor, setArtAuthor] = useState<string>('');
  const [artHomepage, setArtHomepage] = useState<string>('');
  const [artEmail, setArtEmail] = useState<string>('');
  const [artNotes, setArtNotes] = useState<string>('');
  const [artFiles, setArtFiles] = useState<UploadedFileItem[]>([]);

  // Form States - Recommend
  const [recTitle, setRecTitle] = useState<string>('');
  const [recLink, setRecLink] = useState<string>('');
  const [recReason, setRecReason] = useState<string>('');

  // Form States - Translate Request
  const [transTitle, setTransTitle] = useState<string>('');
  const [transSource, setTransSource] = useState<string>('');
  const [transReason, setTransReason] = useState<string>('');

  // Form States - Custom Order
  const [coName, setCoName] = useState<string>('');
  const [coContact, setCoContact] = useState<string>('');
  const [coDesc, setCoDesc] = useState<string>('');

  // Drag-over states
  const [isTrDragOver, setIsTrDragOver] = useState(false);
  const [isNvDragOver, setIsNvDragOver] = useState(false);
  const [isArtDragOver, setIsArtDragOver] = useState(false);

  const fileInputRefTr = useRef<HTMLInputElement | null>(null);
  const fileInputRefNv = useRef<HTMLInputElement | null>(null);
  const fileInputRefArt = useRef<HTMLInputElement | null>(null);

  // Helper for retro transition
  const triggerTransition = (callback: () => void) => {
    soundManager.playBlip();
    setIsLoading(true);
    setTimeout(() => {
      callback();
      setTimeout(() => {
        setIsLoading(false);
      }, 60);
    }, 120);
  };

  const copyToClipboard = async (text: string) => {
    soundManager.playCoin();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      }
    } catch {
      return false;
    }
  };

  const isValidEmail = (email: string) => {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  };

  const handleAddFiles = (
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<UploadedFileItem[]>>
  ) => {
    if (!files || files.length === 0) return;
    soundManager.playBlip();
    const newItems: UploadedFileItem[] = Array.from(files).map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      file: f,
    }));
    setter((prev) => [...prev, ...newItems]);
    onShowToast(`已添加 ${newItems.length} 个本地文件 📁`);
  };

  // 1. 呈递战术研讨
  const handleSubmitFeedback = async () => {
    if (feedbackEmail && !isValidEmail(feedbackEmail)) {
      onShowToast('请填写有效的邮箱地址 ⚠️');
      return;
    }
    if (!feedbackContent.trim()) {
      onShowToast('请填写战术研讨详情 ⚠️');
      return;
    }

    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const reportText = [
      `【利韩土豆仓 · 战术研讨呈递函】`,
      `类别: ${feedbackCategory}`,
      `发件士兵: ${feedbackName.trim() || '匿名调查兵'}`,
      `联络邮箱: ${feedbackEmail.trim() || '未预留'}`,
      `提交时间: ${dateStr}`,
      `----------------------------------------`,
      `详细内容:\n${feedbackContent.trim()}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(reportText);
    if (copied) {
      onShowToast('调查报告已生成并复制到剪贴板！📋');
    } else {
      onShowToast('已记录报告！请手动保存内容 💾');
    }
    setFeedbackContent('');
  };

  // 2. 呈递汉化发布
  const handleSubmitTranslateRelease = async () => {
    if (!trBookName.trim()) {
      onShowToast('请填写本子名 ⚠️');
      return;
    }
    if (!trEmail.trim() || !isValidEmail(trEmail.trim())) {
      onShowToast('请填写有效的邮箱联系方式 ⚠️');
      return;
    }

    const fileNames = trFiles.map((f) => f.name).join(', ');
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const letterText = [
      `【利韩土豆仓 · 自作汉化发布呈递函】`,
      `本子名: ${trBookName.trim()}`,
      `来源: ${trSource || 'web'}`,
      `原作者: ${trOriginalAuthor.trim() || '未填写'}`,
      `汉化: ${trTranslator.trim() || '未填写'}`,
      `嵌字: ${trTypesetter.trim() || '未填写'}`,
      `主页链接: ${trHomepage.trim() || '未提供'}`,
      `邮箱联系方式: ${trEmail.trim()}`,
      `上传附件: ${fileNames || '未附加本地文件'}`,
      `备注: ${trNotes.trim() || '无'}`,
      `呈递时间: ${dateStr}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(letterText);
    if (copied) {
      onShowToast('自作发布函已生成并复制到剪贴板！📤');
    } else {
      onShowToast('自作发布函已生成！💾');
    }
  };

  // 3. 呈递小说
  const handleSubmitNovel = async () => {
    if (!nvTitle.trim() || !nvAuthor.trim()) {
      onShowToast('请填写小说标题和作者 ⚠️');
      return;
    }
    if (!nvEmail.trim() || !isValidEmail(nvEmail.trim())) {
      onShowToast('请填写有效的邮箱联系方式 ⚠️');
      return;
    }
    let body = nvBody.trim();
    if (nvFiles.length) {
      if (nvFiles.length !== 1 || !/\.(txt|md)$/i.test(nvFiles[0].name) || nvFiles[0].size > 1024 * 1024) {
        onShowToast('第一期仅支持一份 1MB 以内的 .txt 或 .md 小说稿件 ⚠️');
        return;
      }
      try { body = (await nvFiles[0].file.text()).trim(); } catch {
        onShowToast('无法读取小说文件，请换成 UTF-8 编码的纯文本 ⚠️');
        return;
      }
    }
    if (!body || body.length > 500000) {
      onShowToast('请填写正文，且不超过 50 万字 ⚠️');
      return;
    }
    setIsSubmittingNovel(true);
    try {
      await submitToInbox('submitNovel', {
        title: nvTitle.trim(), author: nvAuthor.trim(), email: nvEmail.trim(),
        authorUrl: nvHomepage.trim(), notes: nvNotes.trim(), body,
      });
      onShowToast('小说稿件已进入云端待审收件箱，审核通过后才会显示在主站 📮');
      setNvBody('');
      setNvFiles([]);
    } catch (error) {
      onShowToast((error as Error).message);
    } finally {
      setIsSubmittingNovel(false);
    }
  };

  // 4. 呈递插画/短漫
  const handleSubmitArtComic = async () => {
    if (!artTitle.trim()) {
      onShowToast('请填写作品名 ⚠️');
      return;
    }
    if (!artEmail.trim() || !isValidEmail(artEmail.trim())) {
      onShowToast('请填写有效的邮箱联系方式 ⚠️');
      return;
    }

    const fileNames = artFiles.map((f) => f.name).join(', ');
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const letterText = [
      `【利韩土豆仓 · 同人插画/短漫呈递函】`,
      `作品名: ${artTitle.trim()}`,
      `创作者: ${artAuthor.trim() || '未署名'}`,
      `主页链接: ${artHomepage.trim() || '未提供'}`,
      `邮箱联系方式: ${artEmail.trim()}`,
      `上传附件: ${fileNames || '未附加本地文件'}`,
      `备注: ${artNotes.trim() || '无'}`,
      `呈递时间: ${dateStr}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(letterText);
    if (copied) {
      onShowToast('插画/短漫函已生成并复制到剪贴板！🎨');
    } else {
      onShowToast('插画/短漫函已生成！💾');
    }
  };

  // 5. 呈递安利推荐
  const handleSubmitRecommend = async () => {
    if (!recTitle.trim()) {
      onShowToast('请填写推荐作品名称 / 原作者 ⚠️');
      return;
    }
    if (!recReason.trim()) {
      onShowToast('请填写简要推荐理由 ⚠️');
      return;
    }

    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const recText = [
      `【利韩土豆仓 · 作品安利推荐函】`,
      `推荐作品: ${recTitle.trim()}`,
      `出处链接: ${recLink.trim() || '未附链接'}`,
      `推荐理由: ${recReason.trim()}`,
      `推荐时间: ${dateStr}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(recText);
    if (copied) {
      onShowToast('安利推荐已生成并复制到剪贴板！✨');
    } else {
      onShowToast('已记录安利推荐！💾');
    }
    setRecTitle('');
    setRecLink('');
    setRecReason('');
  };

  // 6. 呈递汉化请求
  const handleSubmitTranslate = async () => {
    if (!transTitle.trim()) {
      onShowToast('请填写待汉化作品原名 / 原作者 ⚠️');
      return;
    }
    if (!transSource.trim()) {
      onShowToast('请提供原作图源 / 生肉地址 ⚠️');
      return;
    }
    if (!transReason.trim()) {
      onShowToast('请说明求汉化理由 ⚠️');
      return;
    }

    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const transText = [
      `【利韩土豆仓 · 汉化心愿请求函】`,
      `作品原名/作者: ${transTitle.trim()}`,
      `生肉出处/链接: ${transSource.trim()}`,
      `求汉化理由与类型: ${transReason.trim()}`,
      `呈递时间: ${dateStr}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(transText);
    if (copied) {
      onShowToast('汉化心愿已生成并复制到剪贴板！📜');
    } else {
      onShowToast('已记录汉化心愿！💾');
    }
    setTransTitle('');
    setTransSource('');
    setTransReason('');
  };

  // 7. 提交商业定制
  const handleSubmitCustomOrder = async () => {
    if (!coContact.trim() || !isValidEmail(coContact.trim())) {
      onShowToast('请填写有效的邮箱联系方式 ⚠️');
      return;
    }
    if (!coDesc.trim()) {
      onShowToast('请简要描述需求与期望周期 ⚠️');
      return;
    }

    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const orderText = [
      `【商业定制沟通 · 需求函】`,
      `委托人: ${coName.trim() || '某同好委托人'}`,
      `邮箱: ${coContact.trim()}`,
      `提交时间: ${dateStr}`,
      `----------------------------------------`,
      `需求与周期构想:\n${coDesc.trim()}`,
      `----------------------------------------`,
    ].join('\n');

    const copied = await copyToClipboard(orderText);
    if (copied) {
      onShowToast('定制需求已生成并复制到剪贴板！📋');
    } else {
      onShowToast('已保存定制需求！💾');
    }
    setTimeout(() => {
      setIsCustomModalOpen(false);
      setCoDesc('');
    }, 1000);
  };

  return (
    <div className="w-full max-w-[680px] mx-auto select-none space-y-4 font-retro-jp text-[#203429]">
      {/* 羊皮信封主体 - 仅保留一个统一边框 */}
      <div className="relative bg-gradient-to-b from-[#FAF4E5] via-[#F5ECDB] to-[#EFE1C9] p-3 sm:p-5 overflow-hidden border-2 border-[#8C6C47] shadow-[2px_2px_0px_#261307]">
        {/* 复古像素风加载遮罩 */}
        {isLoading && (
          <div className="absolute inset-0 bg-[#F6EED9]/92 z-50 flex flex-col items-center justify-center gap-2 backdrop-blur-xs">
            <svg className="w-10 h-10 animate-spin" viewBox="0 0 24 24" fill="none">
              <rect x="10.5" y="1" width="3" height="3" fill="#1E4334" />
              <rect x="17" y="3.5" width="3" height="3" fill="#285A46" />
              <rect x="20" y="10.5" width="3" height="3" fill="#3D7B62" />
              <rect x="17" y="17.5" width="3" height="3" fill="#5F977E" />
              <rect x="10.5" y="20" width="3" height="3" fill="#B3A277" />
              <rect x="4" y="17.5" width="3" height="3" fill="#D9C79A" />
              <rect x="1" y="10.5" width="3" height="3" fill="#F9E79F" />
              <rect x="4" y="3.5" width="3" height="3" fill="#FFF5CC" />
            </svg>
            <span className="font-pixel text-[10px] text-[#1E4334] font-bold tracking-widest animate-pulse">
              LOADING...
            </span>
          </div>
        )}

        {/* 信封顶部封盖折痕盖条 */}
        <div className="relative z-10 -mx-1 -mt-1 sm:-mx-2 sm:-mt-2 mb-3 px-3 py-2 bg-gradient-to-b from-[#EFE2C6] to-[#E6D4B2] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 火漆印章 */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#A8321E] via-[#8B2515] to-[#541408] flex items-center justify-center">
              <span className="text-xs">🥔</span>
            </div>
            <span className="font-pixel text-[10px] text-[#463426] font-bold tracking-wider">
              WALL ROSE · 联络
            </span>
          </div>
          <div className="px-1.5 py-0.5 bg-white/40 font-pixel text-[9px] text-[#5C4A3A]">
            NO. 104-LH
          </div>
        </div>

        {/* 导航选项卡 Tabs: 战术研讨 / 作品分享 */}
        <div className="grid grid-cols-2 gap-2 mb-3 relative z-10">
          <button
            type="button"
            onClick={() => triggerTransition(() => setMainTab('feedback'))}
            className={`w-full py-2 px-3 text-xs sm:text-sm font-bold  cursor-pointer flex items-center justify-center gap-1.5 transition-all shadow-[1px_1px_0px_#261307] ${
              mainTab === 'feedback'
                ? 'bg-[#1E4334] text-[#F9E79F] '
                : 'bg-[#F8F1DE] text-[#5C4A3A]  hover:bg-[#F1E5CB]'
            }`}
          >
            <span>🕊️</span>
            <span>战术研讨</span>
          </button>
          <button
            type="button"
            onClick={() => triggerTransition(() => setMainTab('share'))}
            className={`w-full py-2 px-3 text-xs sm:text-sm font-bold  cursor-pointer flex items-center justify-center gap-1.5 transition-all shadow-[1px_1px_0px_#261307] ${
              mainTab === 'share'
                ? 'bg-[#1E4334] text-[#F9E79F] '
                : 'bg-[#F8F1DE] text-[#5C4A3A]  hover:bg-[#F1E5CB]'
            }`}
          >
            <span>📖</span>
            <span>作品分享</span>
          </button>
        </div>

        {/* ======================= MODULE 1: 战术研讨 ======================= */}
        {mainTab === 'feedback' && (
          <section className="bg-[#FAF4E4] p-3 sm:p-4 relative z-10 space-y-3">
            <div className=" -transparent pb-2">
              <h2 className="font-pixel text-xs sm:text-sm text-[#1E4334] font-bold flex items-center gap-1.5">
                <span>🕊️</span>
                <span>调查兵团 · 战术研讨与战场反馈</span>
              </h2>
              <p className="text-[11px] text-[#5C4A3A] mt-1 leading-relaxed">
                为利韩土豆仓的同好体验与互动小游戏进言献策。无论玩法手感、彩蛋创意还是排查异常，随时倾听。
              </p>
            </div>

            {/* 类别 Chips */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#203429] block">类别</label>
              <div className="flex flex-wrap gap-1.5">
                {['🎮 玩法手感', '💡 新功能与彩蛋', '🐛 异常排查', '📦 素材提供', '🤝 网站助手', '💬 随便聊聊'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      soundManager.playBlip();
                      setFeedbackCategory(cat);
                    }}
                    className={`px-2.5 py-1 text-xs  rounded-none cursor-pointer transition-all shadow-[1px_1px_0px_#261307] ${
                      feedbackCategory === cat
                        ? 'bg-[#1E4334] text-[#F9E79F]  font-bold'
                        : 'bg-[#F8F1DE] text-[#5C4A3A]  hover:bg-[#F1E5CB]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 士兵代号 / 称呼 */}
            <div className="space-y-1">
              <label htmlFor="fb-name" className="text-xs font-bold text-[#203429] block">
                士兵代号 / 称呼
              </label>
              <input
                id="fb-name"
                type="text"
                value={feedbackName}
                onChange={(e) => setFeedbackName(e.target.value)}
                maxLength={30}
                placeholder="例如：特务班同好"
                className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs text-[#203429] outline-hidden"
              />
            </div>

            {/* 联络邮箱 */}
            <div className="space-y-1">
              <label htmlFor="fb-email" className="text-xs font-bold text-[#203429] block">
                联络邮箱
              </label>
              <input
                id="fb-email"
                type="email"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                maxLength={80}
                placeholder="用于接收调查兵团回函 (可选)"
                className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs text-[#203429] outline-hidden"
              />
            </div>

            {/* 战术研讨详情 */}
            <div className="space-y-1">
              <label htmlFor="fb-content" className="text-xs font-bold text-[#203429] block">
                战术研讨详情
              </label>
              <textarea
                id="fb-content"
                value={feedbackContent}
                onChange={(e) => setFeedbackContent(e.target.value)}
                placeholder="请详细描述您的建议、遇到的问题、或者想分享的同好感想..."
                rows={4}
                className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs text-[#203429] outline-hidden resize-y"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmitFeedback}
              className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
            >
              <span>✉️</span>
              <span>呈递调查报告</span>
            </button>
          </section>
        )}

        {/* ======================= MODULE 2: 作品分享 ======================= */}
        {mainTab === 'share' && (
          <section className="bg-[#FAF4E4] p-3 sm:p-4 relative z-10 space-y-3">
            {/* 3 个子模块切换药丸 */}
            <div className="flex flex-wrap gap-1.5 p-1.5 bg-[#F3E9D2] ">
              <button
                type="button"
                onClick={() => triggerTransition(() => setShareSub('self'))}
                className={`flex-1 min-w-[90px] py-1.5 px-2 text-xs font-bold cursor-pointer transition-all ${
                  shareSub === 'self'
                    ? 'bg-[#1E4334] text-[#F9E79F] shadow-xs'
                    : 'bg-transparent text-[#5C4A3A] hover:bg-[#E7DBC1]'
                }`}
              >
                <span>📤 投递自作</span>
              </button>
              <button
                type="button"
                onClick={() => triggerTransition(() => setShareSub('recommend'))}
                className={`flex-1 min-w-[90px] py-1.5 px-2 text-xs font-bold cursor-pointer transition-all ${
                  shareSub === 'recommend'
                    ? 'bg-[#1E4334] text-[#F9E79F] shadow-xs'
                    : 'bg-transparent text-[#5C4A3A] hover:bg-[#E7DBC1]'
                }`}
              >
                <span>✨ 安利推荐</span>
              </button>
              <button
                type="button"
                onClick={() => triggerTransition(() => setShareSub('translate'))}
                className={`flex-1 min-w-[90px] py-1.5 px-2 text-xs font-bold cursor-pointer transition-all ${
                  shareSub === 'translate'
                    ? 'bg-[#1E4334] text-[#F9E79F] shadow-xs'
                    : 'bg-transparent text-[#5C4A3A] hover:bg-[#E7DBC1]'
                }`}
              >
                <span>📜 汉化请求</span>
              </button>
            </div>

            {/* 子模块 1: 投递自作 */}
            {shareSub === 'self' && (
              <div className="space-y-3">
                {/* 作品形式选择: 汉化发布 / 同人小说 / 同人插画短漫 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#203429] block">作品形式</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'translate-release', label: '📚 汉化发布' },
                      { id: 'novel', label: '✍️ 同人小说' },
                      { id: 'art-comic', label: '🎨 同人插画/短漫' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          triggerTransition(() =>
                            setWorkType(item.id as 'translate-release' | 'novel' | 'art-comic')
                          )
                        }
                        className={`px-2.5 py-1 text-xs  cursor-pointer transition-all shadow-[1px_1px_0px_#261307] ${
                          workType === item.id
                            ? 'bg-[#1E4334] text-[#F9E79F]  font-bold'
                            : 'bg-[#F8F1DE] text-[#5C4A3A]  hover:bg-[#F1E5CB]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 形式 A: 汉化发布 */}
                {workType === 'translate-release' && (
                  <div className="space-y-2.5 pt-1">
                    <div className="space-y-1">
                      <label htmlFor="tr-book-name" className="text-xs font-bold text-[#203429] block">
                        本子名 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="tr-book-name"
                        type="text"
                        value={trBookName}
                        onChange={(e) => setTrBookName(e.target.value)}
                        maxLength={60}
                        placeholder="例如：日落之前 / Twilight Rendezvous"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor="tr-source" className="text-xs font-bold text-[#203429] block">
                          来源
                        </label>
                        <select
                          id="tr-source"
                          value={trSource}
                          onChange={(e) => setTrSource(e.target.value)}
                          className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2 py-1.5 text-xs outline-hidden"
                        >
                          <option value="web">web</option>
                          <option value="自扫实体本">自扫实体本</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="tr-author" className="text-xs font-bold text-[#203429] block">
                          原作者
                        </label>
                        <input
                          id="tr-author"
                          type="text"
                          value={trOriginalAuthor}
                          onChange={(e) => setTrOriginalAuthor(e.target.value)}
                          maxLength={40}
                          placeholder="原作者名 / Pixiv ID"
                          className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor="tr-trans" className="text-xs font-bold text-[#203429] block">
                          汉化
                        </label>
                        <input
                          id="tr-trans"
                          type="text"
                          value={trTranslator}
                          onChange={(e) => setTrTranslator(e.target.value)}
                          maxLength={40}
                          placeholder="译者昵称"
                          className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="tr-typeset" className="text-xs font-bold text-[#203429] block">
                          嵌字
                        </label>
                        <input
                          id="tr-typeset"
                          type="text"
                          value={trTypesetter}
                          onChange={(e) => setTrTypesetter(e.target.value)}
                          maxLength={40}
                          placeholder="嵌字/修图者昵称"
                          className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="tr-hp" className="text-xs font-bold text-[#203429] block">
                        主页链接
                      </label>
                      <input
                        id="tr-hp"
                        type="text"
                        value={trHomepage}
                        onChange={(e) => setTrHomepage(e.target.value)}
                        maxLength={150}
                        placeholder="微博 / LOFTER / Pixiv 主页链接"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="tr-email-input" className="text-xs font-bold text-[#203429] block">
                        邮箱联系方式 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="tr-email-input"
                        type="email"
                        value={trEmail}
                        onChange={(e) => setTrEmail(e.target.value)}
                        maxLength={80}
                        placeholder="用于审核回函与致谢"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    {/* 上传口 */}
                    <div className="space-y-1.5">
                      <div
                        onClick={() => fileInputRefTr.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsTrDragOver(true);
                        }}
                        onDragLeave={() => setIsTrDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsTrDragOver(false);
                          handleAddFiles(e.dataTransfer.files, setTrFiles);
                        }}
                        className={` p-3 text-center cursor-pointer transition-colors ${
                          isTrDragOver
                            ? 'bg-[#E8F5E9] -[#1E4334]'
                            : 'bg-[#F8F1DE]  hover:bg-[#F1E5CB]'
                        }`}
                      >
                        <input
                          ref={fileInputRefTr}
                          type="file"
                          multiple
                          onChange={(e) => handleAddFiles(e.target.files, setTrFiles)}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xl">📦</span>
                          <span className="text-xs font-bold text-[#203429]">
                            点击选择文件 或 拖拽至此处
                          </span>
                          <span className="text-[10px] text-[#5C4A3A]">
                            支持压缩包、图源包、PDF、文本文档
                          </span>
                        </div>
                      </div>

                      {/* 选定文件列表 */}
                      {trFiles.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {trFiles.map((file, idx) => (
                            <div
                              key={file.id}
                              className="bg-white   px-2 py-1 text-xs flex items-center justify-between"
                            >
                              <span className="truncate max-w-[80%]">
                                📄 {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setTrFiles((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-[#A8321E] font-bold text-xs hover:underline cursor-pointer"
                              >
                                ✕ 移除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="tr-notes" className="text-xs font-bold text-[#203429] block">
                        备注
                      </label>
                      <textarea
                        id="tr-notes"
                        value={trNotes}
                        onChange={(e) => setTrNotes(e.target.value)}
                        placeholder="授权说明、解压密码或收录注意事项..."
                        rows={2}
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitTranslateRelease}
                      className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>📤</span>
                      <span>呈递自作</span>
                    </button>
                  </div>
                )}

                {/* 形式 B: 同人小说 */}
                {workType === 'novel' && (
                  <div className="space-y-2.5 pt-1">
                    <div className="space-y-1">
                      <label htmlFor="nv-title" className="text-xs font-bold text-[#203429] block">
                        作品名称 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="nv-title"
                        type="text"
                        value={nvTitle}
                        onChange={(e) => setNvTitle(e.target.value)}
                        maxLength={60}
                        placeholder="例如：墙内星光 / 小说篇名"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="nv-author" className="text-xs font-bold text-[#203429] block">
                        创作者
                      </label>
                      <input
                        id="nv-author"
                        type="text"
                        value={nvAuthor}
                        onChange={(e) => setNvAuthor(e.target.value)}
                        maxLength={40}
                        placeholder="创作者笔名"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="nv-hp" className="text-xs font-bold text-[#203429] block">
                        主页链接
                      </label>
                      <input
                        id="nv-hp"
                        type="text"
                        value={nvHomepage}
                        onChange={(e) => setNvHomepage(e.target.value)}
                        maxLength={150}
                        placeholder="LOFTER / AO3 / 微博 主页链接"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="nv-email-input" className="text-xs font-bold text-[#203429] block">
                        邮箱联系方式 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="nv-email-input"
                        type="email"
                        value={nvEmail}
                        onChange={(e) => setNvEmail(e.target.value)}
                        maxLength={80}
                        placeholder="用于接收收录通知"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    {/* 上传口 */}
                    <div className="space-y-1.5">
                      <div
                        onClick={() => fileInputRefNv.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsNvDragOver(true);
                        }}
                        onDragLeave={() => setIsNvDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsNvDragOver(false);
                          handleAddFiles(e.dataTransfer.files, setNvFiles);
                        }}
                        className={` p-3 text-center cursor-pointer transition-colors ${
                          isNvDragOver
                            ? 'bg-[#E8F5E9] -[#1E4334]'
                            : 'bg-[#F8F1DE]  hover:bg-[#F1E5CB]'
                        }`}
                      >
                        <input
                          ref={fileInputRefNv}
                          type="file"
                          accept=".txt,.md,text/plain,text/markdown"
                          onChange={(e) => handleAddFiles(e.target.files, setNvFiles)}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xl">📖</span>
                          <span className="text-xs font-bold text-[#203429]">
                            点击选择文件 或 拖拽至此处
                          </span>
                          <span className="text-[10px] text-[#5C4A3A]">
                            第一期支持单份 .txt / .md（1MB 内），也可直接粘贴正文
                          </span>
                        </div>
                      </div>

                      {nvFiles.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {nvFiles.map((file, idx) => (
                            <div
                              key={file.id}
                              className="bg-white   px-2 py-1 text-xs flex items-center justify-between"
                            >
                              <span className="truncate max-w-[80%]">
                                📄 {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNvFiles((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-[#A8321E] font-bold text-xs hover:underline cursor-pointer"
                              >
                                ✕ 移除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="nv-body" className="text-xs font-bold text-[#203429] block">小说正文 <span className="text-[#A8321E]">*</span></label>
                      <textarea id="nv-body" value={nvBody} onChange={(e) => setNvBody(e.target.value)} rows={8}
                        placeholder="可直接粘贴正文；如选了 .txt / .md 文件，以文件内容为准"
                        className="w-full bg-[#F8F1DE] p-2 text-xs outline-hidden resize-y" />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="nv-notes" className="text-xs font-bold text-[#203429] block">
                        备注
                      </label>
                      <textarea
                        id="nv-notes"
                        value={nvNotes}
                        onChange={(e) => setNvNotes(e.target.value)}
                        placeholder="篇幅分卷、阅读警告或寄语..."
                        rows={2}
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitNovel}
                      disabled={isSubmittingNovel}
                      className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>✍️</span>
                      <span>呈递小说作品</span>
                    </button>
                  </div>
                )}

                {/* 形式 C: 同人插画/短漫 */}
                {workType === 'art-comic' && (
                  <div className="space-y-2.5 pt-1">
                    <div className="space-y-1">
                      <label htmlFor="art-title" className="text-xs font-bold text-[#203429] block">
                        作品名 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="art-title"
                        type="text"
                        value={artTitle}
                        onChange={(e) => setArtTitle(e.target.value)}
                        maxLength={60}
                        placeholder="例如：调查兵团日常绘卷"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="art-author" className="text-xs font-bold text-[#203429] block">
                        创作者
                      </label>
                      <input
                        id="art-author"
                        type="text"
                        value={artAuthor}
                        onChange={(e) => setArtAuthor(e.target.value)}
                        maxLength={40}
                        placeholder="画师昵称 / ID"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="art-hp" className="text-xs font-bold text-[#203429] block">
                        主页链接
                      </label>
                      <input
                        id="art-hp"
                        type="text"
                        value={artHomepage}
                        onChange={(e) => setArtHomepage(e.target.value)}
                        maxLength={150}
                        placeholder="Pixiv / 微博 / Twitter 主页链接"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="art-email-input" className="text-xs font-bold text-[#203429] block">
                        邮箱联系方式 <span className="text-[#A8321E]">*</span>
                      </label>
                      <input
                        id="art-email-input"
                        type="email"
                        value={artEmail}
                        onChange={(e) => setArtEmail(e.target.value)}
                        maxLength={80}
                        placeholder="用于接收收录通知"
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                      />
                    </div>

                    {/* 上传口 */}
                    <div className="space-y-1.5">
                      <div
                        onClick={() => fileInputRefArt.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsArtDragOver(true);
                        }}
                        onDragLeave={() => setIsArtDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsArtDragOver(false);
                          handleAddFiles(e.dataTransfer.files, setArtFiles);
                        }}
                        className={` p-3 text-center cursor-pointer transition-colors ${
                          isArtDragOver
                            ? 'bg-[#E8F5E9] -[#1E4334]'
                            : 'bg-[#F8F1DE]  hover:bg-[#F1E5CB]'
                        }`}
                      >
                        <input
                          ref={fileInputRefArt}
                          type="file"
                          multiple
                          onChange={(e) => handleAddFiles(e.target.files, setArtFiles)}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xl">🎨</span>
                          <span className="text-xs font-bold text-[#203429]">
                            点击选择文件 或 拖拽至此处
                          </span>
                          <span className="text-[10px] text-[#5C4A3A]">
                            支持 JPG / PNG / GIF / PSD / 压缩包
                          </span>
                        </div>
                      </div>

                      {artFiles.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {artFiles.map((file, idx) => (
                            <div
                              key={file.id}
                              className="bg-white   px-2 py-1 text-xs flex items-center justify-between"
                            >
                              <span className="truncate max-w-[80%]">
                                📄 {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setArtFiles((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-[#A8321E] font-bold text-xs hover:underline cursor-pointer"
                              >
                                ✕ 移除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="art-notes" className="text-xs font-bold text-[#203429] block">
                        备注
                      </label>
                      <textarea
                        id="art-notes"
                        value={artNotes}
                        onChange={(e) => setArtNotes(e.target.value)}
                        placeholder="画集简介或展示要求..."
                        rows={2}
                        className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitArtComic}
                      className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>🎨</span>
                      <span>呈递插画/短漫</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 子模块 2: 安利推荐 */}
            {shareSub === 'recommend' && (
              <div className="space-y-2.5 pt-1">
                <div className="space-y-1">
                  <label htmlFor="rec-title" className="text-xs font-bold text-[#203429] block">
                    推荐作品名称 / 原作者 <span className="text-[#A8321E]">*</span>
                  </label>
                  <input
                    id="rec-title"
                    type="text"
                    value={recTitle}
                    onChange={(e) => setRecTitle(e.target.value)}
                    maxLength={60}
                    placeholder="例如：某知名太太神级名篇"
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="rec-link" className="text-xs font-bold text-[#203429] block">
                    作品出处或阅读链接
                  </label>
                  <input
                    id="rec-link"
                    type="text"
                    value={recLink}
                    onChange={(e) => setRecLink(e.target.value)}
                    maxLength={150}
                    placeholder="Pixiv / 微博 / AO3 对应作品链接"
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="rec-reason" className="text-xs font-bold text-[#203429] block">
                    简要推荐理由 <span className="text-[#A8321E]">*</span>
                  </label>
                  <textarea
                    id="rec-reason"
                    value={recReason}
                    onChange={(e) => setRecReason(e.target.value)}
                    placeholder="说说为什么推荐这部作品、核心萌点或阅读感受..."
                    rows={3}
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSubmitRecommend}
                  className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                >
                  <span>✨</span>
                  <span>提交安利推荐</span>
                </button>
              </div>
            )}

            {/* 子模块 3: 请求汉化组汉化 */}
            {shareSub === 'translate' && (
              <div className="space-y-2.5 pt-1">
                <div className="space-y-1">
                  <label htmlFor="trans-title" className="text-xs font-bold text-[#203429] block">
                    待汉化作品原名 / 原作者 <span className="text-[#A8321E]">*</span>
                  </label>
                  <input
                    id="trans-title"
                    type="text"
                    value={transTitle}
                    onChange={(e) => setTransTitle(e.target.value)}
                    maxLength={80}
                    placeholder="原作日文名 / 作者名 / 展会场贩志"
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="trans-source" className="text-xs font-bold text-[#203429] block">
                    原作图源 / 生肉地址 / 出处 <span className="text-[#A8321E]">*</span>
                  </label>
                  <input
                    id="trans-source"
                    type="text"
                    value={transSource}
                    onChange={(e) => setTransSource(e.target.value)}
                    maxLength={150}
                    placeholder="Pixiv系列 / 虎穴 / 自备扫描件网盘链接"
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2.5 py-1.5 text-xs outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="trans-reason" className="text-xs font-bold text-[#203429] block">
                    求汉化理由与作品类型 <span className="text-[#A8321E]">*</span>
                  </label>
                  <textarea
                    id="trans-reason"
                    value={transReason}
                    onChange={(e) => setTransReason(e.target.value)}
                    placeholder="说明为什么渴望看到该作品的精修汉化、本子类型及页数..."
                    rows={3}
                    className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSubmitTranslate}
                  className="w-full py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                >
                  <span>📜</span>
                  <span>呈递汉化心愿函</span>
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* 信封下方低调定制客单小广告 */}
      <div className="w-full flex justify-center">
        <div className="inline-flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 bg-[#FAF4E4]/90 text-xs text-[#5C4A3A] shadow-[1px_1px_0px_#261307] border border-[#8C6C47]/40">
          <span className="w-1.5 h-1.5 bg-[#1E4334] shrink-0" />
          <span className="text-[11px] text-[#5C4A3A]">
            工坊承接各类个人/同人主页、网页小游戏等定制化网页客单
          </span>
          <button
            type="button"
            onClick={() => {
              soundManager.playCoin();
              setIsCustomModalOpen(true);
            }}
            className="px-2 py-0.5 bg-[#F8F1DE] hover:bg-[#1E4334] hover:text-[#F9E79F] text-[#1E4334] border border-[#1E4334]/50 text-[11px] font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1"
          >
            <span>💬</span>
            <span>联系制作者</span>
          </button>
        </div>
      </div>

      {/* 商业定制沟通弹窗 */}
      {isCustomModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCustomModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-[#15231B]/60 backdrop-blur-xs flex items-center justify-center p-3"
        >
          <div className="w-full max-w-[440px] bg-gradient-to-b from-[#FAF5E8] to-[#F4ECD9] -[3px] -[#1E4334] shadow-[4px_4px_0px_#153025] overflow-hidden select-none animate-fadeIn">
            <div className="bg-[#1E4334] text-[#F9E79F] px-3 py-2 flex items-center justify-between  ">
              <div className="font-bold text-xs flex items-center gap-1.5">
                <span>🛠️</span>
                <span>商业定制沟通</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="font-pixel text-[10px] text-[#F9E79F] hover:bg-[#8B2515] hover:text-white px-1.5 py-0.5  -[#F9E79F]/40 cursor-pointer"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 space-y-2.5">
              <div className="space-y-1">
                <label htmlFor="co-name" className="text-xs font-bold text-[#203429] block">
                  委托人称呼
                </label>
                <input
                  id="co-name"
                  type="text"
                  value={coName}
                  onChange={(e) => setCoName(e.target.value)}
                  maxLength={30}
                  placeholder="例如：同好策划人"
                  className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2 py-1 text-xs outline-hidden"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="co-contact" className="text-xs font-bold text-[#203429] block">
                  邮箱联系方式 <span className="text-[#A8321E]">*</span>
                </label>
                <input
                  id="co-contact"
                  type="email"
                  value={coContact}
                  onChange={(e) => setCoContact(e.target.value)}
                  maxLength={80}
                  placeholder="your-email@example.com"
                  className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2 py-1 text-xs outline-hidden"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="co-desc" className="text-xs font-bold text-[#203429] block">
                  初步需求简述与期望周期 <span className="text-[#A8321E]">*</span>
                </label>
                <textarea
                  id="co-desc"
                  value={coDesc}
                  onChange={(e) => setCoDesc(e.target.value)}
                  placeholder="请简要描述您的项目构思、核心功能、期望交付周期或预算范围..."
                  rows={3}
                  className="w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                />
              </div>

              <button
                type="button"
                onClick={handleSubmitCustomOrder}
                className="w-full py-2 bg-gradient-to-b from-[#2D5844] to-[#1E4334] hover:from-[#376C54] hover:to-[#255240] text-[#F9E79F]   font-bold text-xs cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
              >
                <span>✉️</span>
                <span>发送需求</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
