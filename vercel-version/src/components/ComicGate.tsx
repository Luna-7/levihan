import React, { useEffect, useRef, useState } from 'react';

const CLICK_WINDOW_MS = 2500;
const UNLOCK_KEY = 'comic_site_unlocked_v1';

/**
 * ComicGate —— 漫画站整站「伪装 403 + 三连击」门。
 *
 * 设计目标（暗号式私有）：
 * - 链接永远不变，打开后看到的是一页**仿真的 403 Forbidden**，HTTP 状态码仍是 200
 *   （不能让搜索引擎/爬虫真的收到 403，那样反而标记了「这里是被封的站点」）。
 * - 页面上没有任何「点这里解锁」「这是漫画站」之类的提示文字，路人一眼就是普通报错页。
 * - 唯一的暗号：在 2.5 秒内连续点击「403」标题三次 → 解锁。
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
        <h1 className="my-[0.67em] text-[2em] leading-normal font-bold">
          403{' '}
          <button
            type="button"
            onClick={handleSecretClick}
            className="cursor-default appearance-none border-0 bg-transparent p-0 font-inherit text-inherit touch-manipulation focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#555]"
            aria-label="Forbidden error heading"
          >
            Forbidden
          </button>
        </h1>
        <hr className="border-0 border-t border-[#999]" />
        <address className="my-4 text-[13px] not-italic text-[#333]">nginx</address>
      </div>
    </main>
  );
};
