// "Sync to Google Calendar" without any OAuth/login flow anywhere in this
// app, and without the student having to re-download/re-import anything
// after the first setup — a live "subscribe by URL" feed instead of a
// one-off file.
//
// How it works end to end: the client generates a random id once (kept in
// localStorage, see getOrCreateCalendarFeedId), POSTs the student's current
// Main-profile schedule to api/calendar-subscribe.js under that id, then
// opens Google Calendar's own "add calendar by URL" prompt
// (openGoogleCalendarSubscribePrompt) pointed at
// `webcal://<this app's domain>/api/calendar.ics?id=<id>`. The student
// clicks "Add" on Google's own already-authenticated page — this app never
// sees a Google login screen. From then on Google's own servers re-fetch
// that URL on their own schedule (their refresh interval, not something
// this app controls — commonly every 12-24h) and pull in whatever
// api/calendar.ics.js serves for that id, which is *live* — generated fresh
// from the current timetable + whatever schedule was last POSTed for that
// id. useClassNotifications' existing tick loop keeps that POST current
// automatically (see its calendar-feed-resync block), the same way it
// already keeps push notifications' server-side copy current — so once a
// student has set this up once, it just keeps working with zero further
// action, including picking up later selection changes on its own.
import { buildSchedule, DAY_ORDER } from './schedule.js';

// Same fixed-offset fact api/_lib/notifyLogic.js relies on: Pakistan has no
// DST, so Asia/Karachi is always exactly UTC+5. That means a local clock
// time can be turned into a UTC ("Z") instant by simple subtraction, with no
// VTIMEZONE block needed for the .ics to be unambiguous across every
// calendar app.
const KARACHI_UTC_OFFSET_MIN = 5 * 60;

const pad2 = (n) => String(n).padStart(2, '0');

// `minutesSinceMidnight` (already in the toMinutes()/startMin form the rest
// of schedule.js uses — see buildSchedule) for `localDate`'s calendar day,
// converted to a UTC "Z" instant. Date.UTC normalizes out-of-range minute
// values on its own, so subtracting the offset here correctly rolls back
// into the previous UTC day when needed.
const toICSDateUTC = (localDate, minutesSinceMidnight) => {
  const utc = new Date(
    Date.UTC(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      0,
      minutesSinceMidnight - KARACHI_UTC_OFFSET_MIN
    )
  );
  return `${utc.getUTCFullYear()}${pad2(utc.getUTCMonth() + 1)}${pad2(utc.getUTCDate())}T${pad2(
    utc.getUTCHours()
  )}${pad2(utc.getUTCMinutes())}00Z`;
};

// An anchor date for "this week"'s occurrence of each weekday — only used to
// seed DTSTART for a *recurring* series below, so it only has to land on the
// right day-of-week, not any particular week: a weekly RRULE anchored at any
// Tuesday is the same infinite series as one anchored at any other Tuesday.
// Re-picking "this week" on every fetch (api/calendar.ics.js regenerates on
// every request) is therefore harmless, not a source of drift.
const getAnchorMonday = (now) => {
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
};

const BYDAY = { Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR' };

const escapeICS = (text) =>
  String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');

// RFC5545 75-octet line folding, for stricter parsers (Outlook et al) on a
// long course name/description.
const foldLine = (line) => {
  if (line.length <= 75) return line;
  let result = '';
  let rest = line;
  while (rest.length > 75) {
    result += `${rest.slice(0, 75)}\r\n `;
    rest = rest.slice(75);
  }
  return result + rest;
};

export const EMPTY_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//FAST Timetable//Calendar Feed//EN',
  'CALSCALE:GREGORIAN',
  'END:VCALENDAR',
].join('\r\n');

/**
 * Builds an .ics (string) of *recurring* weekly events (Monday-Friday — this
 * app has no Saturday/Sunday classes) for the given selection: every session
 * carries `RRULE:FREQ=WEEKLY;BYDAY=..` with no end date, so a subscriber
 * keeps seeing it every week indefinitely without needing regeneration tied
 * to a specific date. Mirrors the print/export precedent of excluding
 * personal extras/activities (isExtra/isActivity, plus a one-off "extra"
 * genuinely shouldn't recur forever) and always applies `overrides` (a
 * permanent per-device correction *should* persist in the recurring feed).
 * Server-callable (api/calendar.ics.js) — no browser globals used here.
 */
export const generateRecurringICS = (data, selectedClasses, overrides, now = new Date()) => {
  const { processedSchedule } = buildSchedule(data, selectedClasses, overrides, [], []);
  const monday = getAnchorMonday(now);
  const stamp = toICSDateUTC(now, now.getHours() * 60 + now.getMinutes());

  const events = [];
  DAY_ORDER.forEach((day, dayOffset) => {
    const cellDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset);
    (processedSchedule[day] || []).forEach((cell) => {
      if (cell.isEmpty) return;
      const seen = new Set();
      cell.classes.forEach((item) => {
        if (item.isExtra || item.isActivity) return;
        const dedupeKey = `${item.Course}|${item.Section}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        const section = item.Section && item.Section !== 'N/A' ? ` (${item.Section})` : '';
        events.push({
          // Stable across regenerations (no week/date component), so
          // Google's periodic re-fetch updates the same event in place
          // instead of piling up duplicates when a class's room/instructor
          // changes on the sheet, or the student edits their selection.
          uid: `${item.Course}-${item.Section}-${day}-${cell.slot}@fasttimetable`.replace(/\s+/g, '_'),
          summary: `${item.Course}${section}`,
          location: item.Room || '',
          description: `Instructor: ${item.Instructor || 'N/A'}`,
          start: toICSDateUTC(cellDate, cell.startMin),
          end: toICSDateUTC(cellDate, cell.endMin),
          byday: BYDAY[day],
        });
      });
    });
  });

  if (events.length === 0) return EMPTY_ICS;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FAST Timetable//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${e.start}`,
      `DTEND:${e.end}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${e.byday}`,
      foldLine(`SUMMARY:${escapeICS(e.summary)}`),
      foldLine(`LOCATION:${escapeICS(e.location)}`),
      foldLine(`DESCRIPTION:${escapeICS(e.description)}`),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
};

// ---- Client-side wiring (id management, syncing, opening Google's prompt) ----

const CALENDAR_FEED_ID_KEY = 'calendarFeedId';

// A random, unguessable id — not tied to any account, just a capability
// token: whoever has it can read that student's class schedule (course
// names/rooms/instructors, the same info already visible to anyone with the
// shared timetable link) back out of api/calendar.ics.js. Generated once and
// kept in localStorage; the *same* id is reused by the auto-resync tick in
// useClassNotifications.js so a Google Calendar subscription set up once
// keeps tracking that browser's Main profile forever.
export const getCalendarFeedId = () => {
  try {
    return localStorage.getItem(CALENDAR_FEED_ID_KEY);
  } catch {
    return null;
  }
};

export const getOrCreateCalendarFeedId = () => {
  try {
    let id = localStorage.getItem(CALENDAR_FEED_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, '');
      localStorage.setItem(CALENDAR_FEED_ID_KEY, id);
    }
    return id;
  } catch {
    return null; // localStorage unavailable — caller should treat this as unsupported
  }
};

// POSTs the current schedule for `id` to the server; returns whether it
// succeeded. Fire-and-forget-friendly (caller decides how to react to a
// failure) — used both by the initial "Calendar" button press and by the
// ongoing auto-resync tick.
export const pushCalendarSchedule = async (id, schedule) => {
  try {
    const res = await fetch('/api/calendar-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...schedule }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const getCalendarFeedUrl = (id) => {
  const origin = window.location.origin.replace(/^https?:/, 'webcal:');
  return `${origin}/api/calendar.ics?id=${id}`;
};

// Google's well-known (if unofficial) "subscribe to this calendar URL"
// prompt — opens straight to an "Add this calendar?" confirmation on
// Google's own site, no Settings navigation, no file download/import, and
// crucially no OAuth screen from this app (the student is just using their
// browser's existing logged-in Google session, the same way clicking a
// "mailto:" link uses their existing email client).
export const openGoogleCalendarSubscribePrompt = (id) => {
  const feedUrl = getCalendarFeedUrl(id);
  const addUrl = `https://www.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;
  window.open(addUrl, '_blank', 'noopener,noreferrer');
};
