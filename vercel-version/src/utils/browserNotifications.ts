const PERMISSION_KEY = 'levihan.browser-notifications.v1';

export const truncateNotificationText = (value: string, maxLength = 48): string => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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
