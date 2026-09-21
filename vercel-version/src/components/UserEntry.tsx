import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthProfile } from '../utils/cloudbaseToken';
import { useAuthStore, type AuthQuestion } from '../stores/authStore';
import { UiSprite } from './UiSprite';

type View = 'login' | 'register' | 'quiz' | 'account';
type Props = { onShowToast: (message: string) => void };

/**
 * 注册 / 登录 / 答题 / 账号管理统一入口。
 * 后端是 auth 云函数（HTTP 访问服务），走自建会话 token（localStorage），
 * 不再依赖 CloudBase 内置 auth()。
 */

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

const validateNickname = (nickname: string) =>
  nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX
    ? `昵称需要 ${NICKNAME_MIN}–${NICKNAME_MAX} 个字`
    : null;

const validatePassword = (password: string) =>
  password.length < PASSWORD_MIN || password.length > PASSWORD_MAX
    ? `密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`
    : null;

/**
 * 从表单 DOM 读值，而不是只读 React state。
 * 浏览器密码管理器 / iCloud 钥匙串自动填充**不一定会触发 React 的 onChange**，
 * 只看 state 会拿到空串，于是「明明填了密码却报密码需要 6–64 位」。
 * FormData 读的是输入框的真实当前值，自动填充也在内。
 */
const readField = (form: HTMLFormElement, name: string, fallback: string) => {
  const value = new FormData(form).get(name);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

export const UserEntry: React.FC<Props> = ({ onShowToast }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('login');
  const account = useAuthStore((state) => state.profile);
  const busy = useAuthStore((state) => state.isBusy);
  const requestChallenge = useAuthStore((state) => state.requestChallenge);
  const answerChallenge = useAuthStore((state) => state.answerChallenge);
  const registerAccount = useAuthStore((state) => state.register);
  const loginAccount = useAuthStore((state) => state.login);
  const logoutAccount = useAuthStore((state) => state.logout);
  const changeNickname = useAuthStore((state) => state.updateNickname);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newNickname, setNewNickname] = useState('');

  // 答题态
  const [question, setQuestion] = useState<AuthQuestion | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [answer, setAnswer] = useState('');
  const [ticket, setTicket] = useState('');

  /**
   * 注册凭据的「保险箱」。
   * 第一步（继续·答题验证）到第三步（完成注册）之间隔着答题页，
   * 密码只存在 state 里的话，任何一次视图切换/清空都会让它静默丢失，
   * 表现为答完题点「完成注册」时服务端收到空密码 → 报「密码需要 6–64 位」。
   * 放 ref 里，clearSecrets / switchView 都动不到它。
   */
  const pendingRegister = useRef<{ nickname: string; password: string } | null>(null);

  const run = async (task: () => Promise<void>) => {
    if (useAuthStore.getState().isBusy) return;
    try { await task(); }
    catch (error) { onShowToast(errorMessage(error)); }
  };

  const clearSecrets = () => { setPassword(''); setConfirmPassword(''); setAnswer(''); };
  const switchView = (next: View) => { clearSecrets(); setView(next); };
  // 重新打开入口 = 重新开始，凭据保险箱一并清空（不把密码留在内存里）
  const showEntry = () => { pendingRegister.current = null; switchView(account ? 'account' : 'login'); setOpen(true); };

  useEffect(() => {
    const handleOpenRequest = () => showEntry();
    window.addEventListener('levihan-open-login', handleOpenRequest);
    return () => window.removeEventListener('levihan-open-login', handleOpenRequest);
  }, [account]);

  /** 注册第一步：发起答题挑战（值从表单 DOM 读，兼容密码管理器自动填充） */
  const startRegister = (form: HTMLFormElement) => {
    const name = readField(form, 'nickname', nickname).trim();
    const pw = readField(form, 'password', password);
    const confirm = readField(form, 'confirmPassword', confirmPassword);
    void run(async () => {
      const invalid = validateNickname(name) || validatePassword(pw);
      if (invalid) throw new Error(invalid);
      if (pw !== confirm) throw new Error('两次输入的密码不一致');
      const result = await requestChallenge();
      // 存进保险箱：答题页不持有密码，答完后靠它完成注册
      pendingRegister.current = { nickname: name, password: pw };
      setNickname(name);
      setQuestion(result.question);
      setChallengeId(result.challengeId);
      setTicket('');
      // 只切视图，不清密码 —— 答题后 confirmRegister 还要用 nickname/password
      setView('quiz');
    });
  };

  /** 注册第二步：提交答案 */
  const submitAnswer = () => {
    void run(async () => {
      const trimmed = answer.trim();
      if (!trimmed) throw new Error('请先作答');
      const result = await answerChallenge(challengeId, trimmed);
      if (result.correct) {
        setTicket(result.ticket || '');
      } else {
        // 答错：若非耗尽，可重试；耗尽则触发冷却，回到登录页
        onShowToast(result.message || '答案不正确');
        if (result.exhausted) { pendingRegister.current = null; switchView('login'); }
        else { setAnswer(''); }
      }
    });
  };

  /** 注册第三步：答对后凭票据 + 昵称 + 密码正式注册 */
  const confirmRegister = () => {
    void run(async () => {
      const saved = pendingRegister.current;
      const name = (saved?.nickname || nickname).trim();
      const pw = saved?.password || password;
      if (!name) throw new Error('昵称已丢失，请点「返回修改昵称密码」重新填写');
      if (!pw) throw new Error('密码已丢失，请点「返回修改昵称密码」重新填写');
      await registerAccount(ticket, name, pw);
      pendingRegister.current = null;
      clearSecrets();
      setOpen(false);
      onShowToast('注册成功，欢迎加入利韩土豆仓');
    });
  };

  const login = (form: HTMLFormElement) => {
    const name = readField(form, 'nickname', nickname).trim();
    const pw = readField(form, 'password', password);
    void run(async () => {
      const invalid = validateNickname(name) || validatePassword(pw);
      if (invalid) throw new Error(invalid);
      await loginAccount(name, pw);
      clearSecrets();
      setOpen(false);
      onShowToast('欢迎回到利韩土豆仓');
    });
  };

  const logout = () => {
    void run(async () => {
      await logoutAccount();
      pendingRegister.current = null;
      switchView('login');
      setOpen(false);
      onShowToast('已退出登录');
    });
  };

  const updateNickname = () => {
    void run(async () => {
      const name = newNickname.trim();
      const invalid = validateNickname(name);
      if (invalid) throw new Error(invalid);
      await changeNickname(name);
      setNewNickname('');
      onShowToast('昵称已更新，后续发布与评论将使用新昵称');
    });
  };

  const title = account ? account.nickname : view === 'register' ? '加入 LeviHan' : view === 'quiz' ? '入门答题' : '欢迎回来';

  return <>
    {account ? (
      <button type="button" onClick={showEntry} className="relative w-[80px] h-[29px] bg-transparent border-0 font-retro-jp text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap active:scale-95 transition-transform overflow-hidden" aria-label="打开用户入口">
        <UiSprite name="button-wide" width={80} className="absolute inset-0 pointer-events-none" />
        <span className="absolute top-[13px] bottom-0 left-1.5 right-6 flex items-center justify-center text-[#F9E79F] drop-shadow-[0_1px_1px_#1C1611]">{account.nickname}</span>
      </button>
    ) : (
      <button type="button" onClick={showEntry} className="bg-transparent border-0 cursor-pointer active:scale-95 transition-transform p-0" aria-label="打开用户入口">
        <UiSprite name="login-key" width={72} role="img" label="登录" className="pointer-events-none drop-shadow-md" />
      </button>
    )}
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[100] min-h-[var(--app-h)] bg-black/65 flex items-center justify-center p-3 overflow-hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="LeviHan 用户入口" className="relative w-full max-w-md max-h-[88dvh] overflow-y-auto bg-[#FAF0D7] border-[3px] border-[#1C1611] shadow-[7px_7px_0_#1C1611] p-4 sm:p-5 text-[#2C241D] font-retro-jp">
        <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 w-8 h-8 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] cursor-pointer z-20">×</button>
        <p className="font-pixel text-[10px] text-[#8C5828] tracking-widest mb-1">LEVIHAN MEMBER</p>
        <h2 className="font-pixel text-lg text-[#1E4334] mb-4 pr-10">{title}</h2>

        {!account && view === 'login' && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); login(e.currentTarget); }}>
          <label className="block font-bold text-sm">昵称
            <input name="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" minLength={NICKNAME_MIN} maxLength={NICKNAME_MAX} required placeholder={`${NICKNAME_MIN}–${NICKNAME_MAX} 个字`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <label className="block font-bold text-sm">密码
            <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required placeholder={`至少 ${PASSWORD_MIN} 位`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <Submit busy={busy}>登录</Submit>
          <p className="pt-1 text-center text-xs text-[#73583F]">
            <button type="button" onClick={() => switchView('register')} className="underline cursor-pointer">还没有账号？注册</button><span className="px-2">·</span><button type="button" onClick={() => onShowToast('暂时不支持找回密码，请重新注册一个昵称')} className="underline cursor-pointer">忘记密码</button>
          </p>
        </form>}

        {!account && view === 'register' && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); startRegister(e.currentTarget); }}>
          <label className="block font-bold text-sm">昵称
            <input name="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" minLength={NICKNAME_MIN} maxLength={NICKNAME_MAX} required placeholder={`${NICKNAME_MIN}–${NICKNAME_MAX} 个字`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <label className="block font-bold text-sm">密码
            <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required placeholder={`至少 ${PASSWORD_MIN} 位`} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <label className="block font-bold text-sm">确认密码
            <input name="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" />
          </label>
          <Submit busy={busy}>继续（答题验证）</Submit>
          <p className="pt-1 text-center text-xs text-[#73583F]">
            <button type="button" onClick={() => switchView('login')} className="underline cursor-pointer">已有账号？返回登录</button>
          </p>
        </form>}

        {!account && view === 'quiz' && question && !ticket && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submitAnswer(); }}>
          <p className="text-sm text-[#73583F]">答对这道题才能完成注册（3 次机会）：</p>
          <p className="p-3 bg-[#FFF8E8] border-2 border-[#B99461] font-bold text-[#1E4334]">{question.prompt}</p>
          <div className="space-y-2">
            {question.options.map((opt) => (
              <label key={opt} className={`flex items-center gap-2 p-2 border-2 cursor-pointer ${answer === opt ? 'border-[#1E4334] bg-[#FFF8E8]' : 'border-[#8C6C47] bg-white'}`}>
                <input type="radio" name="quiz-option" value={opt} checked={answer === opt} onChange={() => setAnswer(opt)} className="accent-[#1E4334]" />
                <span>{opt}</span>
              </label>
            ))}
          </div>
          <Submit busy={busy}>提交答案</Submit>
          <button type="button" onClick={() => { setAnswer(''); setView('register'); }} className="w-full text-center text-xs text-[#73583F] underline cursor-pointer">返回修改昵称密码</button>
        </form>}

        {!account && view === 'quiz' && ticket && <div className="space-y-3">
          <p className="p-3 bg-[#EAF5E4] border-2 border-[#3B6D11] text-[#1E4334] font-bold">答对了！</p>
          <Submit busy={busy} onClick={confirmRegister}>完成注册</Submit>
        </div>}

        {account && view === 'account' && <div className="space-y-4">
          <AccountPanel account={account} busy={busy} onLogout={logout} />
          <form onSubmit={(e) => { e.preventDefault(); updateNickname(); }} className="p-3 bg-[#FFF8E8] border-2 border-[#B99461]">
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

const Submit = ({ children, busy, onClick }: { children: React.ReactNode; busy: boolean; onClick?: () => void }) => (
  <button type="submit" disabled={busy} onClick={onClick} className="w-full p-3 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-bold cursor-pointer disabled:opacity-50">{busy ? '处理中…' : children}</button>
);

const AccountPanel = ({ account, busy, onLogout }: { account: AuthProfile; busy: boolean; onLogout: () => void }) => <div className="space-y-4">
  <dl className="grid grid-cols-2 border-2 border-[#8C6C47] text-center">
    <div className="p-2"><dt className="text-xs text-[#7A6958]">加入时间</dt><dd className="font-bold">{account.createdAt ? new Date(account.createdAt).toLocaleDateString('zh-CN') : '—'}</dd></div>
    <div className="p-2 border-l border-[#8C6C47]"><dt className="text-xs text-[#7A6958]">身份</dt><dd className="font-bold">{account.role === 'admin' ? '仓管' : '同好'}</dd></div>
  </dl>
  <button type="button" disabled={busy} onClick={onLogout} className="text-[#A93226] underline cursor-pointer disabled:opacity-50">退出登录</button>
</div>;
