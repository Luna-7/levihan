/* Web Push 的后台展示层。由 vite-plugin-pwa 生成的主 Service Worker importScripts 引入。 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text() || '' }; }
  const title = String(data.title || '利韩土豆仓');
  const options = {
    body: String(data.body || '有新的内容更新'),
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: String(data.tag || 'levihan-update'),
    renotify: true,
    data: { url: String(data.url || '/') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
