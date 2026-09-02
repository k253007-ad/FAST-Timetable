// Fetches timetable data for the browser: gets metadata from `/api/data`
// (sheet URL + day-tab names + optional roll-number sheet URL, see
// api/sheetConfig.js) then hands it to timetableSource.js's
// buildTimetableFromMeta, which does the actual per-day fetch/parse — that
// part is shared with api/notify-tick.js's server-side push notifications,
// see timetableSource.js's own doc comment for why it had to be split out.

import { buildTimetableFromMeta } from './timetableSource.js';

const API_META_URL = '/api/data';

export const fetchData = async () => {
  const metaResponse = await fetch(API_META_URL, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-cache',
  });

  if (!metaResponse.ok) {
    const contentType = metaResponse.headers.get('content-type');
    const detail =
      contentType && contentType.includes('application/json')
        ? JSON.stringify(await metaResponse.json())
        : await metaResponse.text();
    throw new Error(`Failed to fetch metadata: ${metaResponse.statusText} - ${detail}`);
  }
  const metaJson = await metaResponse.json();

  return buildTimetableFromMeta(metaJson);
};
