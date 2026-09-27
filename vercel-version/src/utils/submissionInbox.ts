import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from './cloudbaseEndpoint';
import { getSessionToken } from './cloudbaseToken';

export type InboxReply = { id: string; body: string; repliedAt: string; subject?: string };

async function inboxRequest(action: string, fields: Record<string, unknown> = {}) {
  const token = getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST', headers, body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!response.ok || !result.ok) throw new Error(String(result.error || '云端收件箱暂时不可用'));
  return result;
}

export async function submitToInbox(
  action: 'submitNovel' | 'submitArtwork' | 'submitContact' | 'submitAnnouncement' | 'submitRecommend' | 'submitCustomOrderEmail',
  fields: Record<string, unknown>
) {
  const result = await inboxRequest(action, fields) as { ok?: boolean; id?: string; status?: 'pending' };
  return result as { ok: true; id: string; status: 'pending' };
}

export async function loadUnreadInboxReplies(): Promise<InboxReply[]> {
  const result = await inboxRequest('inboxReplyList');
  return Array.isArray(result.items) ? result.items as InboxReply[] : [];
}

export async function markInboxReplyRead(id: string): Promise<void> {
  await inboxRequest('inboxReplyRead', { id });
}
