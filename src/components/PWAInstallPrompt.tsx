import React, { useState, useEffect } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
  variant?: 'banner' | 'button' | 'icon' | 'header' | 'home-button';
}

const STORAGE_DISMISS_KEY = 'lh_home_download_btn_dismissed_v1';

export const PWAInstallPrompt: React.FC<Props> = ({ onShowToast, variant = 'button' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem(STORAGE_DISMISS_KEY) === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(STORAGE_DISMISS_KEY);
      if (dismissed === 'true') {
        setIsBannerDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleDismissBanner = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBannerDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_DISMISS_KEY, 'true');
    } catch {}
  };

  const handleTriggerInstall = async () => {
    soundManager.playCoin();
    // 点击过一次后永远不再显示
    setIsBannerDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_DISMISS_KEY, 'true');
    } catch {}

    if (isInstalled) {
      onShowToast('已安装为桌面独立 App ✓');
      return;
    }

    if (isInstallable) {
      const success = await install();
      if (success) {
        onShowToast('感谢安装利韩土豆仓 App！🎉');
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      // General instructions for browsers where beforeinstallprompt hasn't fired yet
      onShowToast('点击浏览器地址栏右侧【安装应用】或【添加到主屏幕】即可下载 💻');
    }
  };

  // Variant: Home dismissible button (与页面其他button保持宽度一致，点击过一次后永远不出现)
  if (variant === 'home-button') {
    if (isBannerDismissed) {
      return showIOSModal ? (
        <IOSInstallModal onClose={() => setShowIOSModal(false)} />
      ) : null;
    }

    return (
      <>
        <div className="w-full animate-fadeIn">
          <div className="w-full flex items-stretch border-2 border-[#1C1611] shadow-[2px_2px_0px_#1C1611] bg-[#4A2D16] text-[#F9E79F] overflow-hidden select-none">
            <button
              type="button"
              onClick={handleTriggerInstall}
              className="flex-1 py-1.5 sm:py-2 px-3 hover:bg-[#5C391C] active:scale-[0.99] font-pixel text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              title="下载利韩土豆仓为桌面独立应用（离线秒开）"
            >
              <span className="text-xs sm:text-sm">💻</span>
              <span>{isInstalled ? '已安装桌面 App ✓' : '下载到桌面'}</span>
            </button>
            <button
              type="button"
              onClick={handleDismissBanner}
              className="px-3 py-1.5 sm:py-2 border-l-2 border-[#1C1611] bg-[#3B2210] hover:bg-[#A93226] text-[#F9E79F] hover:text-white font-bold text-xs sm:text-sm flex items-center justify-center cursor-pointer transition-colors shrink-0"
              title="关闭此按钮"
              aria-label="关闭下载到桌面按钮"
            >
              ✕
            </button>
          </div>
        </div>

        {showIOSModal && (
          <IOSInstallModal onClose={() => setShowIOSModal(false)} />
        )}
      </>
    );
  }

  // Variant: Header action button (Pixel wood style "下载到桌面")
  if (variant === 'header') {
    if (isBannerDismissed) {
      return null;
    }
    return (
      <>
        <button
          type="button"
          onClick={handleTriggerInstall}
          className="px-2 xs:px-2.5 py-1 bg-[#4A2D16] hover:bg-[#5C391C] text-[#F9E79F] border-2 border-[#1C1611] font-pixel text-[10px] xs:text-[11px] sm:text-xs font-bold rounded-none cursor-pointer transition-all duration-75 active:scale-95 shadow-[1px_1px_0px_#1C1611] flex items-center gap-1 shrink-0 select-none"
          title="下载利韩土豆仓到桌面独立 App"
          aria-label="下载到桌面"
        >
          <span className="text-xs">💻</span>
          <span className="whitespace-nowrap">{isInstalled ? '已安装 ✓' : '下载到桌面'}</span>
        </button>

        {showIOSModal && (
          <IOSInstallModal onClose={() => setShowIOSModal(false)} />
        )}
      </>
    );
  }

  // If already running standalone, no need to show install banner/button
  if (isInstalled) {
    return null;
  }

  // Variant: Icon button in header bar
  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={handleTriggerInstall}
          className="text-xs px-2 py-1 rounded-xs bg-[#245340] hover:bg-[#2e6850] text-[#F9E79F] border border-[#37755c] cursor-pointer flex items-center gap-1 shrink-0 select-none transition-colors active:scale-95"
          title="安装利韩土豆仓为手机应用"
          aria-label="安装为手机应用"
        >
          <span className="text-sm">📱</span>
          <span className="hidden xs:inline text-[10px] sm:text-[11px] font-bold font-retro-jp">
            {isIOS ? '添加到桌面' : '安装App'}
          </span>
        </button>

        {showIOSModal && (
          <IOSInstallModal onClose={() => setShowIOSModal(false)} />
        )}
      </>
    );
  }

  // Variant: Button
  if (variant === 'button') {
    return (
      <>
        <button
          onClick={handleTriggerInstall}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xs bg-[#E5A93C] hover:bg-[#D99C2C] text-[#2C241D] font-bold font-retro-jp text-xs sm:text-sm border-2 border-[#B7791F] shadow-xs active:translate-y-0.5 transition-all select-none cursor-pointer"
        >
          <span>📱</span>
          <span>{isIOS ? '添加到 iPhone 桌面' : '安装手机/电脑客户端'}</span>
        </button>

        {showIOSModal && (
          <IOSInstallModal onClose={() => setShowIOSModal(false)} />
        )}
      </>
    );
  }

  // Variant: Top Banner on mobile when not dismissed
  if (isBannerDismissed) {
    return (
      showIOSModal ? <IOSInstallModal onClose={() => setShowIOSModal(false)} /> : null
    );
  }

  return (
    <>
      <div className="bg-[#FAF5E8] border-2 border-[#1E4334] rounded-md p-2.5 xs:p-3 mb-3 shadow-sm flex items-center justify-between gap-2.5 animate-fadeIn">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-md bg-[#1E4334] text-[#FAF5E8] flex items-center justify-center shrink-0 text-base shadow-xs">
            🥔
          </div>
          <div className="min-w-0">
            <div className="font-pixel text-[11px] xs:text-xs text-[#1E4334] font-bold truncate">
              安装利韩土豆仓 PWA
            </div>
            <div className="font-retro-jp text-[10px] xs:text-[11px] text-[#5C4736] truncate">
              离线秒开 · 全屏沉浸 · 随时随地吃粮
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleTriggerInstall}
            className="px-2.5 py-1.5 bg-[#1E4334] hover:bg-[#295b46] text-[#F9E79F] font-pixel text-[10px] xs:text-[11px] rounded-xs border border-[#153025] cursor-pointer shadow-xs active:translate-y-0.5 select-none"
          >
            {isIOS ? '添加' : '安装'}
          </button>
          <button
            onClick={handleDismissBanner}
            className="w-6 h-6 flex items-center justify-center text-[#8C7A68] hover:text-[#1E4334] text-xs rounded-full hover:bg-[#EAE2CE] cursor-pointer select-none"
            title="暂时关闭"
            aria-label="关闭安装提示"
          >
            ✕
          </button>
        </div>
      </div>

      {showIOSModal && (
        <IOSInstallModal onClose={() => setShowIOSModal(false)} />
      )}
    </>
  );
};

const IOSInstallModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-[#FAF5E8] border-3 border-[#1E4334] p-5 shadow-2xl relative text-[#2C241D] font-retro-jp space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-dashed border-[#D5C9AF] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🥔</span>
            <h3 className="font-pixel text-sm text-[#1E4334] font-bold">
              添加到 iPhone / iPad
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-[#EAE2CE] hover:bg-[#D5C9AF] flex items-center justify-center text-sm font-bold text-[#1E4334] cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs sm:text-sm text-[#4A3A2C] leading-relaxed">
          <div className="flex items-start gap-2.5 bg-[#FFFEEF] p-2.5 rounded-xs border border-[#D5C9AF]">
            <span className="font-pixel text-xs bg-[#1E4334] text-[#FAF5E8] w-5 h-5 rounded-full flex items-center justify-center shrink-0">
              1
            </span>
            <div>
              使用 <strong>Safari 浏览器</strong> 打开本站，点击底部工具栏的「<strong>分享</strong>」图标（带有向上箭头的方框）。
            </div>
          </div>

          <div className="flex items-start gap-2.5 bg-[#FFFEEF] p-2.5 rounded-xs border border-[#D5C9AF]">
            <span className="font-pixel text-xs bg-[#1E4334] text-[#FAF5E8] w-5 h-5 rounded-full flex items-center justify-center shrink-0">
              2
            </span>
            <div>
              在弹出的分享菜单中向下滑动，找到并点击「<strong>添加到主屏幕</strong>」图标 ➕。
            </div>
          </div>

          <div className="flex items-start gap-2.5 bg-[#FFFEEF] p-2.5 rounded-xs border border-[#D5C9AF]">
            <span className="font-pixel text-xs bg-[#1E4334] text-[#FAF5E8] w-5 h-5 rounded-full flex items-center justify-center shrink-0">
              3
            </span>
            <div>
              点击右上角的「<strong>添加</strong>」，桌面上就会生成利韩土豆仓专属 App 图标，随时享受全屏无缝体验！
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs border-2 border-[#153025] hover:bg-[#295b46] cursor-pointer shadow-xs font-bold"
        >
          我明白了
        </button>
      </div>
    </div>
  );
};
