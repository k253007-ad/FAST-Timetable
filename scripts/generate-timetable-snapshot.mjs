// Generates public/timetable-snapshot.json — a build-time snapshot of the
// live timetable, bundled into the app so a BRAND-NEW install (zero prior
// localStorage cache) can still render instantly on its very first open,
// not just on repeat opens (added 2026-09-15, on request: "make it so the
// pwa saves spreadsheet for it to open timetable without any delay ...
// opens instant and shows timetable without any delay").
//
// Runs automatically before every `npm run build` (see package.json's
// `prebuild` script) so a fresh production build always ships whatever the
// live sheet currently has — staleness is bounded to "however long ago the
// last build/deploy was," the same accepted tradeoff already used
// elsewhere in this app (the service-worker shell cache, the localStorage
// data cache). App.jsx only ever falls back to this file when there's NO
// localStorage cache yet (a genuinely first-ever open) — once the real
// live fetch resolves (which still happens immediately, unchanged, in the
// background), that becomes the source of truth and gets cached to
// localStorage for every future open instead.
//
// Reuses the exact same fetch/parse pipeline the live app and the
// server-side push-notification cron already use (timetableSource.js is
// deliberately environment-agnostic, see its own doc comment) — this is
// NOT a separate, second implementation of "how to read the sheet."

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getSheetData } from '../api/sheetConfig.js';
import { buildTimetableFromMeta } from '../src/services/timetableSource.js';

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'timetable-snapshot.json');

try {
  console.log('Generating build-time timetable snapshot...');
  const meta = await getSheetData();
  const data = await buildTimetableFromMeta(meta);
  // Roll-number rows are deliberately dropped here — the whole point of
  // this file is a SMALL, fast-to-fetch bootstrap for the very first
  // paint, and the roll-number sheet alone is ~2.7MB (32k+ rows) vs.
  // ~300KB for the actual weekly timetable — shipping it would make the
  // "instant open" fix slower to download than not having a bootstrap
  // snapshot at all. Roll No search isn't needed for the first render
  // anyway; it becomes available the moment the real background fetch in
  // App.jsx's getData() completes, same as it always has. `rollNumbers: []`
  // is kept in the shape (not omitted) so nothing downstream needs a
  // special case for "this field might not exist."
  const snapshot = { timetable: data.timetable, allTimes: data.allTimes, rollNumbers: [] };
  await writeFile(outPath, JSON.stringify(snapshot));
  console.log(
    `Wrote ${outPath} (${snapshot.timetable.length} timetable rows, ` +
      `${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB — roll numbers excluded, see comment above).`
  );
} catch (err) {
  // Deliberately non-fatal: a build shouldn't fail just because this
  // best-effort optimization couldn't reach the live sheet right now (a
  // transient network blip, say) — App.jsx already handles a missing/absent
  // snapshot file gracefully (falls back to the normal loading-skeleton
  // path, same as before this feature existed). Only warn, don't throw.
  console.warn('Could not generate timetable snapshot (non-fatal, build continues):', err.message);
}
