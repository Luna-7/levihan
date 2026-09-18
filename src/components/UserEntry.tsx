import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthenticatedUser, RegistrationChallengeResponse } from '../shared/contracts/api';
import { answerRegistrationChallenge, createRegistrationChallenge, getMe, login, logout, recover, register, type MeResponse } from '../features/auth/api';
import { UiSprite } from './UiSprite';

type View = 'login' | 'quiz' | 'register' | 'recover' | 'recovery-code' | 'account';
type Props = { onShowToast: (message: string) => void };

const errorMessage = (error: unknown) => error instanceof Error && error.message ? error.message : '操作失败，请稍后重试';
const accountFromMe = (value: MeResponse): AuthenticatedUser => ({ ...value.user, role: value.role, capabilities: value.capabilities, ageConsent: value.ageConsent });

export const UserEntry: React.FC<Props> = ({ onShowToast }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('login');
  const [account, setAccount] = useState<AuthenticatedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<RegistrationChallengeResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [ticket, setTicket] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<AuthenticatedUser | null>(null);

  useEffect(() => { void getMe().then((value) => setAccount(accountFromMe(value))).catch(() => setAccount(null)); }, []);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (error) { onShowToast(errorMessage(error)); } finally { setBusy(false); }
  };
  const showEntry = () => { setView(account ? 'account' : 'login'); setOpen(true); };

  useEffect(() => {
    const handleOpenRequest = () => showEntry();
    window.addEventListener('levihan-open-login', handleOpenRequest);
    return () => window.removeEventListener('levihan-open-login', handleOpenRequest);
  }, [account]);

  const beginRegistration = () => void run(async () => {
    const created = await createRegistrationChallenge();
    setChallenge(created); setAnswer(''); setTicket(''); setView('quiz');
  });
  const submitAnswer = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!challenge) throw new Error('请重新获取题目');
      const result = await answerRegistrationChallenge(challenge.challengeId, answer);
      setTicket(result.registrationTicket); setView('register');
    });
  };
  const submitRegistration = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await register({ registrationTicket: ticket, username, password });
      setPendingAccount({ id: result.userId, username: result.username, role: 'member', capabilities: ['comment', 'favorite', 'submit'], ageConsent: null });
      setRecoveryCode(result.recoveryCode); setRecoverySaved(false); setPassword(''); setView('recovery-code');
    });
  };
  const submitLogin = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await login({ username, password });
      setAccount(result.user); setPassword(''); setOpen(false); window.dispatchEvent(new Event('levihan-auth-changed')); onShowToast('欢迎回到利韩土豆仓');
    });
  };
  const submitRecovery = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await recover({ recoveryCode: recoveryInput.trim().toUpperCase(), newPassword });
      setPendingAccount(result.user); setRecoveryCode(result.recoveryCode); setRecoverySaved(false); setRecoveryInput(''); setNewPassword(''); setView('recovery-code');
    });
  };
  const enterAccount = () => {
    if (!recoverySaved || !pendingAccount) return;
    setAccount(pendingAccount); setPendingAccount(null); setRecoveryCode(''); setView('account');
    window.dispatchEvent(new Event('levihan-auth-changed')); onShowToast('恢复码已确认保存');
  };

  const title = view === 'quiz' ? '入口答题' : view === 'register' ? '创建账号' : view === 'recover' ? '恢复账号' : view === 'recovery-code' ? '保存恢复码' : account ? account.username : '欢迎回来';

  return <>
    <button type="button" onClick={showEntry} className="relative w-[108px] h-[39px] bg-transparent border-0 font-retro-jp text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap active:scale-95 transition-transform overflow-hidden" aria-label="打开用户入口">
      <UiSprite name="button-wide" width={108} className="absolute inset-0 pointer-events-none" />
      <span className="absolute top-[18px] bottom-0 left-2 right-8 flex items-center justify-center text-[#F9E79F] drop-shadow-[0_1px_1px_#1C1611]">{account?.username || '登录'}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[100] min-h-[100dvh] bg-black/65 flex items-center justify-center p-3 overflow-hidden" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="LeviHan 用户入口" className="relative w-full max-w-md max-h-[88dvh] overflow-y-auto bg-[#FAF0D7] border-[3px] border-[#1C1611] shadow-[7px_7px_0_#1C1611] p-4 sm:p-5 text-[#2C241D] font-retro-jp">
        <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 w-8 h-8 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] cursor-pointer">×</button>
        <p className="font-pixel text-[10px] text-[#8C5828] tracking-widest mb-1">LEVIHAN MEMBER</p>
        <h2 className="font-pixel text-lg text-[#1E4334] mb-4 pr-10">{title}</h2>

        {!account && view === 'login' && <>
          <CredentialForm username={username} password={password} busy={busy} onUsername={setUsername} onPassword={setPassword} onSubmit={submitLogin} submitText="登录" />
          <div className="mt-4 pt-3 border-t border-dashed border-[#B99A72] flex items-center justify-center gap-3 text-xs text-[#73583F]"><button type="button" onClick={beginRegistration} className="underline cursor-pointer">注册账号</button><span>·</span><button type="button" onClick={() => setView('recover')} className="underline cursor-pointer">使用恢复码</button></div>
        </>}

        {!account && view === 'quiz' && challenge && <form onSubmit={submitAnswer} className="space-y-3">
          <p className="text-sm leading-relaxed">{challenge.prompt}</p>
          <div className="space-y-2">{challenge.options.map((option) => <label key={option} className="flex items-center gap-2 p-3 bg-[#FFFDF5] border-2 border-[#B99461] cursor-pointer"><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} required />{option}</label>)}</div>
          <Submit busy={busy} disabled={!answer}>提交答案</Submit><SmallBack onClick={() => setView('login')}>返回登录</SmallBack>
        </form>}

        {!account && view === 'register' && <><p className="mb-3 text-sm text-[#36512D]">答题通过，请设置用户名和密码。</p><CredentialForm username={username} password={password} busy={busy} onUsername={setUsername} onPassword={setPassword} onSubmit={submitRegistration} submitText="创建账号" /></>}

        {!account && view === 'recover' && <form onSubmit={submitRecovery} className="space-y-3"><Field label="恢复码" value={recoveryInput} onChange={setRecoveryInput} autoComplete="off" /><Field label="新密码" value={newPassword} onChange={setNewPassword} type="password" minLength={12} autoComplete="new-password" /><Submit busy={busy}>重置密码</Submit><SmallBack onClick={() => setView('login')}>返回登录</SmallBack></form>}

        {view === 'recovery-code' && <div className="space-y-4">
          <p className="text-sm leading-relaxed">这是唯一一次显示的恢复码。如果同时丢失密码和恢复码，账号将无法找回。</p>
          <code className="block p-3 text-center text-lg font-bold tracking-wider bg-[#FFFDF5] border-2 border-[#8C6C47] select-all">{recoveryCode}</code>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} className="mt-1" />我已安全保存恢复码</label>
          <button type="button" disabled={!recoverySaved} onClick={enterAccount} className="w-full p-3 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-bold cursor-pointer disabled:opacity-50">我已保存，进入账号</button>
        </div>}

        {account && view === 'account' && <div className="space-y-4"><div className="p-3 bg-[#FFF8E8] border-2 border-[#B99461]"><p className="font-bold">{account.username}</p><p className="mt-1 text-xs text-[#7A6958]">{account.role === 'admin' ? '管理员' : '成员'}</p></div><button type="button" disabled={busy} onClick={() => void run(async () => { await logout(); setAccount(null); setView('login'); setOpen(false); window.dispatchEvent(new Event('levihan-auth-changed')); onShowToast('已退出登录'); })} className="text-[#A93226] underline cursor-pointer disabled:opacity-50">退出登录</button></div>}
      </section>
    </div>, document.body)}
  </>;
};

type CredentialFormProps = {
  username: string;
  password: string;
  busy: boolean;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  submitText: string;
};
const CredentialForm = (props: CredentialFormProps) => {
  const { username, password, busy, onUsername, onPassword, onSubmit, submitText } = props;
  let passwordAutocomplete = 'new-password';
  if (submitText === '登录') passwordAutocomplete = 'current-password';
  return <form onSubmit={onSubmit} className="space-y-3">
    <Field label="用户名" value={username} onChange={onUsername} minLength={3} maxLength={32} autoComplete="username" />
    <Field label="密码" value={password} onChange={onPassword} type="password" minLength={12} maxLength={128} autoComplete={passwordAutocomplete} />
    <Submit busy={busy}>{submitText}</Submit>
  </form>;
};
const Field = ({ label, value, onChange, type = 'text', ...input }: { label: string; value: string; onChange: (value: string) => void; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) => <label className="block font-bold text-sm">{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} type={type} required {...input} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" /></label>;
const Submit = ({ children, busy, disabled = false }: { children: React.ReactNode; busy: boolean; disabled?: boolean }) => <button disabled={busy || disabled} className="w-full p-3 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-bold cursor-pointer disabled:opacity-50">{busy ? '处理中…' : children}</button>;
const SmallBack = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button type="button" onClick={onClick} className="block mx-auto mt-4 text-xs text-[#73583F] underline cursor-pointer">{children}</button>;
