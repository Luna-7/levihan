import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cloudbase } from '../utils/cloudbase';
import { UiSprite } from './UiSprite';

type View = 'login' | 'register' | 'keyRules' | 'account' | 'keyApply';
type SmsMode = 'login' | 'register';
type VerificationInfo = { verification_id: string; is_user: boolean };
type Account = { nickname: string; createdAt?: string; inviterNickname?: string; inviteQuota?: number; invites?: Array<{ code: string; status: string }> };
type Props = { onShowToast: (message: string) => void };

const phoneNumber = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (!/^1\d{10}$/.test(digits)) throw new Error('请输入正确的 11 位手机号');
  return `+86 ${digits}`;
};

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

export const UserEntry: React.FC<Props> = ({ onShowToast }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [keyCode, setKeyCode] = useState('');
  const [keyReady, setKeyReady] = useState(false);
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [verification, setVerification] = useState<VerificationInfo | null>(null);
  const [smsMode, setSmsMode] = useState<SmsMode>('login');
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
  const resetSms = () => { setSmsCode(''); setVerification(null); };
  const switchView = (next: View) => { resetSms(); setView(next); };
  const showEntry = () => { switchView(account ? 'account' : 'login'); setOpen(true); };

  useEffect(() => {
    const handleOpenRequest = () => showEntry();
    window.addEventListener('levihan-open-login', handleOpenRequest);
    return () => window.removeEventListener('levihan-open-login', handleOpenRequest);
  }, [account]);

  const sendSms = (mode: SmsMode) => {
    void run(async () => {
      if (mode === 'register') {
        if (!keyReady) throw new Error('请先验证粮仓钥匙');
        if (nickname.trim().length < 2) throw new Error('昵称至少需要 2 个字');
        await call('validateRegistrationInvite', { code: keyCode.trim().toUpperCase() });
      }
      const formatted = phoneNumber(phone);
      const info = await cloudbase.auth().getVerification({ phone_number: formatted });
      if (mode === 'login' && !info.is_user) throw new Error('该手机号尚未注册，请点击下方小字注册');
      if (mode === 'register' && info.is_user) throw new Error('该手机号已注册，请返回登录');
      setVerification(info);
      setSmsMode(mode);
      onShowToast('验证码已发送');
    });
  };

  const submitSms = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      if (!verification || smsMode !== (view === 'register' ? 'register' : 'login')) throw new Error('请先获取验证码');
      const formatted = phoneNumber(phone);
      await cloudbase.auth().signInWithSms({ verificationInfo: verification, verificationCode: smsCode.trim(), phoneNum: formatted });
      if (view === 'register') {
        try {
          await call('createUserProfile', { code: keyCode.trim().toUpperCase(), nickname: nickname.trim() });
        } catch (error) {
          await cloudbase.auth().signOut();
          throw error;
        }
      }
      await refresh();
      window.dispatchEvent(new Event('levihan-auth-changed'));
      setOpen(false);
      resetSms();
      onShowToast(view === 'register' ? '注册成功，欢迎加入利韩土豆仓' : '欢迎回到利韩土豆仓');
    });
  };

  const verifyKey = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await call('validateRegistrationInvite', { code: keyCode.trim().toUpperCase() });
      setKeyCode(result.code); setKeyReady(true); resetSms(); onShowToast('粮仓钥匙有效');
    });
  };

  const title = account ? (view === 'keyApply' ? '申请钥匙' : account.nickname) : view === 'register' ? '加入 LeviHan' : view === 'keyRules' ? '粮仓钥匙' : '欢迎回来';

  return <>
    <button type="button" onClick={showEntry} className="relative w-[108px] h-[39px] bg-transparent border-0 font-retro-jp text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap active:scale-95 transition-transform overflow-hidden" aria-label="打开用户入口">
      <UiSprite name="button-wide" width={108} className="absolute inset-0 pointer-events-none" />
      <span className="absolute top-[18px] bottom-0 left-2 right-8 flex items-center justify-center text-[#F9E79F] drop-shadow-[0_1px_1px_#1C1611]">{account?.nickname || '登录'}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[100] min-h-[100dvh] bg-black/65 flex items-center justify-center p-3 overflow-hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="LeviHan 用户入口" className="relative w-full max-w-md max-h-[88dvh] overflow-y-auto bg-[#FAF0D7] border-[3px] border-[#1C1611] shadow-[7px_7px_0_#1C1611] p-4 sm:p-5 text-[#2C241D] font-retro-jp">
        <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 w-8 h-8 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] cursor-pointer">×</button>
        <p className="font-pixel text-[10px] text-[#8C5828] tracking-widest mb-1">LEVIHAN MEMBER</p>
        <h2 className="font-pixel text-lg text-[#1E4334] mb-4 pr-10">{title}</h2>

        {!account && view === 'login' && <div>
          <SmsForm phone={phone} code={smsCode} verification={verification} busy={busy} onPhone={setPhone} onCode={setSmsCode} onSend={() => sendSms('login')} onSubmit={submitSms} submitText="登录" />
          <div className="mt-4 pt-3 border-t border-dashed border-[#B99A72] flex items-center justify-center gap-3 text-xs text-[#73583F]"><button type="button" onClick={() => { setKeyReady(false); switchView('register'); }} className="underline cursor-pointer">还没有账号？注册</button><span>·</span><button type="button" onClick={() => switchView('keyRules')} className="underline cursor-pointer">粮仓钥匙</button></div>
        </div>}

        {!account && view === 'register' && <div>
          {!keyReady ? <form onSubmit={verifyKey} className="space-y-3"><p className="text-sm leading-relaxed">注册需要一把有效的粮仓钥匙。</p><label className="block font-bold text-sm">粮仓钥匙<input value={keyCode} onChange={(e) => setKeyCode(e.target.value)} className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base uppercase outline-none focus:border-[#1E4334]" placeholder="LH-K82A" required /></label><Submit busy={busy}>验证钥匙</Submit></form> :
          <div className="space-y-3"><p className="p-2 bg-[#E8F2D3] border-2 border-[#718A43] text-[#36512D] font-bold">粮仓钥匙有效，可以创建账号</p><label className="block font-bold text-sm">昵称<input value={nickname} onChange={(e) => setNickname(e.target.value)} minLength={2} maxLength={20} required className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" /></label><SmsForm phone={phone} code={smsCode} verification={verification} busy={busy} onPhone={setPhone} onCode={setSmsCode} onSend={() => sendSms('register')} onSubmit={submitSms} submitText="创建账号" /></div>}
          <SmallBack onClick={() => switchView('login')}>已有账号？返回登录</SmallBack>
        </div>}

        {!account && view === 'keyRules' && <div className="space-y-3 text-sm leading-relaxed"><div className="p-3 bg-[#FFF8E8] border-2 border-[#B99461] space-y-2"><p className="font-bold text-[#4A2D16]">钥匙规则</p><p>粮仓钥匙是注册 LeviHan 的一次性邀请码，使用后即失效。</p><p>你可以加入利韩土豆群，或向已经加入粮仓的其他同好获取。</p><p>每位成员最多拥有两把钥匙，请把它交给真正喜欢利韩的同好。</p></div><button type="button" onClick={() => onShowToast('钥匙申请通道即将开放')} className="w-full p-3 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] font-bold cursor-pointer">钥匙</button><SmallBack onClick={() => switchView('login')}>返回登录</SmallBack></div>}

        {account && view === 'account' && <div className="space-y-4"><AccountPanel account={account} busy={busy} onApply={() => switchView('keyApply')} onLogout={() => run(async () => { await cloudbase.auth().signOut(); setAccount(null); window.dispatchEvent(new Event('levihan-auth-changed')); switchView('login'); setOpen(false); onShowToast('已退出登录'); })} /><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const name=newNickname.trim(); if(name.length<2) throw new Error('昵称至少需要 2 个字'); await call('updateNickname',{nickname:name}); setNewNickname(''); await refresh(); window.dispatchEvent(new Event('levihan-auth-changed')); onShowToast('昵称已更新，后续发布与评论将使用新昵称'); }); }} className="p-3 bg-[#FFF8E8] border-2 border-[#B99461]"><label className="block text-sm font-bold">修改统一昵称<div className="mt-2 flex gap-2"><input value={newNickname} onChange={(e)=>setNewNickname(e.target.value)} minLength={2} maxLength={20} placeholder={account.nickname} className="min-w-0 flex-1 p-2 bg-white border-2 border-[#8C6C47]"/><button disabled={busy||newNickname.trim().length<2} className="px-3 bg-[#1E4334] text-[#F9E79F] font-bold disabled:opacity-50">保存</button></div></label><p className="mt-2 text-xs text-[#7A6958]">此昵称会沿用到论坛帖子、评论及后续需要昵称的地方。</p></form></div>}
        {account && view === 'keyApply' && <div className="space-y-3"><div className="p-3 bg-[#FFF8E8] border-2 border-[#B99461] text-sm leading-relaxed"><p>每位成员最多拥有两把粮仓钥匙。申请后会从剩余额度中生成一把一次性钥匙。</p><p className="mt-2 font-bold">当前剩余：{account.inviteQuota ?? 0} 把</p></div><button type="button" disabled={busy || (account.inviteQuota ?? 0) < 1} onClick={() => run(async () => { await call('generateInviteCode'); await refresh(); switchView('account'); onShowToast('粮仓钥匙已生成'); })} className="w-full p-3 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] font-bold cursor-pointer disabled:opacity-50">申请一把钥匙</button><SmallBack onClick={() => switchView('account')}>返回账号信息</SmallBack></div>}
      </section>
    </div>, document.body)}
  </>;
};

const SmsForm = ({ phone, code, verification, busy, onPhone, onCode, onSend, onSubmit, submitText }: { phone:string; code:string; verification:VerificationInfo|null; busy:boolean; onPhone:(value:string)=>void; onCode:(value:string)=>void; onSend:()=>void; onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void; submitText:string }) => <form onSubmit={onSubmit} className="space-y-3">
  <label className="block font-bold text-sm">手机号<div className="mt-1 flex"><span className="flex items-center px-3 bg-[#E8D5B2] border-2 border-r-0 border-[#8C6C47] text-sm">+86</span><input value={phone} onChange={(e) => onPhone(e.target.value)} inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="请输入 11 位手机号" required className="min-w-0 flex-1 p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" /></div></label>
  <div className="flex gap-2"><label className="min-w-0 flex-1 font-bold text-sm">短信验证码<input value={code} onChange={(e) => onCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" required className="mt-1 w-full p-3 bg-[#FFFDF5] border-2 border-[#8C6C47] text-base outline-none focus:border-[#1E4334]" /></label><button type="button" onClick={onSend} disabled={busy || phone.length < 11} className="self-end h-[52px] px-3 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] text-sm font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap">{verification ? '重新发送' : '发送验证码'}</button></div>
  <Submit busy={busy}>{submitText}</Submit>
</form>;
const Submit = ({ children, busy }: {children:React.ReactNode;busy:boolean}) => <button disabled={busy} className="w-full p-3 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-bold cursor-pointer disabled:opacity-50">{busy?'处理中…':children}</button>;
const SmallBack = ({children,onClick}:{children:React.ReactNode;onClick:()=>void}) => <button type="button" onClick={onClick} className="block mx-auto mt-4 text-xs text-[#73583F] underline cursor-pointer">{children}</button>;
const AccountPanel = ({account,busy,onApply,onLogout}:{account:Account;busy:boolean;onApply:()=>void;onLogout:()=>void}) => <div className="space-y-4"><dl className="grid grid-cols-3 border-2 border-[#8C6C47] text-center"><div className="p-2"><dt className="text-xs text-[#7A6958]">加入时间</dt><dd className="font-bold">{account.createdAt ? new Date(account.createdAt).toLocaleDateString('zh-CN') : '—'}</dd></div><div className="p-2 border-x border-[#8C6C47]"><dt className="text-xs text-[#7A6958]">邀请人</dt><dd className="font-bold">{account.inviterNickname || '—'}</dd></div><div className="p-2"><dt className="text-xs text-[#7A6958]">钥匙名额</dt><dd className="font-bold">{account.inviteQuota ?? 0}</dd></div></dl><div className="flex items-center justify-between"><h3 className="font-bold">我的粮仓钥匙</h3><button type="button" disabled={busy} onClick={onApply} className="px-3 py-1.5 bg-[#4A2D16] text-[#F9E79F] border-2 border-[#1C1611] cursor-pointer">申请钥匙</button></div><div className="space-y-2">{account.invites?.length ? account.invites.map((item) => <div key={item.code} className="flex justify-between p-2 bg-[#FFFDF5] border border-[#8C6C47]"><code className="font-bold">{item.code}</code><span>{item.status==='unused'?'未使用':'已使用'}</span></div>) : <p className="text-sm text-[#7A6958]">尚未申请粮仓钥匙</p>}</div><button type="button" onClick={onLogout} className="text-[#A93226] underline cursor-pointer">退出登录</button></div>;
