// Service worker — (a) makes the app installable as a PWA, (b) shows
// LOCAL notifications via registration.showNotification() (the only way
// action buttons like "Class Ended" render), (c) as of 2026-09-02, receives
// real Web Push messages from the server (api/notify-tick.js) and displays
// those too — this is the part that can fire with the app fully closed,
// since the browser wakes this worker up for an incoming push even with no
// page open — and (d) as of 2026-09-14, caches the app SHELL only (see
// below) to fix a real "PWA takes long to open" report.

// ---------- App-shell cache (2026-09-14) ----------
// Deliberately narrow and versioned — this project's own standing rule was
// "a non-caching SW can never serve stale content," which was true but had
// a real cost nobody had measured: with zero caching, even an INSTALLED
// home-screen PWA has to redownload the entire JS/CSS bundle over the
// network before React can so much as paint a loading skeleton, every
// single open. That's the actual root cause behind a direct report ("the
// pwa is taking long to open, another student made a pwa and it loads
// instantly") — a competing PWA that "loads instantly" almost certainly
// has exactly this kind of shell cache.
//
// Scope is deliberately narrow: ONLY same-origin GET requests for the app
// shell itself (the HTML page, the built /assets/*.js|css, icons,
// manifest) ever touch this cache. `/api/*` and any cross-origin request
// (the live Google Sheets data this app's whole purpose depends on being
// fresh) are explicitly excluded below and always go straight to the
// network, untouched — this cache has nothing to do with, and can never
// make stale, the actual timetable data (that has its own separate,
// render-layer "show cached last-known data instantly, then quietly
// refresh" mechanism in App.jsx's `getCachedTimetableSnapshot`, which is
// unrelated to this cache and works even in a browser tab with no SW at
// all).
//
// Strategy is stale-while-revalidate, not cache-first-forever: a cached
// shell response is returned immediately if one exists (this is what makes
// the next open instant), but EVERY request — hit or miss — also kicks off
// a real network fetch that updates the cache for the *next* load. That
// bounds the staleness risk to "one generation behind for a single load
// right after a new version deploys," the same accepted tradeoff behind
// every standard "instant-loading" PWA shell cache (this is the exact
// pattern Workbox calls StaleWhileRevalidate) — never "silently stuck on
// old code forever," which is what the original hard-constraint note was
// actually worried about. `CACHE_NAME` carries an explicit version so
// `activate` can delete any previous version's entries outright instead of
// accumulating them across deploys.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `fast-timetable-shell-${CACHE_VERSION}`;

// `registerServiceWorker()` (src/utils/notifications.js) runs unconditionally
// in both `npm run dev` and production — there's no dev/prod flag available
// inside this file (public/ is copied verbatim by Vite, no env-var
// substitution, same reason the VAPID key below is hardcoded rather than
// read from import.meta.env). Without this guard, the shell cache below
// would also intercept and cache Vite's own dev-server module responses —
// actively wrong there: dev relies on every edit being reflected on the
// next reload via HMR/a fresh fetch, and a cached stale module would look
// exactly like a real, confusing bug while iterating. `npm run dev` always
// serves from localhost, real deployments never do, so this is a reliable,
// standard way to tell the two apart from inside the SW itself.
const IS_DEV_HOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('fast-timetable-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (IS_DEV_HOST) return; // see IS_DEV_HOST's own comment above

  const { request } = event;
  // Never intercept anything but a plain GET — every other request this
  // app makes (api/subscribe, api/mark-ended, ... all POST) must reach the
  // network untouched regardless.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin: the live Google Sheets gviz endpoints, FCM, etc. — always
  // network, never cached, no exceptions.
  if (url.origin !== self.location.origin) return;
  // This app's own API routes — the timetable/roll-number metadata and any
  // push-related GETs must always be fetched fresh; caching these here
  // would silently reintroduce exactly the staleness this cache is
  // designed never to cause. (The actual instant-first-paint behavior for
  // this data lives at the render layer instead — see the big comment
  // above.)
  if (url.pathname.startsWith('/api/')) return;
  // New-deploy check (src/utils/autoUpdate.js) must always see the real
  // server index.html, never the cached one.
  if (url.searchParams.has('__check')) return;

  // Everything else same-origin GET is the app shell itself — stale-while-
  // revalidate: serve from cache immediately if present, always also
  // refetch over the network in the background (via event.waitUntil, so
  // the SW isn't killed before that background update finishes) to keep
  // the cache current for the *next* open.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      const revalidate = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      event.waitUntil(revalidate);

      return cached || (await revalidate) || Response.error();
    })()
  );
});

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
