self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Напоминание', body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Напоминание', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    requireInteraction: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { await c.focus(); c.navigate?.(url); return; }
    await self.clients.openWindow(url);
  })());
});
