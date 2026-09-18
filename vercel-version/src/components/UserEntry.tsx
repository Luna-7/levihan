import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cloudbase } from '../utils/cloudbase';
import { UiSprite } from './UiSprite';

type View = 'login' | 'register' | 'account';
type Account = { uid: string; nickname: string; role?: string; createdAt?: string };
type Props = { onShowToast: (message: string) => void };

/**
 * 注册 / 登录走 HTTP 访问服务，而不是 cloudbase.callFunction：
 * 这两步必然发生在拿到登录态之前，而网关鉴权默认只放行已登录用户。
 * 与其对应的云函数是 registerWithPassword / loginWithPassword。
 */
const ACCOUNT_API_BASE = 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com';
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['message', 'errorMessage', 'errMsg']) {
      if (typeof value[key] === 'string' && value[key]) return value[key] as string;
    }
    if (value.error && typeof value.error === 'object') {
      const nested = value.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message) return nested.message;
    }
  }
  return '操作失败，请稍后重试';
};

/** 用 text/plain 发送，避开浏览器对 application/json 的 CORS 预检 */
const postAccountApi = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${ACCOUNT_API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.message || '账号服务暂时不可用，请稍后重试');
  return result as { ok: true; ticket: string; profile: Account };
};

const validateNickname = (nickname: string) =>
  nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX
    ? `昵称需要 ${NICKNAME_MIN}–${NICKNAME_MAX} 个字`
    : null;

const validatePassword = (password: string) =>
  password.length < PASSWORD_MIN || password.length > PASSWORD_MAX
    ? `密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`
    : null;

export const UserEntry: React.FC<Props> = ({ onShowToast }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [newNickname, setNewNickname] = useState('');

  const call = async (name: string, data: Record<string, unknown> = {}) => {
    try {
      const response = await cloudbase.callFunction({ name, data });
      const result = response?.result || response;
      if (result?.ok === false) throw new Error(result.message || '操作失败，请稍后重试');
      return result;
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  };

  /** 拿到服务端签发的一次性票据后换登录态 */
  const signInWithTicket = async (ticket: string) => {
    const auth = cloudbase.auth();
    const result = await auth.signInWithCustomTicket(() => Promise.resolve(ticket));
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      throw new Error(errorMessage(result.error));
    }
    return result;
  };

  const refresh = async () => {
    try {
      const user = await cloudbase.auth().getCurrentUser();
      if (!user) return setAccount(null);
      const result = await call('getUserAccount');
      setAccount(result.profile);
    } catch { setAccount(null); }
  };
  useEffect(() => { void refresh(); }, []);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); }
    catch (error) { onShowToast(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const clearSecrets = () => { setPassword(''); setConfirmPassword(''); };
  const switchView = (next: View) => { clearSecrets(); setView(next); };
  const showEntry = () => { switchView(account ? 'account' : 'login'); setOpen(true); };

  useEffect(() => {
    const handleOpenRequest = () => showEntry();
    window.addEventListener('levihan-open-login', handleOpenRequest);
    return () => window.removeEventListener('levihan-open-login', handleOpenRequest);
  }, [account]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const registering = view === 'register';
    void run(async () => {
      const name = nickname.trim();
      const invalid = validateNickname(name) || validatePassword(password);
      if (invalid) throw new Error(invalid);
      if (registering && password !== confirmPassword) throw new Error('两次输入的密码不一致');

      const result = await postAccountApi(registering ? 'registerWithPassword' : 'loginWithPassword', {
        nickname: name,
        password,
      });
      await signInWithTicket(result.ticket);
      await refresh();
      window.dispatchEvent(new Event('levihan-auth-changed'));
      clearSecrets();
      setOpen(false);
      onShowToast(registering ? '注册成功，欢迎加入利韩土豆仓' : '欢迎回到利韩土豆仓');
    });
  };

  const title = account ? account.nickname : view === 'register' ? '加入 LeviHan' : '欢迎回来';

  return <>
    <button type="button" onClick={showEntry} className="relative w-[108px] h-[39px] bg-transparent border-0 font-retro-jp text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap active:scale-95 transition-transform overflow-hidden" aria-label="打开用户入口">
      <UiSprite name="button-wide" width={108} className="absolute inset-0 pointer-events-none" />
      <span className="absolute top-[18px] bottom-0 left-2 right-8 flex items-center justify-center text-[#F9E79F] drop-shadow-[0_1px_1px_#1C1611]">{account?.nickname || '登录'}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[100] min-h-[var(--app-h)] bg-black/65 flex items-center justify-center p-3 overflow-hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="LeviHan 用户入口" className="relative w-full max-w-md max-h-[88dvh] overflow-y-auto bg-[#FAF0D7] border-[3px] border-[#1C1611] shadow-[7px_7px_0_#1C1611] p-4 sm:p-5 text-[#2C241D] font-retro-jp">
        <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 w-8 h-8 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] cursor-pointer">×</button>
        <p className="font-pixel text-[10px] text-[#8C5828] tracking-widest mb-1">LEVIHAN MEMBER</p>
        <h2 className="font-pixel text-lg text-[#1E4334] mb-4 pr-10">{title}</h2>

        {!account && (view === 'login' || view === 'register') && <form className="space-y-3" onSubmit={submit}>
          <label className="block font-bold text-sm">昵称
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" minLength={NICKNAME_MIN} maxLength={NICKNAME_MAX} required placeholder={`${NICKNAME_MIN}–${NICKNAME_MAX} 个字`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <label className="block font-bold text-sm">密码
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={view === 'register' ? 'new-password' : 'current-password'} minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required placeholder={`至少 ${PASSWORD_MIN} 位`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          {view === 'register' && <label className="block font-bold text-sm">确认密码
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>}
          <Submit busy={busy}>{view === 'register' ? '创建账号' : '登录'}</Submit>
          <p className="pt-1 text-center text-xs text-[#73583F]">
            {view === 'register'
              ? <button type="button" onClick={() => switchView('login')} className="underline cursor-pointer">已有账号？返回登录</button>
              : <><button type="button" onClick={() => switchView('register')} className="underline cursor-pointer">还没有账号？注册</button><span className="px-2">·</span><button type="button" onClick={() => onShowToast('暂时不支持找回密码，请重新注册一个昵称')} className="underline cursor-pointer">忘记密码</button></>}
          </p>
        </form>}

        {account && view === 'account' && <div className="space-y-4">
          <AccountPanel account={account} busy={busy} onLogout={() => run(async () => {
            await cloudbase.auth().signOut();
            setAccount(null);
            window.dispatchEvent(new Event('levihan-auth-changed'));
            switchView('login');
            setOpen(false);
            onShowToast('已退出登录');
          })} />
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const name = newNickname.trim();
              const invalid = validateNickname(name);
              if (invalid) throw new Error(invalid);
              await call('updateNickname', { nickname: name });
              setNewNickname('');
              await refresh();
              window.dispatchEvent(new Event('levihan-auth-changed'));
              onShowToast('昵称已更新，后续发布与评论将使用新昵称');
            });
          }} className="p-3 bg-[#FFF8E8] border-2 border-[#B99461]">
            <label className="block text-sm font-bold">修改统一昵称
              <div className="mt-2 flex gap-2">
                <input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} minLength={NICKNAME_MIN} maxLength={NICKNAME_MAX} placeholder={account.nickname} className="min-w-0 flex-1 p-2 bg-white border-2 border-[#8C6C47]" />
                <button disabled={busy || newNickname.trim().length < NICKNAME_MIN} className="px-3 bg-[#1E4334] text-[#F9E79F] font-bold disabled:opacity-50">保存</button>
              </div>
            </label>
            <p className="mt-2 text-xs text-[#7A6958]">此昵称会沿用到论坛帖子、评论及后续需要昵称的地方。</p>
          </form>
        </div>}
      </section>
    </div>, document.body)}
  </>;
};

const Submit = ({ children, busy }: { children: React.ReactNode; busy: boolean }) => <button type="submit" disabled={busy} className="w-full p-3 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-bold cursor-pointer disabled:opacity-50">{busy ? '处理中…' : children}</button>;

const AccountPanel = ({ account, busy, onLogout }: { account: Account; busy: boolean; onLogout: () => void }) => <div className="space-y-4">
  <dl className="grid grid-cols-2 border-2 border-[#8C6C47] text-center">
    <div className="p-2"><dt className="text-xs text-[#7A6958]">加入时间</dt><dd className="font-bold">{account.createdAt ? new Date(account.createdAt).toLocaleDateString('zh-CN') : '—'}</dd></div>
    <div className="p-2 border-l border-[#8C6C47]"><dt className="text-xs text-[#7A6958]">身份</dt><dd className="font-bold">{account.role === 'admin' ? '仓管' : '同好'}</dd></div>
  </dl>
  <button type="button" disabled={busy} onClick={onLogout} className="text-[#A93226] underline cursor-pointer disabled:opacity-50">退出登录</button>
</div>;
