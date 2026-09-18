import React, { useState } from 'react';
import { acceptAgeConsent, getRestrictedAccess, type RestrictedAccessResponse } from './api';

type Props = {
  workId: string;
  policyVersion: string;
  warning: string;
  onGranted: (access: RestrictedAccessResponse) => void;
  onDenied?: (errorCode: string) => void;
};

const SAFE_MESSAGES: Record<string, string> = {
  STATE_CONFLICT: '内容规则已更新，请刷新后重新确认', AUTH_REQUIRED: '请先登录', SESSION_EXPIRED: '请先登录',
  AGE_CONSENT_REQUIRED: '需要重新确认年龄声明', ACCESS_DENIED: '当前账号无法访问此内容', NOT_FOUND: '内容已下架或不存在',
};

export function AgeGate({ workId, policyVersion, warning, onGranted, onDenied }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const proceed = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setMessage('');
    onDenied?.('PENDING');
    try {
      await acceptAgeConsent(policyVersion);
      const access = await getRestrictedAccess(workId);
      // Signed URLs are passed to the reader in memory only.
      onGranted(access);
    } catch (error) {
      const code = error && typeof error === 'object' && 'errorCode' in error ? String(error.errorCode) : 'INTERNAL_ERROR';
      onDenied?.(code);
      setMessage(SAFE_MESSAGES[code] || '暂时无法访问，请稍后重试');
    } finally { setBusy(false); }
  };
  return <section aria-label="成人内容确认" className="space-y-4">
    <h2 className="text-lg font-semibold">成人内容警告</h2>
    <p>{warning}</p>
    <p className="text-sm">此确认只是年满 18 岁的自我声明，不是实名年龄核验，也不替代所在地法律、版权授权或平台规则。</p>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已年满18岁并接受当前内容警告</label>
    {message && <p role="alert">{message}</p>}
    <button type="button" disabled={!confirmed || busy} onClick={proceed}>{busy ? '处理中…' : '确认并继续'}</button>
  </section>;
}
