// Single source of truth for the timetable's Google Sheet, shared by the
// production serverless function (api/data.js) and the Vite dev-server
// middleware (vite.config.js) so `npm run dev` and the deployed site agree.
//
// Day tabs are fetched by NAME via the gviz endpoint's `sheet=` param, not
// by gid. Google reassigns every tab a brand-new gid each time the sheet
// is re-imported/replaced, which used to silently break the site (a stale
// gid falls back to the first tab instead of erroring, so every day showed
// Monday's classes) — `sheet=<tab name>` needs no gid at all, so
// re-uploading/replacing the sheet's data never requires a code change as
// long as the tabs stay named Monday..Friday.
//
// We still confirm each day name actually exists as a tab before fetching
// its data: an unmatched `sheet=` name silently falls back to gviz's
// *first* tab (HTTP 200, status "ok", no error) instead of failing, so
// skipping this check would reintroduce the exact "every day shows
// Monday" bug through a different door. The tab list comes from the
// sheet's public htmlview export (the only unauthenticated way to list a
// Google Sheet's tabs) — used only to verify names exist; we never read
// or store its gids. To point at a different spreadsheet: replace
// SHEET_ID below. Nothing else needs to change, ever, as long as the day
// tabs are named Monday..Friday.

const SHEET_ID = '1rRo5Gqu2nqj1K1xzxO-4n8KQmnXq7fx65P4Yz9CkxN0';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const CACHE_MS = 10 * 60 * 1000; // re-check the tab list at most every 10 minutes
let cache = null;
let cacheAt = 0;

// The public (unauthenticated) "htmlview" export embeds every tab's name
// as plain JS — this is the only unauthenticated way to discover a Google
// Sheet's tab list without the Sheets API + an API key.
const TAB_NAME_PATTERN = /items\.push\(\{name:\s*"([^"]+)"/g;

async function fetchTabNames(sheetId) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  if (!res.ok) {
    throw new Error(`Could not read sheet tab list (HTTP ${res.status}). Is the sheet still shared "Anyone with the link"?`);
  }
  const html = await res.text();
  const names = [...html.matchAll(TAB_NAME_PATTERN)].map((m) => m[1].trim());
  if (names.length === 0) {
    throw new Error('Could not find any sheet tabs in the htmlview export — Google may have changed its page format.');
  }
  return names;
}

export async function getSheetData() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const tabNames = await fetchTabNames(SHEET_ID);
  const codes = DAY_NAMES.map((day) => {
    const match = tabNames.find((name) => name.toLowerCase() === day.toLowerCase());
    if (!match) {
      throw new Error(`No sheet tab named "${day}" was found. Tabs found: ${tabNames.join(', ')}`);
    }
    return { name: match };
  });

  const data = {
    karachi: {
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=`,
      codes,
    },
  };
  cache = data;
  cacheAt = now;
  return data;
}
