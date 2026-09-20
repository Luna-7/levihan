import { ADMIN_UPLOAD_ENDPOINT } from './cloudbaseEndpoint';

export async function submitToInbox(
  action: 'submitNovel' | 'submitContact' | 'submitAnnouncement' | 'submitRecommend',
  fields: Record<string, unknown>
) {
  const response = await fetch(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; id?: string; status?: 'pending' };
  if (!response.ok || !result.ok) throw new Error(result.error || '云端收件箱暂时不可用');
  return result as { ok: true; id: string; status: 'pending' };
}
