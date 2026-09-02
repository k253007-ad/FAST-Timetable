// Server-side equivalent of src/hooks/useClassNotifications.js's tick
// logic — deliberately a separate, standalone copy rather than a shared
// import, because the client hook keeps its dedup bookkeeping in refs
// (fine for a long-lived browser tab) while this runs once per stateless
// cron invocation and must persist the exact same bookkeeping in the
// subscriber's own stored `notifiedState` between ticks instead. Keep the
// checkpoint semantics (30/10/5 min, "now started", "ended, next up") in
// sync with the client hook by hand if either ever changes — they're
// meant to feel identical to a student, just delivered through two
// different pipes (local timer vs. push).

import { abbreviateCourse, buildSchedule, cleanRoom, sessionKey } from '../../src/utils/schedule.js';

// This runs on Vercel's servers (triggered by an external cron), not the
// student's own device — so unlike the client hook (which reads the
// browser's local clock and is naturally correct for whoever's using it),
// `now` here must be explicitly converted to Karachi time. Vercel's
// serverless functions run in UTC (5 hours behind Karachi), so reading
// `now.getHours()`/`now.toLocaleDateString()` directly would silently
// compute every check against the wrong time of day, all day, every day.
// Pakistan doesn't observe DST, so this fixed +5h offset never needs
// seasonal adjustment.
const KARACHI_TZ = 'Asia/Karachi';
const karachiParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KARACHI_TZ,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: map.weekday, hours: Number(map.hour), minutes: Number(map.minute) };
};

const REMINDER_CHECKPOINTS = [30, 10, 5];

const formatCountdown = (mins) => {
  if (mins <= 0) return 'now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const sessionInfo = (cell) => {
  const item = cell.classes[0];
  return {
    key: sessionKey(cell),
    abbr: item.isActivity ? item.Course : abbreviateCourse(item.Course),
    room: item.isActivity ? '' : cleanRoom(item.Room),
    startLabel: cell.startLabel,
    endLabel: cell.endLabel,
    startMin: cell.startMin,
    endMin: cell.endMin,
  };
};

const freshState = (today) => ({
  lastDay: today,
  notifiedNowKey: null,
  notifiedEndedKey: null,
  prevCurrentKey: null,
  prevCurrentAbbr: null,
  manualEndedKey: null,
  endingSoonDiff: {},
  startingSoonDiff: {},
});

/**
 * `subscriberSelection`: `{ selectedClasses, overrides, extraClasses,
 * activities }` as stored for one subscriber. `prevState`: their last
 * saved `notifiedState` (or null/undefined for a brand new subscriber).
 * `now`: a real `Date` (passed in, not read internally, so this stays
 * pure/testable). Returns the notifications to send this tick plus the
 * state to save back — same edge-triggered-off-the-previous-tick
 * reasoning as the client hook, so a subscriber who's already 3 minutes
 * from a class ending when they first subscribe doesn't get all three
 * checkpoints in one burst.
 */
export const computeNotifications = (data, subscriberSelection, prevState, now) => {
  const { weekday: today, hours, minutes } = karachiParts(now);
  const state = prevState && prevState.lastDay === today ? { ...prevState } : freshState(today);

  const { selectedClasses = [], overrides = [], extraClasses = [], activities = [] } = subscriberSelection;
  const { processedSchedule } = buildSchedule(data, selectedClasses, overrides, extraClasses, activities);
  const nowMinutes = hours * 60 + minutes;
  const sessions = (processedSchedule[today] || []).filter((cell) => !cell.isEmpty);
  const currentCell = sessions.find((cell) => nowMinutes >= cell.startMin && nowMinutes < cell.endMin);
  const nextCell = sessions.find((cell) => cell.startMin > nowMinutes);

  const rawCurrentInfo = currentCell
    ? { ...sessionInfo(currentCell), minutesLeft: Math.max(0, currentCell.endMin - nowMinutes) }
    : null;
  const nextInfo = nextCell
    ? { ...sessionInfo(nextCell), minutesLeft: Math.max(0, nextCell.startMin - nowMinutes) }
    : null;

  // A push notification's "End Class" action (see public/sw.js +
  // api/mark-ended.js) sets `state.manualEndedKey` — same
  // "suppress this session immediately, don't wait for its real scheduled
  // end" behavior as the client hook's manualEndedKeyRef. Clears itself
  // once the real session actually changes.
  if (state.manualEndedKey && state.manualEndedKey !== rawCurrentInfo?.key) {
    state.manualEndedKey = null;
  }
  const currentInfo = rawCurrentInfo && state.manualEndedKey === rawCurrentInfo.key ? null : rawCurrentInfo;

  const notifications = [];

  // Class just started.
  if (currentInfo && state.notifiedNowKey !== currentInfo.key) {
    notifications.push({
      title: `Now: ${currentInfo.abbr}`,
      body: currentInfo.room ? `${currentInfo.room} · Ends ${currentInfo.endLabel}` : `Ends ${currentInfo.endLabel}`,
      tag: 'now-class',
      data: { key: currentInfo.key },
      actions: [{ action: 'ended', title: 'End Class' }],
    });
    state.notifiedNowKey = currentInfo.key;
  }

  // 30/10/5 minutes left in the class happening right now.
  if (currentInfo) {
    const prevDiff = state.endingSoonDiff[currentInfo.key];
    state.endingSoonDiff[currentInfo.key] = currentInfo.minutesLeft;
    if (prevDiff !== undefined) {
      const crossed = REMINDER_CHECKPOINTS.find((t) => prevDiff > t && currentInfo.minutesLeft <= t);
      if (crossed) {
        notifications.push({
          title: `${currentInfo.abbr} ends in ${formatCountdown(currentInfo.minutesLeft)}`,
          body: currentInfo.room,
          tag: 'ending-soon',
          data: { key: currentInfo.key },
        });
      }
    }
  } else {
    state.endingSoonDiff = {};
  }

  // The class from the previous tick just ended and there's another one later today.
  if (!currentInfo && state.prevCurrentKey && nextInfo && state.notifiedEndedKey !== state.prevCurrentKey) {
    notifications.push({
      title: `${state.prevCurrentAbbr} ended`,
      body: `Next: ${nextInfo.abbr} at ${nextInfo.startLabel}${nextInfo.room ? ` · ${nextInfo.room}` : ''}`,
      tag: 'next-class',
      data: { key: nextInfo.key },
    });
    state.notifiedEndedKey = state.prevCurrentKey;
  }

  // 30/10/5 minutes until the next class starts (a gap after one ended, or
  // simply not having started a first class yet today).
  if (!currentInfo && nextInfo) {
    const prevDiff = state.startingSoonDiff[nextInfo.key];
    state.startingSoonDiff[nextInfo.key] = nextInfo.minutesLeft;
    if (prevDiff !== undefined) {
      const crossed = REMINDER_CHECKPOINTS.find((t) => prevDiff > t && nextInfo.minutesLeft <= t);
      if (crossed) {
        notifications.push({
          title: `${nextInfo.abbr} starts at ${nextInfo.startLabel}`,
          body: nextInfo.room,
          tag: 'next-class',
          data: { key: nextInfo.key },
        });
      }
    }
  } else {
    state.startingSoonDiff = {};
  }

  if (!currentInfo && !nextInfo) {
    state.notifiedNowKey = null;
    state.notifiedEndedKey = null;
  }

  state.prevCurrentKey = currentInfo ? currentInfo.key : null;
  state.prevCurrentAbbr = currentInfo ? currentInfo.abbr : null;

  return { notifications, nextState: state };
};
