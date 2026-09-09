// Live "subscribe by URL" feed for Google Calendar — the actual endpoint
// Google's own servers re-fetch on their own schedule once a student has
// added it via the "Sync to Google Calendar" button
// (src/utils/calendarExport.js's openGoogleCalendarSubscribePrompt). Always
// regenerates from the *current* live timetable + whatever schedule was
// last POSTed to api/calendar-subscribe.js for this id — there is no
// snapshot/caching layer here beyond Google's own polling interval, so a
// class's room/instructor change on the sheet, or the student editing their
// selection, reaches Google Calendar automatically on its next poll with
// zero further action from the student.

import { getSheetData } from './sheetConfig.js';
import { buildTimetableFromMeta } from '../src/services/timetableSource.js';
import { getCalendarFeed } from './_lib/calendarFeedStore.js';
import { generateRecurringICS, EMPTY_ICS } from '../src/utils/calendarExport.js';

const ID_RE = /^[A-Za-z0-9]{8,64}$/;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // Google controls its own poll cadence regardless, but this stops Vercel's
  // own edge/CDN layer from adding a second, independent staleness window on
  // top of that.
  res.setHeader('Cache-Control', 'no-store');

  const id = req.query?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    res.status(400);
    res.end(EMPTY_ICS);
    return;
  }

  const record = await getCalendarFeed(id);
  if (!record) {
    // Not set up yet, or the in-memory dev/no-KV fallback lost it on a cold
    // start — a harmless empty calendar is far better than an HTTP error a
    // subscribed client might mark as permanently broken and stop retrying.
    res.status(200);
    res.end(EMPTY_ICS);
    return;
  }

  let data;
  try {
    const meta = await getSheetData();
    data = await buildTimetableFromMeta(meta);
  } catch (err) {
    console.error('calendar.ics: could not load timetable data', err);
    res.status(200);
    res.end(EMPTY_ICS);
    return;
  }

  const ics = generateRecurringICS(data, record.selectedClasses, record.overrides);
  res.status(200);
  res.end(ics);
}
