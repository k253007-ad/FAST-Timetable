// Single source of truth for the timetable's Google Sheet, shared by the
// production serverless function (api/data.js) and the Vite dev-server
// middleware (vite.config.js) so `npm run dev` and the deployed site agree.
//
// Day tabs are resolved by NAME, not by a hardcoded gid — Google assigns a
// new gid to every tab each time the sheet is re-imported/replaced, which
// used to silently break the site (a stale gid falls back to the first
// tab instead of erroring, so every day showed Monday's classes). Instead
// we fetch the sheet's public htmlview page, which lists every tab's
// current name + gid, and match by day name each time. To point at a
// different spreadsheet: replace SHEET_ID below. Nothing else needs to
// change, ever, as long as the day tabs are named Monday..Friday.

const SHEET_ID = '1rRo5Gqu2nqj1K1xzxO-4n8KQmnXq7fx65P4Yz9CkxN0';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const CACHE_MS = 10 * 60 * 1000; // re-check tab gids at most every 10 minutes
let cache = null;
let cacheAt = 0;

// The public (unauthenticated) "htmlview" export embeds every tab's
// {name, gid} pair as plain JS — this is the only unauthenticated way to
// discover a Google Sheet's tab list without the Sheets API + an API key.
const TAB_PATTERN = /items\.push\(\{name:\s*"([^"]+)"[^}]*?gid:\s*"(-?\d+)"/g;

async function fetchTabs(sheetId) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  if (!res.ok) {
    throw new Error(`Could not read sheet tab list (HTTP ${res.status}). Is the sheet still shared "Anyone with the link"?`);
  }
  const html = await res.text();
  const tabs = [];
  for (const m of html.matchAll(TAB_PATTERN)) {
    tabs.push({ name: m[1].trim(), gid: m[2] });
  }
  if (tabs.length === 0) {
    throw new Error('Could not find any sheet tabs in the htmlview export — Google may have changed its page format.');
  }
  return tabs;
}

export async function getSheetData() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const tabs = await fetchTabs(SHEET_ID);
  const codes = DAY_NAMES.map((day) => {
    const tab = tabs.find((t) => t.name.toLowerCase() === day.toLowerCase());
    if (!tab) {
      throw new Error(`No sheet tab named "${day}" was found. Tabs found: ${tabs.map((t) => t.name).join(', ')}`);
    }
    return { name: day, gid: tab.gid };
  });

  const data = {
    karachi: {
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=`,
      codes,
    },
  };
  cache = data;
  cacheAt = now;
  return data;
}
