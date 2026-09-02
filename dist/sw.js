// Service worker — (a) makes the app installable as a PWA, (b) shows
// LOCAL notifications via registration.showNotification() (the only way
// action buttons like "Class Ended" render), and (c) as of 2026-09-02,
// receives real Web Push messages from the server (api/notify-tick.js) and
// displays those too — this is the part that can fire with the app fully
// closed, since the browser wakes this worker up for an incoming push even
// with no page open. Still does NOT cache anything: no offline shell, no
// asset caching. That's deliberate — see fastTimetable/CLAUDE.md's PWA
// notes on cache-versioning risk; a non-caching SW can never serve stale
// content.

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

// Best-effort — tells the server to stop reminding about this session too,
// so a push notification's "End Class" tap works identically whether or not
// any tab/app is open. Failures are swallowed: the in-app suppression (via
// CLASS_ENDED below, when a page IS open) already covers the common case,
// and the next real tick will self-correct anyway once the session's actual
// end time passes.
const markEndedOnServer = async (key) => {
  if (!key) return;
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/mark-ended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint, key }),
    });
  } catch {
    // offline, or push was never set up on this device — ignore.
  }
};

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  notification.close();
  event.waitUntil(
    (async () => {
      if (action === 'ended') {
        await Promise.all([
          notifyClients({ type: 'CLASS_ENDED', key: notification.data?.key, tag: notification.tag }),
          markEndedOnServer(notification.data?.key),
        ]);
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

// Real Web Push messages from the server (api/notify-tick.js) — this is the
// handler that lets a notification appear with the app fully closed, since
// the browser wakes the service worker for an incoming push regardless.
// Payload shape matches api/_lib/notifyLogic.js's notification objects:
// { title, body, tag, data: { key }, actions? }.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FAST Timetable', body: event.data ? event.data.text() : '' };
  }

  const { title = 'FAST Timetable', body = '', tag, data, actions } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data,
      actions,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  const { notification } = event;
  event.waitUntil(
    notifyClients({ type: 'NOTIFICATION_CLOSED', key: notification.data?.key, tag: notification.tag })
  );
});
