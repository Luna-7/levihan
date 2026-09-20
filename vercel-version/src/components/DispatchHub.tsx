import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { soundManager } from '../utils/audio';
import { submitToInbox } from '../utils/submissionInbox';
import { CardPatternOverlay } from './CardPatternOverlay';
import { PopupSketchOverlay } from './PopupSketchOverlay';

interface Props {
  onShowToast: (msg: string) => void;
}

interface UploadedFileItem {
  id: string;
  name: string;
  size: number;
}

export const DispatchHub: React.FC<Props> = ({ onShowToast }) => {
  // Main Tab: 'feedback' (战术研讨) | 'share' (作品分享)
  const [mainTab, setMainTab] = useState<'feedback' | 'share'>('feedback');

  // Report Modal State
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

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
    soundManager.playScrollOpen();
    setIsLoading(true);
    setTimeout(() => {
      callback();
      setTimeout(() => {
        setIsLoading(false);
      }, 60);
    }, 120);
  };

  const copyToClipboard = async (text: string) => {
    soundManager.playStamp();
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

  // 联络呈递：把表单内容真正送进管理员后台的「联络收件箱」；失败时返回 false，由调用方走剪贴板兜底
  const sendToInbox = async (kind: string, fields: Record<string, string>) => {
    try {
      const payload: Record<string, unknown> = { kind };
      Object.entries(fields).forEach(([key, value]) => {
        const v = value.trim();
        if (v) payload[key] = v;
      });
      await submitToInbox('submitContact', payload);
      return true;
    } catch {
      return false;
    }
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

    const sent = await sendToInbox('feedback', {
      category: feedbackCategory,
      name: feedbackName,
      email: feedbackEmail,
      content: feedbackContent,
    });
    if (sent) {
      onShowToast('调查报告已呈递至收件箱！📬');
      setFeedbackContent('');
      setIsReportModalOpen(false);
      return;
    }

    const copied = await copyToClipboard(reportText);
    if (copied) {
      onShowToast('联络通道繁忙，报告已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
    }
    setFeedbackContent('');
    setIsReportModalOpen(false);
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

    const sent = await sendToInbox('translate-release', {
      title: trBookName,
      source: trSource,
      author: trOriginalAuthor,
      translator: trTranslator,
      typesetter: trTypesetter,
      homepage: trHomepage,
      email: trEmail,
      notes: trNotes,
      content: fileNames,
    });
    if (sent) {
      onShowToast('自作发布函已呈递至收件箱！📬');
      return;
    }

    const copied = await copyToClipboard(letterText);
    if (copied) {
      onShowToast('联络通道繁忙，发布函已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
    }
  };

  // 3. 呈递小说
  const handleSubmitNovel = async () => {
    if (!nvTitle.trim()) {
      onShowToast('请填写作品名称 ⚠️');
      return;
    }
    if (!nvEmail.trim() || !isValidEmail(nvEmail.trim())) {
      onShowToast('请填写有效的邮箱联系方式 ⚠️');
      return;
    }

    const fileNames = nvFiles.map((f) => f.name).join(', ');
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const letterText = [
      `【利韩土豆仓 · 同人小说呈递函】`,
      `作品名称: ${nvTitle.trim()}`,
      `创作者: ${nvAuthor.trim() || '未署名'}`,
      `主页链接: ${nvHomepage.trim() || '未提供'}`,
      `邮箱联系方式: ${nvEmail.trim()}`,
      `上传附件: ${fileNames || '未附加本地文件'}`,
      `备注: ${nvNotes.trim() || '无'}`,
      `呈递时间: ${dateStr}`,
      `----------------------------------------`,
    ].join('\n');

    const sent = await sendToInbox('novel', {
      title: nvTitle,
      author: nvAuthor,
      homepage: nvHomepage,
      email: nvEmail,
      notes: nvNotes,
      content: fileNames,
    });
    if (sent) {
      onShowToast('小说作品函已呈递至收件箱！📬');
      return;
    }

    const copied = await copyToClipboard(letterText);
    if (copied) {
      onShowToast('联络通道繁忙，作品函已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
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

    const sent = await sendToInbox('art-comic', {
      title: artTitle,
      author: artAuthor,
      homepage: artHomepage,
      email: artEmail,
      notes: artNotes,
      content: fileNames,
    });
    if (sent) {
      onShowToast('插画/短漫函已呈递至收件箱！📬');
      return;
    }

    const copied = await copyToClipboard(letterText);
    if (copied) {
      onShowToast('联络通道繁忙，插画函已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
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

    const sent = await sendToInbox('recommend', {
      title: recTitle,
      link: recLink,
      reason: recReason,
      content: recReason,
    });
    if (sent) {
      onShowToast('安利推荐已呈递至收件箱！📬');
      setRecTitle('');
      setRecLink('');
      setRecReason('');
      return;
    }

    const copied = await copyToClipboard(recText);
    if (copied) {
      onShowToast('联络通道繁忙，推荐已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
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

    const sent = await sendToInbox('translate-request', {
      title: transTitle,
      source: transSource,
      reason: transReason,
      content: transReason,
    });
    if (sent) {
      onShowToast('汉化心愿已呈递至收件箱！📬');
      setTransTitle('');
      setTransSource('');
      setTransReason('');
      return;
    }

    const copied = await copyToClipboard(transText);
    if (copied) {
      onShowToast('联络通道繁忙，心愿已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
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

    const sent = await sendToInbox('custom-order', {
      name: coName,
      email: coContact,
      content: coDesc,
    });
    if (sent) {
      onShowToast('定制需求已呈递至收件箱！📬');
      setTimeout(() => {
        setIsCustomModalOpen(false);
        setCoDesc('');
      }, 1000);
      return;
    }

    const copied = await copyToClipboard(orderText);
    if (copied) {
      onShowToast('联络通道繁忙，需求已复制到剪贴板 📋');
    } else {
      onShowToast('联络通道繁忙，请稍后重试 ⚠️');
    }
    setTimeout(() => {
      setIsCustomModalOpen(false);
      setCoDesc('');
    }, 1000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col justify-between gap-3 sm:gap-4 font-retro-jp text-[#203429] pb-4">
      {/* ====================================================
          卡片 1：复古花纹信封 (Vintage Envelope Dispatch Form) - 兵长茶会/巨树餐厅同款风格
         ==================================================== */}
      <div className="relative flex-1 flex flex-col bg-[#FAF3E3]/85 backdrop-blur-xs p-3.5 sm:p-4.5 overflow-hidden border-2 border-[#1E4334] rounded-2xl shadow-[0_4px_16px_rgba(30,67,52,0.18)] min-h-0">
        <CardPatternOverlay opacity={0.08} mode="multiply" />
        {/* 信封四角复古花纹装饰角 (Retro filigree corner accents) */}
        <div className="absolute top-2 left-2 text-[#8C6C47]/30 text-[10px] pointer-events-none select-none">⚜</div>
        <div className="absolute top-2 right-2 text-[#8C6C47]/30 text-[10px] pointer-events-none select-none">⚜</div>
        <div className="absolute bottom-2 left-2 text-[#8C6C47]/30 text-[10px] pointer-events-none select-none">⚜</div>
        <div className="absolute bottom-2 right-2 text-[#8C6C47]/30 text-[10px] pointer-events-none select-none">⚜</div>

        {/* 信封右上角复古邮戳与微型火漆印章 */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 pointer-events-none select-none opacity-85">
          <div className="vintage-postmark-stamp px-2 py-0.5 text-[9px] font-pixel text-[#8C6C47] border-[#8C6C47]/60 tracking-wider rounded-xs">
            104·DISPATCH
          </div>
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#A8321E] via-[#8B2515] to-[#541408] flex items-center justify-center shadow-xs">
            <span className="text-[10px]">🥔</span>
          </div>
        </div>

        {/* 复古像素风加载遮罩 */}
        {isLoading && (
          <div className="absolute inset-0 bg-[#F6EED9]/92 z-50 flex flex-col items-center justify-center gap-2 backdrop-blur-xs">
            <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
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

        {/* ====================================================
            卡片组：独立操作区域
           ==================================================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 shrink-0">
          {/* 卡片 A：致谢同好 (Supporters Card) */}
          <div className="p-3.5 border-2 border-dashed border-[#8C6C47]/40 rounded-xl bg-[#FAF3E3]/50 backdrop-blur-xs relative overflow-hidden flex flex-col justify-between min-h-[105px]">
            <CardPatternOverlay opacity={0.05} mode="multiply" />
            <h3 className="font-serif-title text-sm font-black text-[#1E4334] mb-1 flex items-center gap-2">
              <span>🤝</span>
              <span>感谢以下同好对网站的支持</span>
            </h3>
            <div className="flex-1 flex items-center justify-center text-[#8C6C47]/50 text-[10px] italic">
              {/* 名单暂空 */}
              (名单整理中...)
            </div>
          </div>

          {/* 卡片 B：呈递调查报告 (Report Card) */}
          <button
            type="button"
            onClick={() => setIsReportModalOpen(true)}
            className="group p-3.5 border-2 border-[#1E4334] rounded-xl bg-[#FAF3E3]/90 relative overflow-hidden flex flex-col justify-between text-left transition-all hover:border-[#11281E] hover:bg-[#F3EAD5] active:scale-[0.98] shadow-[0_2px_8px_rgba(30,67,52,0.12)] cursor-pointer min-h-[105px]"
          >
            <CardPatternOverlay opacity={0.08} mode="multiply" />
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-pixel text-[9px] text-[#1E4334] font-bold tracking-widest bg-[#1E4334]/10 px-2 py-0.5 rounded-full">
                  CODE: 04:D1S
                </span>
                <span className="text-sm">📨</span>
              </div>
              <h3 className="font-serif-title text-sm font-black text-[#1E4334]">
                呈递调查报告
              </h3>
            </div>
            <p className="text-[10px] text-[#5C4A3A] mt-1 italic opacity-75 group-hover:opacity-100">
              点此填写战术研讨建议或异常排查报告...
            </p>
          </button>
        </div>

        {/* 联络子模块切换 (如果未来有更多子模块) */}
        {mainTab === 'share' && (
          <div className="mb-3">
            <button
              onClick={() => setMainTab('feedback')}
              className="text-[11px] text-[#1E4334] font-bold hover:underline cursor-pointer"
            >
              ← 返回主要联络界面
            </button>
          </div>
        )}

        {/* ======================= MODULE 1: 弹窗模式的战术研讨 ======================= */}
        {isReportModalOpen && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-[#FFFDF6] border-2 border-[#1E4334] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] flex flex-col relative overflow-hidden animate-in fade-in zoom-in duration-200">
              <CardPatternOverlay opacity={0.08} mode="multiply" />
              <PopupSketchOverlay />

              {/* 弹窗头部 */}
              <div className="relative bg-[#1E4334] p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📋</span>
                  <span className="font-serif-title text-sm font-black text-[#F9E79F] tracking-widest">
                    战术研讨 · 调查报告呈递 (04:D1S)
                  </span>
                </div>
                <button 
                  onClick={() => setIsReportModalOpen(false)}
                  className="w-6 h-6 flex items-center justify-center bg-[#F9E79F] text-[#1E4334] rounded-full hover:bg-white transition-colors cursor-pointer text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {/* 弹窗主体 */}
              <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh] no-scrollbar">
                {/* 类别 Chips */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[#1E4334] block">报告分类</label>
                  <div className="flex flex-wrap gap-1.5">
                    {['🎮 玩法手感', '💡 新功能与彩蛋', '🐛 异常排查', '📦 素材提供', '🤝 网站助手', '💬 随便聊聊'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          soundManager.playBlip();
                          setFeedbackCategory(cat);
                        }}
                        className={`px-2.5 py-1 text-[10px] cursor-pointer transition-all shadow-[1px_1px_0px_#261307] border border-[#8C6C47]/30 rounded-xs ${
                          feedbackCategory === cat
                            ? 'bg-[#1E4334] text-[#F9E79F] font-bold border-[#1E4334]'
                            : 'bg-[#F8F1DE] text-[#5C4A3A] hover:bg-[#F1E5CB]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 士兵代号 / 称呼 与 联络邮箱 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="fb-name" className="text-[11px] font-bold text-[#1E4334] block">
                      士兵代号 / 称呼
                    </label>
                    <input
                      id="fb-name"
                      type="text"
                      value={feedbackName}
                      onChange={(e) => setFeedbackName(e.target.value)}
                      maxLength={30}
                      placeholder="特务班同好"
                      className="w-full bg-white/50 border-2 border-[#1E4334]/20 focus:border-[#1E4334] px-2.5 py-1.5 text-xs text-[#203429] outline-none rounded-sm transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="fb-email" className="text-[11px] font-bold text-[#1E4334] block">
                      联络邮箱
                    </label>
                    <input
                      id="fb-email"
                      type="email"
                      value={feedbackEmail}
                      onChange={(e) => setFeedbackEmail(e.target.value)}
                      maxLength={80}
                      placeholder="接收回函 (可选)"
                      className="w-full bg-white/50 border-2 border-[#1E4334]/20 focus:border-[#1E4334] px-2.5 py-1.5 text-xs text-[#203429] outline-none rounded-sm transition-all"
                    />
                  </div>
                </div>

                {/* 战术研讨详情 */}
                <div className="space-y-1 flex-1 flex flex-col min-h-0">
                  <label htmlFor="fb-content" className="text-[11px] font-bold text-[#1E4334] block shrink-0">
                    详细内容说明
                  </label>
                  <textarea
                    id="fb-content"
                    value={feedbackContent}
                    onChange={(e) => setFeedbackContent(e.target.value)}
                    placeholder="请详细描述您的建议、遇到的问题、或者想分享的同好感想..."
                    rows={4}
                    className="w-full flex-1 min-h-[120px] bg-white/50 border-2 border-[#1E4334]/20 focus:border-[#1E4334] p-2.5 text-xs text-[#203429] outline-none resize-none rounded-sm transition-all"
                  />
                </div>
              </div>

              {/* 弹窗底部 */}
              <div className="p-4 bg-[#1E4334]/5 border-t border-[#1E4334]/10">
                <button
                  type="button"
                  onClick={handleSubmitFeedback}
                  className="w-full py-2.5 px-4 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F] font-bold text-sm cursor-pointer transition-all active:scale-[0.98] shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-2 border border-[#153025] rounded-sm"
                >
                  <span>✉️</span>
                  <span>呈递调查报告</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* 原本的模块内容 (仅在 mainTab === 'share' 时显示，因为 feedback 现在是 Modal) */}

        {/* ======================= MODULE 2: 投递自作 ======================= */}
        {mainTab === 'share' && (
          <section className="bg-[#FAF4E4]/90 p-2 sm:p-2.5 relative z-10 space-y-2 border border-[#8C6C47]/20 rounded-xs flex-1 min-h-0 flex flex-col overflow-y-auto">
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              {/* 作品形式选择: 汉化发布 / 同人小说 / 同人插画短漫 */}
              <div className="flex flex-nowrap overflow-x-auto gap-1 scrollbar-none">
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
                      className={`px-2 py-1 text-xs cursor-pointer transition-all shadow-[1px_1px_0px_#261307] whitespace-nowrap shrink-0 border border-[#1E4334] rounded-xs ${
                        workType === item.id
                          ? 'bg-[#1E4334] text-[#F9E79F] font-bold'
                          : 'bg-[#F8F1DE] text-[#5C4A3A] hover:bg-[#F1E5CB]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* 形式 A: 汉化发布 */}
                {workType === 'translate-release' && (
                  <div className="space-y-2.5 pt-1 flex-1 flex flex-col">
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

                    <div className="space-y-1 flex-1 flex flex-col min-h-0">
                      <label htmlFor="tr-notes" className="text-xs font-bold text-[#203429] block shrink-0">
                        备注
                      </label>
                      <textarea
                        id="tr-notes"
                        value={trNotes}
                        onChange={(e) => setTrNotes(e.target.value)}
                        placeholder="授权说明、解压密码或收录注意事项..."
                        rows={2}
                        className="w-full flex-1 min-h-[60px] bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitTranslateRelease}
                      className="w-full shrink-0 py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>📤</span>
                      <span>呈递自作</span>
                    </button>
                  </div>
                )}

                {/* 形式 B: 同人小说 */}
                {workType === 'novel' && (
                  <div className="space-y-2.5 pt-1 flex-1 flex flex-col">
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
                          multiple
                          onChange={(e) => handleAddFiles(e.target.files, setNvFiles)}
                          className="hidden"
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xl">📖</span>
                          <span className="text-xs font-bold text-[#203429]">
                            点击选择文件 或 拖拽至此处
                          </span>
                          <span className="text-[10px] text-[#5C4A3A]">
                            支持 .txt / .docx / .pdf / .epub / 压缩包
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

                    <div className="space-y-1 flex-1 flex flex-col min-h-0">
                      <label htmlFor="nv-notes" className="text-xs font-bold text-[#203429] block shrink-0">
                        备注
                      </label>
                      <textarea
                        id="nv-notes"
                        value={nvNotes}
                        onChange={(e) => setNvNotes(e.target.value)}
                        placeholder="篇幅分卷、阅读警告或寄语..."
                        rows={2}
                        className="w-full flex-1 min-h-[60px] bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitNovel}
                      className="w-full shrink-0 py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>✍️</span>
                      <span>呈递小说作品</span>
                    </button>
                  </div>
                )}

                {/* 形式 C: 同人插画/短漫 */}
                {workType === 'art-comic' && (
                  <div className="space-y-2.5 pt-1 flex-1 flex flex-col">
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

                    <div className="space-y-1 flex-1 flex flex-col min-h-0">
                      <label htmlFor="art-notes" className="text-xs font-bold text-[#203429] block shrink-0">
                        备注
                      </label>
                      <textarea
                        id="art-notes"
                        value={artNotes}
                        onChange={(e) => setArtNotes(e.target.value)}
                        placeholder="画集简介或展示要求..."
                        rows={2}
                        className="w-full flex-1 min-h-[60px] bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] p-2 text-xs outline-hidden resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitArtComic}
                      className="w-full shrink-0 py-2 px-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#245340] hover:to-[#1a3d2f] text-[#F9E79F]  font-bold text-xs sm:text-sm cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5 shadow-[2px_2px_0px_#153025] flex items-center justify-center gap-1.5"
                    >
                      <span>🎨</span>
                      <span>呈递插画/短漫</span>
                    </button>
                  </div>
                )}
              </div>
          </section>
        )}
      </div>

      {/* ====================================================
          卡片 2：联系制作者 / 工坊商业与同好定制卡片 (Craftsman Workshop Card) - 兵长茶会/巨树餐厅同款边框
         ==================================================== */}
      <div className="relative bg-[#FAF3E3]/85 backdrop-blur-xs p-3.5 sm:p-4 overflow-hidden border-2 border-[#1E4334] rounded-2xl shadow-[0_4px_16px_rgba(30,67,52,0.18)] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <CardPatternOverlay opacity={0.06} mode="multiply" />
        <div className="relative z-10 flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#1E4334] text-[#F9E79F] flex items-center justify-center shrink-0 shadow-xs text-xs">
            🛠️
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#1E4334] flex items-center gap-1.5 flex-wrap">
              <span className="px-2.5 py-0.5 border border-dashed border-[#1E4334]/50 text-[#1E4334] font-medium text-xs rounded-full inline-block bg-[#FAF4E4]/70">
                独立开发与同好定制
              </span>
              <span className="px-1.5 py-0.2 bg-[#1E4334]/10 text-[#1E4334] text-[10px] rounded-xs font-mono border border-dashed border-[#1E4334]/30">
                COMMISSION
              </span>
            </div>
            <p className="text-[11px] text-[#5C4A3A] truncate mt-0.5">
              承接各类同人主页、个人站点、网页小游戏与互动功能定制
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            soundManager.playCoin();
            setIsCustomModalOpen(true);
          }}
          className="relative z-10 w-full sm:w-auto px-4 py-1.5 bg-[#1E4334] hover:bg-[#255642] text-[#F9E79F] border border-[#153025] text-xs font-bold cursor-pointer transition-all shadow-[0_2px_6px_rgba(30,67,52,0.25)] flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap rounded-full active:scale-95"
        >
          <span>💬</span>
          <span>联系制作者</span>
          <span>→</span>
        </button>
      </div>

      {/* 商业定制沟通弹窗 */}
      {typeof document !== 'undefined' && isCustomModalOpen && createPortal(
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCustomModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-[#15231B]/60 backdrop-blur-xs flex items-center justify-center p-3"
        >
          <div className="relative w-full max-w-[440px] bg-[#FFFDF6] border-2 border-[#1E4334] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] overflow-hidden select-none animate-fadeIn">
            <CardPatternOverlay opacity={0.08} mode="multiply" />
            <PopupSketchOverlay />
            <div className="relative bg-[#1E4334] text-[#F9E79F] px-4 py-2.5 flex items-center justify-between">
              <div className="font-bold text-xs flex items-center gap-1.5">
                <span>🛠️</span>
                <span>商业定制沟通</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="font-pixel text-[10px] text-[#F9E79F] hover:bg-[#8B2515] hover:text-white w-5 h-5 rounded-full flex items-center justify-center border border-[#F9E79F]/40 cursor-pointer"
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
        </div>,
        document.body
      )}
    </div>
  );
};
