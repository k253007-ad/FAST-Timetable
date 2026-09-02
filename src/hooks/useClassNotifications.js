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
} from '../utils/notifications.js';

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
// all three checkpoints in a single burst).
const REMINDER_CHECKPOINTS = [30, 10, 5];

/**
 * Drives the "now / next class" local notification timer for the Main
 * profile. No backend — fires while the app is open/backgrounded via a
 * client-side interval; see public/sw.js + utils/notifications.js for why a
 * service worker is involved at all (action-button support only).
 */
export const useClassNotifications = (data) => {
  const [permission, setPermission] = useState(notificationPermission);
  // Mirrors manualEndedKeyRef but as real state, so NowNext (rendered via
  // App.jsx) reflects a "Class ended" click immediately instead of waiting
  // up to TICK_MS for the next interval tick.
  const [manualEndedKey, setManualEndedKey] = useState(null);

  const currentRef = useRef(null);
  const manualEndedKeyRef = useRef(null);
  const notifiedNowKeyRef = useRef(null);
  const notifiedEndedKeyRef = useRef(null); // "class ended, next up" — fires once per ended session
  const endingSoonDiffRef = useRef(new Map()); // session key -> last-seen minutes-to-end
  const startingSoonDiffRef = useRef(new Map()); // session key -> last-seen minutes-to-start
  const lastDayRef = useRef(null);
  const pushSyncedRef = useRef(null); // last schedule JSON already sent to /api/subscribe

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // A returning user who already granted permission (from before push
  // support existed, or after clearing just the push subscription without
  // revoking the OS-level permission) should get resubscribed automatically
  // — otherwise they'd silently keep the old local-only behavior forever.
  useEffect(() => {
    if (notificationPermission() !== 'granted' || !isPushSupported()) return;
    (async () => {
      const schedule = getMainSchedule();
      const sub = await subscribeToPush(schedule);
      if (sub) pushSyncedRef.current = JSON.stringify(schedule);
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
      const schedule = getMainSchedule();
      const sub = await subscribeToPush(schedule);
      if (sub) pushSyncedRef.current = JSON.stringify(schedule);
    }
    return result;
  }, []);

  // Used by both the SW action button (via the message listener above) and
  // an in-app "Class ended" button — same effect either way.
  const markCurrentEnded = useCallback(() => {
    if (currentRef.current?.key) {
      manualEndedKeyRef.current = currentRef.current.key;
      setManualEndedKey(currentRef.current.key);
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

      // Keep the server's copy of the Main schedule current so
      // api/notify-tick.js checks against what's actually selected right
      // now, not whatever was selected when push was first turned on.
      // Fire-and-forget — this must never block the notification logic
      // below on a network round trip.
      if (notificationPermission() === 'granted' && isPushSupported()) {
        const schedule = { selectedClasses: mainClasses, overrides: mainOverrides, extraClasses: mainExtras, activities: mainActivities };
        const payload = JSON.stringify(schedule);
        if (payload !== pushSyncedRef.current) {
          pushSyncedRef.current = payload;
          navigator.serviceWorker
            .getRegistration()
            .then((reg) => reg?.pushManager.getSubscription())
            .then((sub) => sub && syncPushSubscription(sub, schedule))
            .catch(() => {});
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

      if (notificationPermission() !== 'granted') return;

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
          const crossed = REMINDER_CHECKPOINTS.find((t) => prevDiff > t && currentInfo.minutesLeft <= t);
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
          const crossed = REMINDER_CHECKPOINTS.find((t) => prevDiff > t && nextInfo.minutesLeft <= t);
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

  return { permission, requestPermission, markCurrentEnded, manualEndedKey };
};
