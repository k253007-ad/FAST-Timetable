// Service-worker-backed local notifications for the now/next class timer.
// No backend/push server — see fastTimetable/CLAUDE.md's notification notes:
// these only fire while the app is open or backgrounded (tab/PWA process
// alive), driven by a client-side timer in App.jsx. The service worker
// exists solely so notification ACTION BUTTONS render (only supported via
// ServiceWorkerRegistration.showNotification, not the plain Notification
// constructor) — it does no caching, see public/sw.js.

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (canNotify() ? Notification.permission : 'unsupported');

export const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return null;
  }
};

export const requestNotificationPermission = async () => {
  if (!canNotify()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
};

// applicationServerKey wants a raw Uint8Array, not the base64url string
// VAPID keys are normally handed around as.
const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

export const isPushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/**
 * Sends the Main profile's current selection to the server so
 * api/notify-tick.js knows what to check for this subscriber. Safe to call
 * often (e.g. on every relevant state change) — the server just overwrites
 * its stored copy, keeping the existing notifiedState (dedup bookkeeping)
 * intact so re-syncing doesn't cause a burst of repeat notifications.
 */
export const syncPushSubscription = async (subscription, schedule) => {
  if (!subscription) return false;
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, ...schedule }),
    });
    return res.ok;
  } catch (err) {
    console.error('Push subscription sync failed:', err);
    return false;
  }
};

/**
 * Subscribes this device to real Web Push (fires with the app fully
 * closed — see api/notify-tick.js) and registers it with the server,
 * reusing an existing browser-level subscription if one's already there
 * instead of creating a duplicate.
 *
 * Throws a specific Error for each distinct failure point (unsupported
 * browser, the VITE_VAPID_PUBLIC_KEY env var missing from THIS build,
 * no service worker registration yet, the browser's own subscribe() call
 * rejecting, or the server rejecting /api/subscribe) instead of silently
 * returning null — a silent null made a real Vercel env-var misconfig
 * (the actual cause found 2026-09-02: notifications only worked while the
 * app was open, because no real subscription — nor sync — had ever
 * succeeded, so only the local-timer fallback was ever doing anything)
 * indistinguishable from a dozen other causes. Callers surface `err.message`
 * to the user instead of guessing.
 */
export const subscribeToPush = async (schedule) => {
  if (!isPushSupported()) throw new Error('unsupported');

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('missing-vapid-key');

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('no-service-worker');

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch (err) {
      throw new Error(`browser-subscribe-failed: ${err.message}`);
    }
  }

  const synced = await syncPushSubscription(subscription, schedule);
  if (!synced) throw new Error('server-sync-failed');

  return subscription;
};

/**
 * Client-side counterpart to public/sw.js's markEndedOnServer — used when
 * the in-app "Class ended" button is clicked (not the push notification's
 * own action button, which the SW already handles itself). Best-effort:
 * failures are swallowed since the in-app suppression already took effect
 * regardless, and the next real server tick self-corrects once the class's
 * actual end time passes anyway.
 */
export const markSessionEndedOnServer = async (key) => {
  if (!key || !isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/mark-ended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint, key }),
    });
  } catch {
    // best-effort only
  }
};

export const unsubscribeFromPush = async () => {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, unsubscribe: true }),
    });
    await subscription.unsubscribe();
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
};

/**
 * Shows a real OS notification. Routes through the service worker so
 * `actions` (e.g. "Class Ended") render where the platform supports them;
 * falls back to a plain Notification (no actions) if no SW is available.
 * `tag` + `renotify` make a re-fired notification (e.g. the "10 minutes
 * left" re-open after a dismiss) actually re-alert instead of silently
 * replacing the old one.
 */
export const showAppNotification = async ({ title, body, tag, data, actions }) => {
  if (!canNotify() || Notification.permission !== 'granted') return false;

  const options = {
    body,
    tag,
    data,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
  };

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.showNotification(title, actions ? { ...options, actions } : options);
      return true;
    }
  } catch (err) {
    console.error('showNotification via service worker failed:', err);
  }

  try {
    const plain = new Notification(title, options); // fire-and-forget fallback, no actions
    return Boolean(plain);
  } catch (err) {
    console.error('Notification fallback failed:', err);
    return false;
  }
};
