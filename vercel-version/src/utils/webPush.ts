import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from './cloudbaseEndpoint';

// VAPID 公钥本来就会随订阅请求发送给浏览器；保留环境变量覆盖，生产构建没有额外配置时也能工作。
const PUBLIC_KEY = String(
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BFL95lRhUzXe3H5bR4wn6PYdS6yDSWCuITi1wpYtgCblCNr89H2fbbfLuma8y0wCkIPESXifHyJVTyyExpR5f2A',
).trim();

export type WebPushState = 'unsupported' | 'default' | 'granted' | 'denied';

export function webPushSupported() {
  return Boolean(
    PUBLIC_KEY &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window,
  );
}

export function webPushPermission(): WebPushState {
  if (!webPushSupported()) return 'unsupported';
  return Notification.permission;
}

function decodeKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function enableWebPush(): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported';
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(PUBLIC_KEY),
  });
  const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action: 'pushSubscribe', subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new Error('推送订阅保存失败');
  return 'granted';
}
