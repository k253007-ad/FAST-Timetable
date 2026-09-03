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

// Public VAPID key — NOT secret, it ships in every page load anyway (see
// import.meta.env.VITE_VAPID_PUBLIC_KEY in src/utils/notifications.js).
// Duplicated here because public/ is copied verbatim by Vite with no
// env-var substitution, so a service worker script has no other way to see
// it. If the VAPID key pair is ever rotated, this MUST be updated to match
// — otherwise the resubscribe below (pushsubscriptionchange) will silently
// fail forever on every device that needs it.
const VAPID_PUBLIC_KEY = 'BFYCjHPcxx2j7f68cSLrMKPuozxyeZEell3hZMA4rTk6rfIJgxiueirlaKvw4S3GSNuVyl-l-r89JlME7iZqAzg';

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

// Browsers occasionally invalidate/rotate a device's push subscription on
// their own (Chrome does this periodically for security) — entirely
// outside the app's control, and it can happen at any time, including
// while the app is fully closed, which is exactly when a silent failure
// here would be worst (the device would just go dark until someone
// happened to reopen the app). Re-subscribes immediately and tells the
// server to migrate the old schedule over to the new endpoint (see
// api/subscribe.js's oldEndpoint handling), all without needing any page
// open at all.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription?.endpoint;
      try {
        const newSubscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          }));
        await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSubscription, oldEndpoint }),
        });
      } catch (err) {
        // Nothing more can be done from here — no page is necessarily open
        // to retry from. The device stops receiving pushes until the app
        // is reopened and its own subscribe flow runs again.
        console.error('pushsubscriptionchange: resubscribe failed', err);
      }
    })()
  );
});

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
      // Several distinct checkpoints share a tag (e.g. the 15-min and 5-min
      // "ending soon" reminders both use 'ending-soon') — without renotify,
      // the second one would silently replace the first on screen with no
      // re-alert (no sound/vibration), meaning a student who already
      // glanced at and dismissed the first could miss the second entirely.
      renotify: true,
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
