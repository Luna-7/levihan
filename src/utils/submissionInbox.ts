const ENDPOINT = 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload';

export async function submitToInbox(action: 'submitNovel' | 'submitTreehole', fields: Record<string, unknown>) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || '云端收件箱暂时不可用');
  return result as { ok: true; id: string; status: 'pending' };
}
