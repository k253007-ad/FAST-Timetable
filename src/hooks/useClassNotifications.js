import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSchedule, cleanRoom, abbreviateCourse, sessionKey } from '../utils/schedule.js';
import {
  registerServiceWorker,
  notificationPermission,
  requestNotificationPermission,
  showAppNotification,
  isPushSupported,
  subscribeToPush,
  syncPushSubscription,
  markSessionEndedOnServer,
  unsubscribeFromPush,
} from '../utils/notifications.js';

// A separate app-level "do I actually want notifications" preference, on
// top of the browser's own OS-level permission — JS can never revoke that
// permission itself (only the user can, via browser settings), but the app
// can still stop actually sending/subscribing while permission stays
// granted, which is what an in-app enable/disable toggle needs. Defaults to
// enabled so existing users who already granted permission keep working.
const NOTIF_ENABLED_KEY = 'notificationsUserEnabled';
const getUserEnabledPref = () => localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false';

// Always the *Main* profile's own saved selection, independent of whichever
// profile tab is currently open in ClassSelector — "the main timetable is
// the user's timetable" is the one notifications are computed from. Read
// fresh from localStorage on every tick rather than kept in React state, so
// this stays correct even while the user is browsing a friend's profile.
const MAIN_KEY = 'selectedClasses_main';
const MAIN_OVERRIDES_KEY = 'classOverrides_main';
const MAIN_EXTRAS_KEY = 'extraClasses_main';
const MAIN_ACTIVITIES_KEY = 'activities_main';
const TICK_MS = 20000; // fine enough to catch the "10 minutes left" checkpoint promptly

const getMainClasses = () => {
  try {
    const saved = localStorage.getItem(MAIN_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Same "read fresh every tick" reasoning as getMainClasses above — a manual
// time override (see utils/schedule.js) must apply to notifications too,
// and must always reflect the Main profile's own moves regardless of which
// profile tab is open.
const getMainOverrides = () => {
  try {
    const saved = localStorage.getItem(MAIN_OVERRIDES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Same reasoning again — a one-off "extra class" (see buildExtraRows in
// utils/schedule.js) must fire notifications too, for the Main profile only.
const getMainExtras = () => {
  try {
    const saved = localStorage.getItem(MAIN_EXTRAS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Same reasoning again — a personal "activity" (Library, Prayer/Namaz, ...)
// should notify exactly like a class, for the Main profile only.
const getMainActivities = () => {
  try {
    const saved = localStorage.getItem(MAIN_ACTIVITIES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const getMainSchedule = () => ({
  selectedClasses: getMainClasses(),
  overrides: getMainOverrides(),
  extraClasses: getMainExtras(),
  activities: getMainActivities(),
});

const formatCountdown = (mins) => {
  if (mins <= 0) return 'now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Reminder checkpoints, both for "current class ending soon" and "next class
// starting soon" — a notification fires once per checkpoint per session, the
// moment the countdown first drops to/below it (edge-triggered off the
// previous tick's value, not just "is it currently <= t", so a class that's
// already 3 minutes from ending when the app is first opened doesn't fire
// all three checkpoints in a single burst). Different checkpoints for the
// two directions (2026-09-02): current-class-ending uses 15/5 min,
// next-class-starting uses 30/10/5 min — keep in sync with
// api/_lib/notifyLogic.js's identical split by hand.
const ENDING_SOON_CHECKPOINTS = [15, 5];
const STARTING_SOON_CHECKPOINTS = [30, 10, 5];

/**
 * Drives the "now / next class" notification timer for the Main profile.
 * As of 2026-09-02, real Web Push (api/notify-tick.js) is the primary path
 * once a device has successfully subscribed — it covers both open and fully
 * closed states, so this hook's own local-timer firing is only a FALLBACK
 * for a device that can't/didn't subscribe to push (e.g. push unsupported,
 * or the subscribe request failed). Firing both unconditionally would
 * double up every notification while the app is open — one from this timer,
 * one from the server's push arriving at the same service worker. See
 * `pushActiveRef` below.
 */
export const useClassNotifications = (data) => {
  const [permission, setPermission] = useState(notificationPermission);
  // Mirrors manualEndedKeyRef but as real state, so NowNext (rendered via
  // App.jsx) reflects a "Class ended" click immediately instead of waiting
  // up to TICK_MS for the next interval tick.
  const [manualEndedKey, setManualEndedKey] = useState(null);
  // Surfaced in the Settings menu (2026-09-02) so a real subscribe/sync
  // failure is visible on-screen instead of only in a devtools console a
  // phone user has no easy way to open — see subscribeToPush's doc comment
  // for why this exists at all.
  const [pushStatus, setPushStatus] = useState(() => {
    if (!isPushSupported()) return { state: 'unsupported', detail: '' };
    if (notificationPermission() !== 'granted') return { state: 'idle', detail: '' };
    return { state: 'checking', detail: '' };
  });
  // Whether the USER wants notifications right now, independent of browser
  // permission — the in-app enable/disable toggle in App.jsx's Settings
  // menu writes this. Permission can be 'granted' while this is false (the
  // user muted it from inside the app without touching browser settings).
  const [userEnabled, setUserEnabled] = useState(getUserEnabledPref);

  const currentRef = useRef(null);
  const manualEndedKeyRef = useRef(null);
  const notifiedNowKeyRef = useRef(null);
  const notifiedEndedKeyRef = useRef(null); // "class ended, next up" — fires once per ended session
  const endingSoonDiffRef = useRef(new Map()); // session key -> last-seen minutes-to-end
  const startingSoonDiffRef = useRef(new Map()); // session key -> last-seen minutes-to-start
  const lastDayRef = useRef(null);
  const pushSyncedRef = useRef(null); // last schedule JSON already sent to /api/subscribe
  const pushActiveRef = useRef(false); // true once this device has a real push subscription
  const userEnabledRef = useRef(getUserEnabledPref()); // mirrors userEnabled for the tick loop

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // A returning user who already granted permission (from before push
  // support existed, or after clearing just the push subscription without
  // revoking the OS-level permission) should get resubscribed automatically
  // — otherwise they'd silently keep the old local-only behavior forever.
  // Skipped if the user explicitly muted notifications from inside the app
  // last time — their choice should stick across visits, not just sessions.
  useEffect(() => {
    if (!isPushSupported() || notificationPermission() !== 'granted' || !getUserEnabledPref()) return;
    (async () => {
      const schedule = getMainSchedule();
      try {
        const sub = await subscribeToPush(schedule);
        pushSyncedRef.current = JSON.stringify(schedule);
        pushActiveRef.current = true;
        setPushStatus({ state: 'subscribed', detail: sub.endpoint });
      } catch (err) {
        pushActiveRef.current = false;
        setPushStatus({ state: 'error', detail: err.message });
      }
    })();
  }, []);

  // Action-button clicks / notification dismissals bounce back from the SW.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'CLASS_ENDED' && msg.key) {
        manualEndedKeyRef.current = msg.key;
        setManualEndedKey(msg.key);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      // A fresh grant means the user wants notifications — clears any
      // earlier in-app mute so this doesn't silently stay off.
      localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
      userEnabledRef.current = true;
      setUserEnabled(true);
      const schedule = getMainSchedule();
      try {
        const sub = await subscribeToPush(schedule);
        pushSyncedRef.current = JSON.stringify(schedule);
        pushActiveRef.current = true;
        setPushStatus({ state: 'subscribed', detail: sub.endpoint });
      } catch (err) {
        pushActiveRef.current = false;
        setPushStatus({ state: 'error', detail: err.message });
      }
    }
    return result;
  }, []);

  /**
   * The in-app enable/disable toggle. Turning off unsubscribes this device
   * from push entirely (server-side row deleted, browser subscription torn
   * down) and stops the local-timer fallback too — a full mute, not just a
   * "stop asking" flag. Turning back on re-subscribes immediately, without
   * re-prompting for browser permission (it's still granted from before).
   * Does nothing to the browser's own OS-level permission either way — that
   * can only be changed by the user via browser settings.
   */
  const setNotificationsEnabled = useCallback(async (enabled) => {
    localStorage.setItem(NOTIF_ENABLED_KEY, String(enabled));
    userEnabledRef.current = enabled;
    setUserEnabled(enabled);

    if (!enabled) {
      pushActiveRef.current = false;
      pushSyncedRef.current = null;
      setPushStatus({ state: 'idle', detail: '' });
      await unsubscribeFromPush();
      return;
    }

    if (notificationPermission() !== 'granted') return;
    const schedule = getMainSchedule();
    try {
      const sub = await subscribeToPush(schedule);
      pushSyncedRef.current = JSON.stringify(schedule);
      pushActiveRef.current = true;
      setPushStatus({ state: 'subscribed', detail: sub.endpoint });
    } catch (err) {
      pushActiveRef.current = false;
      setPushStatus({ state: 'error', detail: err.message });
    }
  }, []);

  // Used by both the SW action button (via the message listener above) and
  // an in-app "Class ended" button — same effect either way. The server
  // call is fire-and-forget: it only matters when push is active (so the
  // next cron tick doesn't re-notify about a session already ended here).
  const markCurrentEnded = useCallback(() => {
    if (currentRef.current?.key) {
      const key = currentRef.current.key;
      manualEndedKeyRef.current = key;
      setManualEndedKey(key);
      markSessionEndedOnServer(key);
    }
  }, []);

  useEffect(() => {
    if (!data?.timetable) return undefined;

    const tick = () => {
      const now = new Date();
      const today = now.toLocaleDateString('en-US', { weekday: 'long' });

      // A new calendar day reuses the same course/section/time keys as any
      // previous day, so notification bookkeeping must reset at midnight.
      if (lastDayRef.current !== today) {
        lastDayRef.current = today;
        notifiedNowKeyRef.current = null;
        notifiedEndedKeyRef.current = null;
        manualEndedKeyRef.current = null;
        endingSoonDiffRef.current.clear();
        startingSoonDiffRef.current.clear();
      }

      const mainClasses = getMainClasses();
      const mainOverrides = getMainOverrides();
      const mainExtras = getMainExtras();
      const mainActivities = getMainActivities();
      const { processedSchedule } = buildSchedule(data, mainClasses, mainOverrides, mainExtras, mainActivities);

      // User muted notifications from inside the app — currentRef still
      // needs updating below for markCurrentEnded/NowNext, but nothing
      // notification-related (push resync or local fallback firing) should
      // run at all.
      const notifyingEnabled = userEnabledRef.current;

      // Keep the server's copy of the Main schedule current so
      // api/notify-tick.js checks against what's actually selected right
      // now, not whatever was selected when push was first turned on.
      // Fire-and-forget — this must never block the notification logic
      // below on a network round trip. Only marks itself "synced" once the
      // server actually confirms it — previously this was set optimistically
      // *before* the network call, which silently hid real failures (a
      // missing subscription, or /api/subscribe rejecting) forever, since
      // the payload-changed check would then never trigger a retry.
      if (notifyingEnabled && notificationPermission() === 'granted' && isPushSupported()) {
        const schedule = { selectedClasses: mainClasses, overrides: mainOverrides, extraClasses: mainExtras, activities: mainActivities };
        const payload = JSON.stringify(schedule);
        if (payload !== pushSyncedRef.current) {
          navigator.serviceWorker
            .getRegistration()
            .then((reg) => reg?.pushManager.getSubscription())
            .then(async (sub) => {
              if (!sub) {
                pushActiveRef.current = false;
                setPushStatus({ state: 'error', detail: 'no-subscription' });
                return;
              }
              const synced = await syncPushSubscription(sub, schedule);
              if (synced) {
                pushSyncedRef.current = payload;
                pushActiveRef.current = true;
                setPushStatus({ state: 'subscribed', detail: sub.endpoint });
              } else {
                pushActiveRef.current = false;
                setPushStatus({ state: 'error', detail: 'server-sync-failed' });
              }
            })
            .catch((err) => {
              pushActiveRef.current = false;
              setPushStatus({ state: 'error', detail: err.message });
            });
        }
      }
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const sessions = (processedSchedule[today] || []).filter((cell) => !cell.isEmpty);
      const currentCell = sessions.find((cell) => nowMinutes >= cell.startMin && nowMinutes < cell.endMin);
      const nextCell = sessions.find((cell) => cell.startMin > nowMinutes);

      const currentKey = currentCell ? sessionKey(currentCell) : null;
      if (manualEndedKeyRef.current && manualEndedKeyRef.current !== currentKey) {
        manualEndedKeyRef.current = null; // the real class changed — stop suppressing
        setManualEndedKey(null);
      }
      const effectiveCurrentKey = currentKey && manualEndedKeyRef.current === currentKey ? null : currentKey;

      // An activity's Course *is* its display name already (e.g. "Library") —
      // abbreviateCourse would mangle it (initials of "Prayer/Namaz"), and its
      // Room is always 'N/A', so both are skipped for activities.
      let currentInfo = null;
      if (effectiveCurrentKey && currentCell) {
        const item = currentCell.classes[0];
        currentInfo = {
          key: effectiveCurrentKey,
          course: item.Course,
          abbr: item.isActivity ? item.Course : abbreviateCourse(item.Course),
          room: item.isActivity ? '' : cleanRoom(item.Room),
          endLabel: currentCell.endLabel,
          minutesLeft: Math.max(0, currentCell.endMin - nowMinutes),
        };
      }

      let nextInfo = null;
      if (nextCell) {
        const item = nextCell.classes[0];
        nextInfo = {
          key: sessionKey(nextCell),
          course: item.Course,
          abbr: item.isActivity ? item.Course : abbreviateCourse(item.Course),
          room: item.isActivity ? '' : cleanRoom(item.Room),
          startLabel: nextCell.startLabel,
          minutesLeft: Math.max(0, nextCell.startMin - nowMinutes),
        };
      }

      const prevCurrentInfo = currentRef.current;
      currentRef.current = currentInfo;

      if (!notifyingEnabled || notificationPermission() !== 'granted') return;
      // Push (api/notify-tick.js) already covers this device — firing here
      // too would show every notification twice while the app is open.
      if (pushActiveRef.current) return;

      // Class just started.
      if (currentInfo && notifiedNowKeyRef.current !== currentInfo.key) {
        showAppNotification({
          title: `Now: ${currentInfo.abbr}`,
          body: currentInfo.room ? `${currentInfo.room} · Ends ${currentInfo.endLabel}` : `Ends ${currentInfo.endLabel}`,
          tag: 'now-class',
          data: { key: currentInfo.key },
          actions: [{ action: 'ended', title: 'End Class' }],
        });
        notifiedNowKeyRef.current = currentInfo.key;
      }

      // 30 / 10 / 5 minutes left in the class that's happening right now.
      if (currentInfo) {
        const prevDiff = endingSoonDiffRef.current.get(currentInfo.key);
        endingSoonDiffRef.current.set(currentInfo.key, currentInfo.minutesLeft);
        if (prevDiff !== undefined) {
          const crossed = ENDING_SOON_CHECKPOINTS.find((t) => prevDiff > t && currentInfo.minutesLeft <= t);
          if (crossed) {
            showAppNotification({
              title: `${currentInfo.abbr} ends in ${formatCountdown(currentInfo.minutesLeft)}`,
              body: currentInfo.room,
              tag: 'ending-soon',
              data: { key: currentInfo.key, checkpoint: crossed },
            });
          }
        }
      } else {
        endingSoonDiffRef.current.clear();
      }

      // Current class just ended and there's another one later today.
      if (!currentInfo && prevCurrentInfo && nextInfo && notifiedEndedKeyRef.current !== prevCurrentInfo.key) {
        showAppNotification({
          title: `${prevCurrentInfo.abbr} ended`,
          body: `Next: ${nextInfo.abbr} at ${nextInfo.startLabel}${nextInfo.room ? ` · ${nextInfo.room}` : ''}`,
          tag: 'next-class',
          data: { key: nextInfo.key },
        });
        notifiedEndedKeyRef.current = prevCurrentInfo.key;
      }

      // 30 / 10 / 5 minutes until the next class starts (covers both a gap
      // after the current class ended and simply not having started a first
      // class yet today).
      if (!currentInfo && nextInfo) {
        const prevDiff = startingSoonDiffRef.current.get(nextInfo.key);
        startingSoonDiffRef.current.set(nextInfo.key, nextInfo.minutesLeft);
        if (prevDiff !== undefined) {
          const crossed = STARTING_SOON_CHECKPOINTS.find((t) => prevDiff > t && nextInfo.minutesLeft <= t);
          if (crossed) {
            showAppNotification({
              title: `${nextInfo.abbr} starts at ${nextInfo.startLabel}`,
              body: nextInfo.room,
              tag: 'next-class',
              data: { key: nextInfo.key, checkpoint: crossed },
            });
          }
        }
      } else if (!nextInfo) {
        startingSoonDiffRef.current.clear();
      }

      if (!currentInfo && !nextInfo) {
        notifiedNowKeyRef.current = null;
        notifiedEndedKeyRef.current = null;
      }
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [data]);

  return {
    permission,
    requestPermission,
    markCurrentEnded,
    manualEndedKey,
    pushStatus,
    userEnabled,
    setNotificationsEnabled,
  };
};
