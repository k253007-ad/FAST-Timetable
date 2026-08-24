// Minimal service worker — exists ONLY to (a) make the app installable as a
// PWA and (b) show notifications via registration.showNotification(), which
// is the only way action buttons (e.g. "Class Ended") render in supporting
// browsers. It does NOT cache anything: no offline shell, no asset caching.
// That's deliberate — see fastTimetable/CLAUDE.md's PWA notes on
// cache-versioning risk; a non-caching SW can never serve stale content.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op passthrough — required for some browsers' installability checks,
// but we never intercept or cache the response.
self.addEventListener('fetch', () => {});

const notifyClients = async (message) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
  return clients;
};

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  notification.close();
  event.waitUntil(
    (async () => {
      if (action === 'ended') {
        await notifyClients({ type: 'CLASS_ENDED', key: notification.data?.key, tag: notification.tag });
      }
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.length > 0) {
        clients[0].focus();
      } else if (self.clients.openWindow) {
        self.clients.openWindow('/');
      }
    })()
  );
});

self.addEventListener('notificationclose', (event) => {
  const { notification } = event;
  event.waitUntil(
    notifyClients({ type: 'NOTIFICATION_CLOSED', key: notification.data?.key, tag: notification.tag })
  );
});
