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
