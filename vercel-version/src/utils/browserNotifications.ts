const PERMISSION_KEY = 'levihan.browser-notifications.v1';

export const truncateNotificationText = (value: string, maxLength = 48): string => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

/** 原生通知卡片的正文统一格式：正文最多三行，避免挤占标题层级。 */
export const formatNotificationBody = (value: string, allowLong = false): string => {
  const text = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (allowLong) return text;
  const lines = text.split('\n').filter(Boolean).slice(0, 3);
  const clipped = lines.join('\n');
  const sourceLength = text.length > clipped.length ? 1 : 0;
  const maxChars = 120;
  const compact = clipped.length > maxChars
    ? `${clipped.slice(0, maxChars - 1)}…`
    : clipped;
  return `${compact}${sourceLength && !compact.endsWith('…') ? '…' : ''}`.trim();
};

export const browserNotificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

export const browserNotificationPermission = (): NotificationPermission | 'unsupported' =>
  browserNotificationsSupported() ? Notification.permission : 'unsupported';

export async function requestBrowserNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    try { window.localStorage.setItem(PERMISSION_KEY, 'granted'); } catch { /* storage fallback */ }
  }
  return permission;
}

export function notifyBrowser(title: string, options: NotificationOptions & { dedupeKey?: string } = {}): void {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  const { dedupeKey, ...notificationOptions } = options;
  if (dedupeKey) {
    try {
      const key = `levihan.browser-notifications.seen.${dedupeKey}`;
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, '1');
    } catch { /* storage fallback */ }
  }
  try { new Notification(title, notificationOptions); } catch { /* permission changed between checks */ }
}
