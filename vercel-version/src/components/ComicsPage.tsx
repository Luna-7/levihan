import React, { Suspense, useEffect, useRef, useState } from 'react';
import { getSessionToken } from '../utils/cloudbaseToken';
import { useAuthStore } from '../stores/authStore';

const DoujinshiArchive = React.lazy(() => import('./DoujinshiArchive').then((module) => ({ default: module.DoujinshiArchive })));

export default function ComicsPage() {
  const hasSession = useAuthStore((state) => state.hasSession);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showChallenge, setShowChallenge] = useState(false);
  const clickRef = useRef({ count: 0, lastAt: 0 });

  useEffect(() => {
    if (!hasSession) {
      setUnlocked(false);
    }
  }, [hasSession]);

  const verifySession = async () => {
    const token = getSessionToken();
    if (!token) {
      setShowChallenge(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/doujin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gesture: '403', token }),
      });
      if (!response.ok) throw new Error(response.status === 503 ? '验证服务暂时不可用' : '登录状态无效，请重新登录');
      setUnlocked(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证失败');
      setShowChallenge(true);
    } finally {
      setBusy(false);
    }
  };

  const handle403Click = () => {
    const now = Date.now();
    const previous = clickRef.current;
    const count = now - previous.lastAt <= 2500 ? previous.count + 1 : 1;
    clickRef.current = { count, lastAt: now };
    if (count === 3) {
      clickRef.current = { count: 0, lastAt: 0 };
      void verifySession();
    }
  };

  if (!hasSession || !unlocked) {
    return (
      <main className="min-h-dvh bg-[#f6f8fa] px-5 py-12 font-mono text-[#24292f] sm:py-24">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between border-b border-[#d0d7de] pb-3 text-[11px] text-[#6e7781]">
            <span>SECURE NODE GATEWAY</span><span>EDGE / 403</span>
          </div>
          <section className="w-full border border-[#d0d7de] bg-white p-7 text-left shadow-sm sm:p-10">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl"><button type="button" onClick={handle403Click} disabled={busy} className="cursor-default disabled:opacity-60" style={{ font: 'inherit' }} aria-label="403">403</button> Forbidden</h1>
            <p className="mt-4 text-sm text-[#57606a]">You don't have permission to access this resource.</p>
            <div className="mt-8 border-t border-[#d8dee4] pt-5 text-xs leading-7 text-[#6e7781]">
              <p>Request path: /comics</p>
              <p>Status: access denied</p>
              <p>Reference: ERR_ACCESS_FORBIDDEN</p>
            </div>
          </section>
          <p className="mt-4 text-center text-[11px] text-[#8c959f]">secure-node · nginx</p>
        </div>
        {showChallenge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowChallenge(false)}>
            <section role="dialog" aria-modal="true" aria-labelledby="comics-challenge-title" className="w-full max-w-sm border border-[#d0d7de] bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <h2 id="comics-challenge-title" className="text-base font-semibold">访问校验</h2>
                <button type="button" onClick={() => setShowChallenge(false)} aria-label="关闭" className="text-xl leading-none text-[#6e7781]">×</button>
              </div>
              {!hasSession ? (
                <div className="mt-5 text-sm">
                  <p>请先登录账号。</p>
                  <a href="/" className="mt-4 inline-block underline">返回首页登录</a>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                  <a href="/" className="inline-block text-sm underline">返回首页登录</a>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#F8F1DE] px-3 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <h1 className="font-pixel text-xl text-[#1E4334]">漫画本</h1>
          <a href="/" className="text-sm text-[#1E4334] underline">返回首页</a>
        </header>
        <Suspense fallback={<p>正在加载漫画本…</p>}>
          <DoujinshiArchive comicsOnly onShowToast={() => undefined} />
        </Suspense>
      </div>
    </main>
  );
}
