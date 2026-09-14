import React, { FormEvent, useRef, useState } from 'react';
import { PixelStar } from './PixelIcons';
import { soundManager } from '../utils/audio';

export const DOUJIN_SESSION_KEY = 'doujin_unlocked';
const CLICK_WINDOW_MS = 2500;

interface Props {
  children: React.ReactNode;
  enabled?: boolean;
  onUnlock?: () => void;
}

export const DoujinMaintenanceGate: React.FC<Props> = ({ children, enabled = true, onUnlock }) => {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    try {
      return window.sessionStorage.getItem(DOUJIN_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [showAdmin, setShowAdmin] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const clickCountRef = useRef(0);
  const lastClickRef = useRef(0);

  if (!enabled || isUnlocked) return <>{children}</>;

  const handleSecretClick = () => {
    const now = Date.now();
    if (now - lastClickRef.current > CLICK_WINDOW_MS) {
      clickCountRef.current = 0;
    }

    lastClickRef.current = now;
    clickCountRef.current += 1;

    if (clickCountRef.current === 3) {
      soundManager.playChestOpen();
      clickCountRef.current = 0;
      setError('');
      setShowAdmin(true);
    } else {
      soundManager.playBlip();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/doujin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        soundManager.playSwordSlash();
        setError(response.status === 401 ? '口令不正确' : '暂时无法验证，请稍后再试');
        return;
      }

      soundManager.playFanfare();
      window.sessionStorage.setItem(DOUJIN_SESSION_KEY, 'true');
      setPassword('');
      setShowAdmin(false);
      setIsUnlocked(true);
      onUnlock?.();
    } catch {
      soundManager.playSwordSlash();
      setError('暂时无法验证，请稍后再试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="relative min-h-[52vh] flex items-center justify-center px-3 py-10 sm:py-14 overflow-hidden">
      <div className="absolute top-10 left-[12%] opacity-30 pointer-events-none">
        <PixelStar size={14} />
      </div>
      <div className="absolute bottom-14 right-[14%] opacity-25 pointer-events-none">
        <PixelStar size={12} />
      </div>

      <div className="relative w-full max-w-lg text-center bg-[#FFFBEF] border-2 border-[#D5C9AF] rounded-lg px-5 py-9 sm:px-8 sm:py-11 shadow-md overflow-hidden">
        <span className="absolute top-4 left-5 text-[#EAA83B] text-lg opacity-70 pointer-events-none">✦</span>
        <span className="absolute top-7 right-6 text-base opacity-65 pointer-events-none">🥔</span>
        <span className="absolute bottom-5 left-8 text-[#6A4C93] text-xs opacity-55 pointer-events-none">◆</span>
        <span className="absolute bottom-7 right-8 text-[#48A078] text-sm opacity-55 pointer-events-none">✧</span>
        <div className="relative inline-flex items-center justify-center">
          <span className="absolute -left-5 sm:-left-9 top-[35%] text-2xl sm:text-3xl -rotate-12 pointer-events-none" aria-hidden="true">🥔</span>
          <span className="absolute -right-4 sm:-right-8 top-[52%] text-xl sm:text-2xl rotate-12 pointer-events-none" aria-hidden="true">🥔</span>
          <button
            type="button"
            onClick={handleSecretClick}
            onContextMenu={(event) => event.preventDefault()}
            className="inline-flex items-center justify-center w-52 h-48 sm:w-72 sm:h-64 cursor-default select-none touch-manipulation pixel-art"
            style={{ WebkitTouchCallout: 'none' }}
            aria-label="像素人物装饰"
          >
            <img
              src="/images/archive-maintenance.png"
              alt=""
              draggable={false}
              className="block w-full h-full object-contain pointer-events-none"
            />
          </button>
        </div>

        <h2 className="mt-4 font-pixel text-lg sm:text-xl text-[#1E4334] tracking-wide">维护中</h2>
        <p className="mt-3 font-retro-jp text-sm sm:text-base text-[#7A6958]">
          粮仓正在整理中，请稍后再来 🍠
        </p>
        <div className="mt-5 mx-auto w-full max-w-[260px]" aria-label="整理进度 68%">
          <div className="flex items-center justify-between mb-1.5 font-pixel text-[8px] text-[#8C7A68]">
            <span>ARCHIVE PREPARING...</span>
            <span>68%</span>
          </div>
          <div
            className="h-4 p-[2px] bg-[#FFFEEF] border-2 border-[#1E4334] shadow-[2px_2px_0_#D5C9AF]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={68}
          >
            <div
              className="h-full"
              style={{
                width: '68%',
                background: 'repeating-linear-gradient(90deg, #EAA83B 0 9px, #F6C866 9px 12px)',
              }}
            />
          </div>
        </div>
      </div>

      {showAdmin && (
        <div
          className="fixed inset-0 z-[100] bg-[#1E2B24]/55 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="doujin-admin-title"
          onClick={() => setShowAdmin(false)}
        >
          <form
            onSubmit={handleSubmit}
            className="my-auto w-full max-w-sm bg-[#FFFEEF] border-[3px] border-[#1E4334] rounded-lg p-5 sm:p-6 space-y-4 pixel-box shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="doujin-admin-title" className="font-pixel text-sm text-[#1E4334]">
                管理员入口
              </h3>
              <button
                type="button"
                onClick={() => setShowAdmin(false)}
                className="min-w-9 min-h-9 text-[#8C7A68] hover:text-[#1E4334] cursor-pointer"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <label className="block space-y-2">
              <span className="block font-retro-jp text-sm text-[#5B4636]">请输入管理员口令</span>
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
                autoFocus
                autoComplete="current-password"
                className="w-full min-h-12 px-3 py-2.5 bg-[#FAF5E8] border-2 border-[#D5C9AF] focus:border-[#1E4334] outline-none rounded-xs font-retro-jp text-base text-[#2C241D]"
              />
            </label>

            {error && (
              <p role="alert" className="font-retro-jp text-sm text-[#B3402F]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!password || isSubmitting}
              className="w-full min-h-12 px-4 py-3 rounded-xs bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-pixel text-xs shadow-md enabled:hover:bg-[#2B5E4A] disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {isSubmitting ? '验证中...' : '确认'}
            </button>
          </form>
        </div>
      )}
    </section>
  );
};
