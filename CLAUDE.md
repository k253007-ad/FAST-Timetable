# CLAUDE.md — FAST Timetable

Project context for Claude Code sessions. Read this before changing anything.

## What this is

Unofficial weekly-timetable builder for FAST NUCES Karachi students. Students pick their
course sections, get a colour-coded weekly grid with clash detection, and export it as an
image. React 19 + Vite 7, Capacitor 8 for the Android wrapper, deployed on Vercel.
**June 2026: UI was fully rebuilt to a professional standard** (design system, light/dark
themes, chips selector, skeletons, clash detection, polished exports) while keeping the
original concept and data pipeline.

## Commands

```bash
npm run dev       # dev server on http://localhost:5173 (proxies /api)
npm run build     # production build → dist/
npm run lint      # eslint (android/ and dist/ are ignored — keep it that way)
npm run preview   # serve the production build
npx cap sync android   # copy dist/ into the Android project (run after builds for APK work)
```

## Architecture / data flow

1. `src/services/dataService.js` fetches `/api/data` — rewritten to
   `https://server-timetable2.vercel.app` by `vercel.json` (prod) and the Vite proxy (dev).
   Response: `{ karachi: { url, codes: [{ name: "Monday", gid }, ...] } }`.
2. Each weekday tab is fetched **in parallel** from the Google Sheet's gviz JSONP endpoint
   (`url + gid`), unwrapped, and flattened into
   `{ Course, Section, Instructor, Room, Day, Time }` records. Saturday is filtered out.
   Sheet layout: row 0 = slot numbers, row 1 = "Venues/time" + slot headers, rows 2+ = rooms.
   Cell format: `COURSE-CODE Name SECTION (groups)\nInstructor`.
3. `src/App.jsx` owns state: data, theme, selection, refresh/export. Auto-refetch hourly;
   manual refresh is non-blocking (keeps old data and shows an alert bar on failure).
4. `src/components/ClassSelector.jsx` — searchable multi-select (token search: every
   whitespace-separated token must match) + removable chips.
5. `src/components/TimetableGrid.jsx` — weekly grid. Consecutive identical sessions merge
   into one cell; courses containing "lab" span 3 slots; different classes inside a lab
   window are folded into the cell and flagged as a clash (dashed red outline + banner).
6. `src/utils/courseColors.js` — deterministic course→colour from a 10-colour palette
   (hash + linear probing). `src/components/Icons.jsx` — inline SVG icon set.

## Hard constraints — do not break

- **localStorage compat**: key `selectedClasses` stores legacy `"Course - Section"` strings.
  Existing users have saved data in this format. Split on the **last** `" - "`;
  section `"N/A"` means "no section". Never change the stored format.
- **html2canvas (1.4.1) export**: CSS must stay plain hex/rgba — **no `oklch()`/
  `color-mix()`** (it throws), and **no `font-variant-numeric`** (breaks glyph spacing in
  exports). Export clones the `[data-capture]` element, adds `.exporting`, forces 1480px
  width; `.exporting` CSS removes sticky positioning and overflow.
- **Sheet data is dirty**: time headers like `"09:50:-10:40"` / `"1:30-2:20"` — raw strings
  are dictionary keys; only format at display time (`formatSlot` regex-extracts clock times).
  Times before 7:00 are afternoon (add 12h) when sorting (`toMinutes`).
- **ESLint ignores `android/`** (contains compiled bundle copies from `cap sync`) — removing
  that ignore reintroduces ~210 phantom errors.
- The Android **appId `com.timetable.remake` must not change** (app identity); display name
  is "FAST Timetable" (capacitor.config.json + android strings.xml).
- ClassSelector Escape handler: refocus input **before** `setOpen(false)` — the input's
  onFocus sets open=true and the close must win in React's batch.

## Verification (no test suite)

Visual-verify with playwright-core + system Edge against the dev server:
`npm i -D playwright-core`, launch `chromium.launch({ channel: 'msedge', headless: true })`,
drive http://localhost:5173, screenshot states (empty / selected / dark / mobile / export
download), check console errors, then `npm uninstall playwright-core` (temporary scaffolding
— don't ship it). Always finish with `npm run lint && npm run build`.

## State at end of last session (2026-06-10)

- Full UI rebuild verified: lint clean, build clean, zero console errors, export PNG
  inspected, Escape bug + lab-clash-swallowing bug fixed, dead template files removed.
- README.md rewritten; package renamed `fast-timetable` v1.0.0.
- **Pending (not yet done)**: `npx cap sync android` + APK rebuild so the Android app picks
  up the new UI and "FAST Timetable" name. The `dist/` folder is current as of the rebuild.
- Possible future ideas (not requested yet): PWA manifest/offline cache, multi-campus
  support (API already namespaces `karachi`), shareable timetable links.
