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

// Roll-number selection sheet (added 2026-08-25, reworked 2026-08-27 to a
// compact format) — a separate spreadsheet, one flat tab named
// ROLL_SHEET_TAB. Compact format: column A the roll number, every other
// column a "SHORTCODE (Section)" cell — see parseRollNumbers in
// src/services/timetableSource.js and buildCourseCodeMap in
// src/utils/schedule.js for how codes are generated/resolved. If this ever
// needs to be unset again (sheet deleted/replaced without a new one ready),
// set it back to null — getSheetData() then reports rollNumbers: null and
// the app's Roll No tab shows an unavailable state instead of erroring.
const ROLL_SHEET_ID = '1-OU7HxwLf7sIc-rtyCUB6Hf7SuMEvyZtD2stFv--DHM';
const ROLL_SHEET_TAB = 'RollNumbers';

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

  // The two htmlview fetches below each download an entire Google Sheets
  // web-UI page (hundreds of KB, just to regex out tab names) — on a cold
  // serverless instance (this in-memory cache resets on every cold start,
  // regardless of CACHE_MS, which only helps a warm instance serving
  // repeat requests), that used to mean two FULL round trips run one after
  // the other before this function could return anything at all, directly
  // blocking the client's very first paint. Run in parallel instead
  // (2026-09-14, part of a PWA-open-speed investigation) — the roll-number
  // check was always independent of the day-tab check, it just wasn't
  // written that way.
  const [tabNames, rollTabResult] = await Promise.all([
    fetchTabNames(SHEET_ID),
    // Roll-number sheet check is best-effort and non-fatal: an unmatched
    // `sheet=` name silently falls back to gviz's first tab instead of
    // erroring (the same failure class the day-tab check exists to catch),
    // so verify the tab exists here too — but if this sheet is missing,
    // unreachable, or misconfigured, Roll No mode just goes unavailable.
    // It must never take the day tabs down with it, hence the inline
    // try/catch instead of letting a rejection propagate into the
    // Promise.all above.
    ROLL_SHEET_ID
      ? fetchTabNames(ROLL_SHEET_ID).catch((err) => {
          console.error('Could not verify roll-number sheet tab list:', err.message);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const codes = DAY_NAMES.map((day) => {
    const match = tabNames.find((name) => name.toLowerCase() === day.toLowerCase());
    if (!match) {
      throw new Error(`No sheet tab named "${day}" was found. Tabs found: ${tabNames.join(', ')}`);
    }
    return { name: match };
  });

  let rollNumbers = null;
  if (rollTabResult) {
    const rollTabMatch = rollTabResult.find((name) => name.toLowerCase() === ROLL_SHEET_TAB.toLowerCase());
    if (rollTabMatch) {
      rollNumbers = {
        url: `https://docs.google.com/spreadsheets/d/${ROLL_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(rollTabMatch)}`,
      };
    } else {
      console.error(
        `Roll-number sheet has no tab named "${ROLL_SHEET_TAB}". Tabs found: ${rollTabResult.join(', ')}`
      );
    }
  }

  const data = {
    karachi: {
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=`,
      codes,
      rollNumbers,
    },
  };
  cache = data;
  cacheAt = now;
  return data;
}
