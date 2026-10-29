import React, { useEffect, useRef, useState } from 'react';

const CLICK_WINDOW_MS = 2500;
const UNLOCK_KEY = 'comic_site_unlocked_v1';

/**
 * ComicGate —— 漫画站入口，沿用主站「土豆仓」图标与三连击门。
 *
 * 设计目标（暗号式私有）：
 * - 页面显示主站的土豆仓标识，不暴露漫画站用途。
 * - 在 2.5 秒内连续点击标题三次即可解锁。
 * - 解锁后写 sessionStorage，本次浏览器会话内刷新不再重复；关标签页即失效。
 *
 * 诚实边界：这是「防路人、防顺手转发、防爬虫」的软墙，不是密码学防线。
 * 懂行的人看 JS 就知道「点三下解锁」。敏感本子的真正防护仍是 SecureComicReader
 * 那套前端 AES 解密（第二层），本门只负责挡住「不知道暗号」的人。
 */
export const ComicGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem(UNLOCK_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const clickCountRef = useRef(0);
  const lastClickRef = useRef(0);

  const handleSecretClick = () => {
    const now = Date.now();
    if (now - lastClickRef.current > CLICK_WINDOW_MS) {
      clickCountRef.current = 0;
    }
    lastClickRef.current = now;
    clickCountRef.current += 1;
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      try {
        window.sessionStorage.setItem(UNLOCK_KEY, 'true');
      } catch {
        /* 仅本次挂载有效 */
      }
      setUnlocked(true);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <main
      className="min-h-[100dvh] w-full bg-white px-2 py-2 text-[#111]"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <div className="w-full">
        <h1 className="my-[0.67em] flex items-center gap-3 text-[2em] leading-normal font-bold">
          <button
            type="button"
            onClick={handleSecretClick}
            className="inline-flex cursor-default items-center gap-3 appearance-none border-0 bg-transparent p-0 font-inherit text-inherit touch-manipulation focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#555]"
            aria-label="土豆仓"
          >
            <img src="/favicon.svg" width="36" height="36" alt="" />
            土豆仓
          </button>
        </h1>
        <hr className="border-0 border-t border-[#999]" />
        <address className="my-4 text-[13px] not-italic text-[#333]">nginx</address>
      </div>
    </main>
  );
};
