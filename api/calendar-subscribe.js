// Saves (or updates) one browser's current schedule for the "Sync to Google
// Calendar" live feed — called once when the student first presses the
// Calendar button (src/utils/calendarExport.js), and again on every real
// change by useClassNotifications' tick loop, so api/calendar.ics.js always
// has an up-to-date copy to serve back to Google whenever it next polls.
// No secret/auth required — same reasoning as api/subscribe.js: this only
// ever writes the caller's own record under an id only they hold, never
// reads anyone else's.

import { saveCalendarFeed } from './_lib/calendarFeedStore.js';

const ID_RE = /^[A-Za-z0-9]{8,64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const { id, selectedClasses, overrides } = body || {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  await saveCalendarFeed(id, {
    selectedClasses: Array.isArray(selectedClasses) ? selectedClasses : [],
    overrides: Array.isArray(overrides) ? overrides : [],
  });

  res.status(200).json({ ok: true });
}
