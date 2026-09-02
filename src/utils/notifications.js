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
 */
export const subscribeToPush = async (schedule) => {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!isPushSupported() || !publicKey) return null;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch (err) {
      console.error('Push subscribe failed:', err);
      return null;
    }
  }

  await syncPushSubscription(subscription, schedule);
  return subscription;
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
