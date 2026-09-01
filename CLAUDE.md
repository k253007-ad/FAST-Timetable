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
npm run dev       # dev server on http://localhost:5173 (serves /api/data via Vite middleware)
npm run build     # production build → dist/
npm run lint      # eslint (android/ and dist/ are ignored — keep it that way)
npm run preview   # serve the production build
npx cap sync android   # copy dist/ into the Android project (run after builds for APK work)
```

## Architecture / data flow

1. `src/services/dataService.js` fetches `/api/data` — **as of 2026-08-18, served locally**:
   `api/data.js` (Vercel serverless function, prod) and a Vite dev-middleware in
   `vite.config.js` (dev) both return the same JSON from `api/sheetConfig.js`. This replaced
   proxying to a third-party service (`server-timetable2.vercel.app`, not ours — it belonged
   to the original app this was forked from) after the university's source sheet broke.
   Response: `{ karachi: { url, codes: [{ name: "Monday" }, ...] } }`. To repoint at a
   different Google Sheet, edit `SHEET_ID` in `api/sheetConfig.js`; nothing else needs to
   change as long as the new sheet's tabs are named Monday..Friday.
   - **2026-08-24: gids are auto-resolved by tab name, not hardcoded** — later replaced
     entirely, see 2026-08-25 below. (Kept for history: Google assigns every tab a brand-new
     gid each time the spreadsheet is re-imported/replaced, which silently broke the site once
     already — a stale gid falls back to Google's *first* tab instead of erroring, so every
     day showed Monday's classes.)
   - **2026-08-25: gids dropped entirely — day tabs are now fetched by name.** The gviz
     endpoint accepts a `sheet=<tab name>` param as a direct alternative to `gid=<gid>`
     (confirmed identical response `sig` either way), so there's no gid to go stale in the
     first place — `dataService.js`'s `fetchSheet` now does
     `fetch(sheetUrl + encodeURIComponent(sheetInfo.name))` and `codes` only ever carries
     `{ name }`. **Caveat found while making this change**: an unmatched `sheet=` name doesn't
     error — it silently falls back to gviz's first tab (HTTP 200, `status:"ok"`), the exact
     same failure shape as the old stale-gid bug, just from a different trigger (a renamed or
     mistyped tab). So `getSheetData()` still fetches the sheet's public `/htmlview` export
     (10-min in-memory cache) purely to confirm each of Monday..Friday exists as a real tab
     name before returning — it no longer reads or stores any gid from that page, just names.
     If a day tab is missing/renamed, `getSheetData()` throws with the tab names it actually
     found, surfacing as the app's failed-to-load alert bar rather than a silent wrong-day
     repeat. Verified end-to-end: fetched all 5 days through `/api/data` on the dev server and
     confirmed distinct row counts/content per day, zero console errors.
2. Each weekday tab is fetched **in parallel** from the Google Sheet's gviz JSONP endpoint
   (`url + sheet=<name>`), unwrapped, and flattened into
   `{ Course, Section, Instructor, Room, Day, Time }` records. Saturday is filtered out.
   Sheet layout: row 0 = slot numbers, row 1 = "Venues/time" + slot headers, rows 2+ = rooms.
   **Cell format changed 2026-08-30** — the master sheet was reformatted for human
   readability (colour-coded per course, one field per line) as `Course Name\nRoom\nSection\n
   Instructor`, replacing the old `Course(Section)\nInstructor` format. The Room line is
   parsed-but-ignored (the row's own first column is still the source of truth for Room); see
   the hard constraint below — this also retired the old last-parenthesized-group Section
   extraction entirely, since Section is now its own unambiguous line.
   - **2026-08-25: second, optional roll-number sheet.** `api/sheetConfig.js` also returns
     `karachi.rollNumbers` — `{ url }` if a roll-number spreadsheet is configured
     (`ROLL_SHEET_ID`), `null` otherwise (**configured and live as of 2026-08-25**; see
     "Roll No selection mode" below). Unlike the day tabs this is a **flat table**, not a Room×Time grid: one row per
     `RollNo | Day | Time | Course | Section | Instructor | Room`. `dataService.js`'s
     `fetchRollNumbers()` parses it by header name (not fixed offsets) and merges it into
     `timetable` — see that section for the merge/dedup logic, which matters a lot for
     `buildSchedule`'s clash detection.
3. `src/utils/schedule.js` (added 2026-08-19) — the shared schedule builder: `buildSchedule(data,
   selectedClasses, overrides = [])` turns raw rows + the current selection into `{ days,
   timeSlots, processedSchedule, sessionCount, courseCount, clashCount }` (labs span 3 slots,
   identical consecutive sessions merge, overlapping different classes fold into one cell as a
   clash). Also exports `toMinutes`, `formatSlot`, `cleanRoom`, `DAY_ORDER`, `getAllTimeSlots`.
   Both `TimetableGrid.jsx` and `NowNext.jsx` import this rather than each computing their own
   — keep it that way so they can't disagree about what a "session" is. **`overrides`
   (added 2026-08-31, see "Manual time overrides" below) relocates specific sessions before the
   grid is built** — `applyOverrides`, `getClassOccurrences`, and `buildMoveOverrides` are the
   supporting exports for that feature.
4. `src/App.jsx` owns state: data, theme, selection, refresh/export, and **5 independent
   timetable profiles** (added 2026-08-19 — see "Multi-profile storage" below). Auto-refetch
   hourly; manual refresh is non-blocking (keeps old data and shows an alert bar on failure).
5. `src/components/ClassSelector.jsx` — "My classes" card. Four top-level modes, toggled by
   tabs in the order **Manual, Roll No, Section, Teacher** (order changed 2026-08-30; see
   `ClassSelector.jsx`'s own doc comment for the full history — Section was re-added
   2026-08-26 after being dropped in the 2026-08-25 Auto-tab removal described below):
   - **Manual**: searchable multi-select (token search: every whitespace-separated token must
     match) + removable chips. Unchanged.
   - **Roll No** (2026-08-25): pick one student's roll number (e.g. "25K-3068", case-
     insensitive) and every class *that student* takes toggles on/off together. Groups are
     built from `data.rollNumbers` (the new merged-in sheet, see above), not `data.timetable`
     — more precise than section-based selection since electives vary per student even within
     the same nominal section. Shows an "isn't available yet" message instead of a search box
     if `data.rollNumbers` is ever empty (only possible now if `ROLL_SHEET_ID` gets unset).
   - **Teacher**: pick a teacher name and every class they teach toggles on/off together.
     Groups are built from `data.timetable` by `Instructor` — same underlying logic as before
     2026-08-25, just promoted from an Auto sub-tab to its own top-level tab.
   All three modes share one dropdown-panel pattern (`.combobox` / `.combobox-panel`); the
   outside-click-to-close listener is scoped to whichever `.combobox` wrapper is currently
   rendered via `comboboxRef` — **not** the whole card — so clicking the title/tabs/chips
   inside "My classes" still closes the dropdown. Also has a minimize toggle and the 1–5 +
   Main profile-slot switcher — **as of 2026-08-30, `.selector-toolbar` renders the minimize
   button + profile-slot row *above* the mode tabs, stacked in a column, at every viewport
   width** (previously the mode tabs came first with minimize/profile to their side on
   desktop). Don't reorder the JSX back without also checking `.selector-toolbar`/
   `.toolbar-secondary` in `index.css`, which assume this stacked order.
6. `src/components/TimetableGrid.jsx` — weekly grid, built from `buildSchedule`. Also
   highlights the live-right-now cell (green outline + "Now" badge) and the next upcoming one
   (dashed outline + "Next" badge), searching forward from today and **wrapping into next
   week** if today's classes are done — this is deliberately different scope from `NowNext.jsx`
   below. `is-today` row highlight uses real `new Date()`, recomputed every render (App
   re-renders every 60s via its own `now` ticker, so no separate timer needed here). **As of
   2026-08-30, a class box shows Course / Room / Section / Instructor in that order** (Section
   used to be appended to the course-name line as `"Course (Section)"`) — the tooltip mirrors
   the same order. `NowNext.jsx` still appends Section to the course line; that was left
   as-is since the request was specifically about the grid.
7. `src/components/NowNext.jsx` (added 2026-08-19) — "Now / Next" status card between the
   selector and the grid. **Scoped to today only** (does not wrap into tomorrow, unlike the
   grid's badges above): shows the live class / next class today, or "No class right now" /
   "No further classes" / "No classes today" depending on the gap. Intentionally a separate,
   simpler day-scoped query against the same `processedSchedule` — don't try to unify it with
   the grid's week-wrapping now/next logic, the fallback copy depends on staying day-scoped.
8. `src/utils/courseColors.js` — deterministic course→colour from a 10-colour palette
   (hash + linear probing). `src/components/Icons.jsx` — inline SVG icon set.

### Multi-profile storage (added 2026-08-19)

`App.jsx` supports 5 independent saved timetables (e.g. "my" schedule vs a friend's), switched
via number buttons 1–5 next to the mode tabs in `ClassSelector`. Storage:
- Profile 1 keeps the **legacy `selectedClasses` key** (existing users' saved selections keep
  landing correctly). Profiles 2–5 use `selectedClasses_2` … `selectedClasses_5`.
- The active slot is tracked separately in the `activeProfile` key.
- Switching profiles just swaps which key `selectedClasses` state reads/writes — see
  `getProfileStorageKey` / `switchProfile` in `App.jsx`. Never change this key scheme (same
  reasoning as the hard constraint below).

### Manual time overrides (added 2026-08-31)

Lets a student correct their own view when the university moves a specific class but the
shared, manually-updated sheet hasn't caught up — "my class moved from Wednesday slot 4 to
Thursday slot 7." A per-device override, never a change to the shared data.

- **Model**: `{ course, section, day, time, newDay, newTime }` — one raw timetable row's
  relocation (`utils/schedule.js`). `applyOverrides(items, overrides)` swaps a matching row's
  `Day`/`Time`; `buildSchedule`'s new `overrides` param applies it to the selected rows before
  the grid is built, so a moved class clashes/merges with other selected classes exactly like a
  real conflict would.
- **`getClassOccurrences(data, selectedClasses)`** turns raw rows into one entry per
  (Course, Section, Day) *session* — a multi-slot lab collapses into one occurrence spanning its
  actual consecutive slots, so moving it moves the whole block. Always computed from the
  *official*, un-overridden schedule, so an occurrence's identity stays stable while it has an
  active override. **De-dupes to distinct slot *times* before detecting consecutive runs** —
  the sheet can have more than one raw row for the identical (Course, Section, Day, Time) (the
  same section split across two rooms/instructors for capacity, same phenomenon as the
  double-booked cells found during the 2026-08-30 PDF rebuild) — treating each raw row as its
  own run-position instead produces bogus duplicate occurrences at the same time (hit this as a
  real React duplicate-key bug while building the feature). `applyOverrides` still relocates
  every raw row sharing that (course, section, day, time) key, so de-duping here doesn't drop
  either room's row when the slot moves.
- **`buildMoveOverrides(occurrence, timeSlots, newDay, newStartSlot)`** turns a "move this
  occurrence to {newDay} starting at {newStartSlot}" UI action into the per-slot override
  entries above; returns `null` if the target day doesn't have enough slots left to fit the
  whole occurrence (surfaced as an inline error in the UI, not a silent no-op).
- **Storage**: `classOverrides` (profile 1, legacy-style), `classOverrides_2`.."_5"`,
  `classOverrides_main` — same per-profile key scheme as `selectedClasses*` above, additive/
  separate keys. `useClassNotifications` reads `classOverrides_main` fresh from localStorage
  every tick, same reasoning as its existing `getMainClasses`.
- **UI** (`ClassSelector.jsx`): a collapsible "Adjust class times" section below the chip row, one
  `RescheduleRow` per occurrence with Day/Slot `<select>`s and a Move/Update/Reset button set.
  Its match/removal logic checks the occurrence's own original slots, not just
  Course+Section+Day — two occurrences can legitimately share a day (a lecture plus a
  separately-scheduled lab), and moving one must never touch an override on the other.

### Roll No selection mode (added 2026-08-25, reworked 2026-08-27)

**2026-08-27 rework — now a live join, not a self-contained sheet.** The original design
(below, kept for history) built a flat per-student sheet by extracting the university's
920-page `Student_Timetables_Version 1.pdf`, one row per class with its own full
Day/Time/Room/Instructor text. That's been replaced with a much smaller compact sheet the
user maintains directly: **one row per student, column A the roll number, every other column
in that row a `"SHORTCODE (Section)"` cell** — e.g. `25K-3097, DS (BSE-3B), DS-Lab (BSE-3B),
COAL (BSE-3B), ...`. Row 0 is a header (skipped); trailing blank cells are fine since students
take different numbers of courses.

- **Short codes are generated, not hand-picked.** `buildCourseCodeMap(timetable)` in
  `src/utils/schedule.js` derives a `SHORTCODE -> full course name` map from the master
  sheet's own course names every time data loads (first letter of each significant word,
  skipping the same stopword list `abbreviateCourse` uses; a lab keeps its lecture's code plus
  a `-Lab` suffix instead of colliding with it, e.g. "Data Structures" -> `DS`, "Data
  Structures - Lab" -> `DS-Lab`). Two different courses that abbreviate to the same code are
  disambiguated by ranking on **session count** (how many timetable rows that course name
  appears in) and appending `2`, `3`, ... to every course after the most common one — e.g.
  `DS` resolves to "Data Structures" (54 sessions) over "Data Science" (3 sessions), since
  that's almost always what a hand-written `DS` in the roll sheet means. The map is always
  derived fresh from whatever the master sheet currently contains — there's no persisted
  legend baked into the app — but a snapshot for building/checking the roll sheet by hand
  lives at `course_code_legend.txt` (workspace root); regenerate it by running a small script
  against `/api/data` + `buildCourseCodeMap` (see chat history 2026-08-27 for the exact
  script) whenever the master sheet's course list changes meaningfully.
- **`dataService.js`'s `fetchRollNumbers(url, codeMap)` no longer carries any
  Day/Time/Room/Instructor.** It just resolves each `"CODE (Section)"` cell to
  `{ RollNo, Course, Section }` via the code map and drops it into `data.rollNumbers` —
  `ClassSelector.jsx`'s `rollNoGroups` builder (unchanged) turns that into `"Course -
  Section"` chip values exactly like Teacher/Section mode, and `buildSchedule` looks up the
  actual session details live from `data.timetable` by that same string. **No merge/dedup
  step exists any more** — the old dedup-into-`data.timetable` logic (keyed on
  `Section|Day|Time`) was removed entirely along with the flat sheet it existed to reconcile.
- **A code the map doesn't recognize is dropped with a `console.warn`**, not silently
  injected — most likely a typo in the sheet, or the master sheet's course list (and thus the
  generated codes) shifted since the code was written down. If the master sheet's course
  names change meaningfully, codes can shift too (a course's session count changing could flip
  which side of a collision gets the plain code) — regenerate the legend and diff it against
  what's in the roll sheet if entries start disappearing silently.
- **Known blocker, not fixed**: ~31 of 189 unique course-name cells on the live master sheet
  are the pre-existing garbled-cell bug (see 2026-08-24/25 entries in the workspace-root
  `CLAUDE.md` session log — character-interleaved text from a PDF page-break defect, still
  present because the user asked to leave the master sheet alone). Those courses can't get a
  meaningful short code until that's fixed; `buildCourseCodeMap` doesn't filter them out, it
  just faithfully abbreviates whatever garbage text is there.
- **The "Understanding Sirat-Un-Nabi" near-duplicate-codes issue above was actually a
  `parseCellValue` bug, not a modeling quirk — fixed 2026-08-27.** See the new hard-constraint
  bullet above: that course's cell text has two parenthesized groups
  (`"Understanding Sirat-Un-Nabi (PBUH)(Section)"`), and the Section-extraction regex was
  taking the first one ("PBUH") instead of the last, leaving the real section baked into the
  Course string. Fixing it collapsed what looked like 25 separate courses into one clean
  entry (`Understanding Sirat-Un-Nabi (PBUH)`) and fixed Section/Teacher mode's handling of
  that course too, not just Roll No mode.
- **The compact roll-number sheet has been built, not just designed** — from the *old*
  920-page-PDF extraction (`FAST_Timetable_RollNumbers.xlsx`, workspace root, the 2026-08-25
  design's output), not by re-parsing the PDF itself. Every row's `Course` was matched against
  the current `buildCourseCodeMap` output to get its short code; two data-quality issues in
  that old extraction needed handling along the way — course names were truncated to exactly
  20 characters (resolved via prefix-matching against the current course list; ambiguous
  lecture/lab pairs disambiguated using each row's own `Room` text, since lab rooms always
  contain "Lab") and one row had a real mojibake replacement character that turned out to be a
  terminal-rendering artifact on inspection, not actual data loss. Result:
  **`FAST_Timetable_RollNumbers_Compact.xlsx`** (workspace root), 2,822 students, 18,271 of
  18,272 course entries resolved and confirmed present in the current master timetable
  (99.995% — the one gap is a course offering that no longer exists for that section on the
  live sheet, not a bug). **Uploaded and live as of 2026-08-27**: new Google Sheet
  `1-OU7HxwLf7sIc-rtyCUB6Hf7SuMEvyZtD2stFv--DHM` (tab `RollNumbers`), `ROLL_SHEET_ID` updated
  in `api/sheetConfig.js`, verified end-to-end in a real browser (Roll No tab lists all 2,822
  roll numbers, selecting a roll number correctly loads its classes onto the grid, zero
  console errors).
- Course names use the same `Course` + separate `Section` field convention as the master
  sheet's cell format — `formatClassLabel` (`courseColors.js`) already renders these as
  `"Course Name (Section)"`, no new formatting code needed.

<details>
<summary>Original 2026-08-25 design (superseded 2026-08-27, kept for history)</summary>

Built by extracting the university's `Student_Timetables_Version 1.pdf` (920 pages,
"Timetable for `<ROLLNO>`" blocks) into a flat sheet: one row per class a student takes,
columns `RollNo | Day | Time | Course | Section | Instructor | Room`. Full pipeline
(extraction script, cross-reference logic, stats) is written up in the workspace root
`TASK_roll_number_mode.md`.

`api/sheetConfig.js`'s `ROLL_SHEET_ID` pointed at `1JJGeX8KPI305GanliNKKA6FA61Ku-ypFPs_0opKhXD0`
(tab `RollNumbers`, source file `FAST_Timetable_RollNumbers.xlsx` in the workspace root,
37,652 rows / 2,822 K-campus students). The sheet was deliberately self-contained rather than
a live join — the master sheet was considered too much of a moving target at the time (see
the 2026-08-25 "whole schedule broken" / spreadsheet-revert incident in the workspace root
session log) — so every row carried its own full `Course`/`Instructor`/`Room` text, resolved
once offline at extraction time by matching the master sheet on `(Section, Day, Time)` (97.8%
of rows) with the PDF's own text as a fallback (2.2%). `dataService.js`'s `fetchData()` then
merged `data.rollNumbers` into `data.timetable`, deduped on `Section|Day|Time` so a roll-number
row that already matched a master entry didn't get double-counted as a clash by
`buildSchedule`.

The 2026-08-27 rework replaced all of this with a live join instead, once the "moving target"
concern was judged less important than the size/maintainability of a 37k-row hand-extracted
sheet — see above.

</details>

## Hard constraints — do not break

- **Manual-override matching must key on the occurrence's own slots, not just
  Course+Section+Day** — a course can legitimately meet twice on the same day (a lecture plus
  a separately-scheduled lab), so two different occurrences can share a
  `${course}|${section}|${day}` prefix. `ClassSelector.jsx`'s `belongsToOccurrence` checks
  `occurrence.slots.includes(o.time)` for exactly this reason — narrowing it back to
  Course+Section+Day would make moving one occurrence silently delete an override on the other.
  Similarly, `getClassOccurrences` in `schedule.js` de-dupes to distinct slot *times* before
  detecting consecutive runs, because the sheet can have more than one raw row at the identical
  (Course, Section, Day, Time) (same section split across two rooms for capacity) — treating
  each raw row as its own run-position produces duplicate-identity occurrences (hit as a real
  React key-collision bug 2026-08-31).
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
- **Superseded 2026-08-30, kept for history**: a cell's Section used to be extracted as the
  LAST parenthesized group in its first line (fixed 2026-08-27, after a bug where "Understanding
  Sirat-Un-Nabi (PBUH)(Section)"'s two `(...)` groups made the first one get misread as the
  section). The 2026-08-30 sheet reformat made Section its own explicit line
  (`Course Name\nRoom\nSection\nInstructor`), so this parenthesis-parsing logic doesn't exist
  in `parseCellValue` any more — a course name can now contain as many literal parentheses as
  it wants with zero ambiguity. Don't reintroduce paren-based section parsing without a strong
  reason; the explicit-line format is strictly more robust.
- **The master sheet's per-cell Room line (2nd of 4 lines) is display-only and never parsed**
  — `dataService.js`'s `parseCellValue` reads Course (line 1), Section (line 3), and Instructor
  (line 4), skipping line 2 entirely. The authoritative Room for each entry always comes from
  that row's own first column (`room` in `fetchSheet`), which is guaranteed consistent with the
  cell's own Room line only because the rebuild script that generates the sheet copies it from
  there in the first place — if the master sheet is ever hand-edited, keep them in sync or drop
  the redundant line rather than let them disagree silently.
- **ESLint ignores `android/`** (contains compiled bundle copies from `cap sync`) — removing
  that ignore reintroduces ~210 phantom errors.
- The Android **appId `com.timetable.remake` must not change** (app identity); display name
  is "FAST Timetable" (capacitor.config.json + android strings.xml).
- ClassSelector Escape handler: refocus input **before** `setOpen(false)` — the input's
  onFocus sets open=true and the close must win in React's batch.
- **Any UI driven by `new Date()` (today highlight, now/next badges, the NowNext card) — or
  otherwise scoped to only part of a print/export (extra classes, added 2026-08-31) — must be
  excluded from both print AND export** — these are two separate mechanisms that must be kept
  in sync by hand: `@media print` in `index.css` for real browser printing, and the
  `.exporting` class (added by `handleExport`'s `onclone` in `App.jsx`) for the PNG/JPG
  html2canvas capture. Every such class added to the grid so far (`.today-pill`, `.is-today`,
  `.now-badge`, `.next-badge`, `.is-now`, `.is-next`, `.class-box.is-extra`) has a reset rule in
  *both* places — copy that pattern for any new live/one-off indicator, and check both a print
  preview and an actual export when testing one.
- `.grid-toolbar` (the legend + session-count line above the grid) is the inverse: hidden on
  screen (`display: none`) and shown *only* in print/export, via the same two mechanisms.
- Multi-profile localStorage keys (`selectedClasses`, `selectedClasses_2`..`_5`,
  `activeProfile`) — never change this scheme, see "Multi-profile storage" above.
  `selectedClasses_main` (added 2026-08-25, see below) is a separate additive key, same rule.
- **`useClassNotifications` always reads `selectedClasses_main` fresh from localStorage**,
  never from React state — notifications must reflect the Main profile regardless of which
  profile tab is currently open in ClassSelector. Don't "simplify" this to read the `selectedClasses`
  prop/state instead; that would make notifications follow whatever profile you're browsing.
- **`public/sw.js` must stay cache-free** — no `caches.open`/fetch-intercepting logic. It
  exists only for notification action buttons (`registration.showNotification`) and PWA
  installability. Adding an offline cache here reintroduces exactly the stale-content risk
  flagged in the 2026-08-19 PWA discussion (service workers silently serving old code to
  installed devices) — if that's ever wanted, it needs deliberate cache-versioning design,
  not an incidental addition.

### Class notifications + PWA (added 2026-08-25)

No backend — see the workspace-root `CLAUDE.md` session log for why (real push that fires
with the app fully closed needs a server + database to store every user's subscription and
selected classes, plus a scheduled job; out of scope). Instead:

- `public/manifest.json` + `public/sw.js` make the site installable (Add to Home Screen /
  desktop install). `public/icons/` (192, 512, maskable-512, badge-72) generated from the
  brand mark's colour scheme — regenerate by rasterizing `public/favicon.svg` at those sizes
  if the brand mark ever changes; nothing currently automates that.
- `src/hooks/useClassNotifications.js` drives the whole feature: a 20s-interval timer (while
  the tab/PWA is open or backgrounded — **not** truly closed) computes today's now/next class
  for the **Main** profile specifically (see the hard constraint above) via `buildSchedule`,
  and fires a local notification through the service worker (`utils/notifications.js`'s
  `showAppNotification`, which calls `registration.showNotification` so action buttons
  render — the plain `Notification` constructor doesn't support `actions`).
  - "Now" notification: title `Now: {abbreviateCourse(course)}`, body `{room} · Ends {time}`,
    one action button ("Class ended"). Fires once per distinct session (deduped by
    `sessionKey` from `schedule.js` — `Course|Section|startMin|endMin`), not on every tick.
  - "Class ended" (via the SW action button, or the identical in-app button rendered in
    `NowNext.jsx` when `isMainProfile` is true) suppresses that session immediately —
    `markCurrentEnded` sets both a ref (read by the tick loop, avoids stale closures) and
    real state `manualEndedKey` (read by `NowNext.jsx` so its own display updates the same
    render, not up to 20s later on the next tick). Resets automatically once the real class
    changes.
  - "Next" notification fires once when transitioning into the gap before the next class,
    and can fire a second time at the "10 minutes left" mark **only if** the user dismissed
    the first one (tracked via the SW's `notificationclose` event, which is not reliably
    fired on every browser/platform — this is a best-effort resurfacing, not guaranteed).
  - Bookkeeping (which sessions have already been notified) resets at midnight (keys are
    `Course|Section|startMin|endMin` with no date component, so a Monday class and next
    Monday's identical class share a key — must reset per calendar day, not just per session).
- **iOS Safari**: the `Notification` API is unavailable in a normal browser tab; the bell
  button in `App.jsx`'s header shows a disabled "aren't supported" state via
  `notificationPermission() === 'unsupported'`. iOS 16.4+ supports it for a home-screen-
  installed PWA specifically — not verified hands-on this session (no iOS device available),
  so treat that path as unconfirmed rather than working.

## Verification (no test suite)

Visual-verify with playwright-core + system Edge against the dev server:
`npm i -D playwright-core`, launch `chromium.launch({ channel: 'msedge', headless: true })`,
drive http://localhost:5173, screenshot states (empty / selected / dark / mobile / export
download), check console errors, then `npm uninstall playwright-core` (temporary scaffolding
— don't ship it). Always finish with `npm run lint && npm run build`.

## State at end of last session (2026-08-25, roll number mode)

- Built the Roll No selection mode end to end: PDF extraction pipeline (920 pages →
  `FAST_Timetable_RollNumbers.xlsx`, 2,822 students), the merge/dedup logic in
  `dataService.js`, the 3-tab `ClassSelector.jsx` restructure (Manual / Roll No / Teacher,
  replacing Manual/Auto), and the Export→Print rename. Full design in the new "Roll No
  selection mode" section above; full process/decision log in the workspace root
  `TASK_roll_number_mode.md` (keep reading that file first if resuming this work — it has the
  extraction pipeline details, the mocked-network test approach, and exactly what's left).
- **Update, same day**: `FAST_Timetable_RollNumbers.xlsx` was uploaded to Google Sheets
  (`1JJGeX8KPI305GanliNKKA6FA61Ku-ypFPs_0opKhXD0`, tab `RollNumbers`) and `ROLL_SHEET_ID` in
  `api/sheetConfig.js` is now set — **Roll No mode is live**, re-verified against the real
  sheet (not just synthetic data): search/select works, no false clashes, no console errors.
  Also: the extraction pipeline itself got two real bug fixes after this was first written —
  a pdfplumber memory leak over 920 pages, and a table-detection artifact that could bleed one
  column's entry into another and break lab-session matching — see `TASK_roll_number_mode.md`
  for the full account. Final numbers: 2,822 students, 37,652 entries, 1.9% PDF-fallback (down
  from 2.2%), with the remaining fallback traced to the already-known garbled-cell issue on
  the master sheet below, not a defect in this pipeline.
- Found (incidentally, while cross-referencing PDF data against the master sheet) that the
  live master sheet currently has the pre-2026-08-24-fix garbled-cell bug back, almost
  certainly from the "revert to a previous version" mentioned in the same day's workspace root
  session log. **User explicitly said to leave the master sheet alone this session** ("we
  wont touch the other spreadsheet") — not fixed, not in scope, just flagged here so it isn't
  mistaken for a new regression next time someone notices it.
- Still not pushed to GitHub — this session touched `api/sheetConfig.js`,
  `src/services/dataService.js`, `src/components/ClassSelector.jsx`, `src/components/Icons.jsx`,
  `src/App.jsx`, `src/components/TimetableGrid.jsx`, `src/index.css`, on top of everything
  already on that list.

## State at end of last session (2026-08-25, later)

- User reported the "every day shows the same day's classes" glitch again. Checked the live
  Google Sheet directly first — tabs and gids were all correctly distinct, so the sheet itself
  wasn't stale. Given this project still isn't pushed to GitHub (see workspace root To-do),
  the leading theory is that the 2026-08-24 gid-by-name fix never made it to the deployed
  Vercel site — **not independently confirmed**, user hasn't shared the live URL yet.
- Regardless of that, user asked to stop requiring gids at all. Implemented: gviz's `sheet=`
  param replaces `gid=` entirely (see the 2026-08-25 architecture bullet above for the full
  design, including the silent-fallback caveat that made keeping an htmlview name-check still
  necessary). This is a strictly more robust version of the 2026-08-24 fix, not a full
  explanation of today's report — still worth checking the deployed site once the URL is
  known, and worth pushing this change to GitHub so it actually reaches production.

## State at end of last session (2026-08-25)

- Added: a "Main" 6th profile slot (before 1-5, its own `selectedClasses_main` key) that
  represents the user's own timetable specifically; a full local-notifications system (PWA
  manifest + service worker + `useClassNotifications` hook) giving real OS notifications for
  the current/next class, driven off the Main profile regardless of which profile tab is
  open — see "Class notifications + PWA" above for the full design and its deliberate
  no-backend limitation (fires only while the app is open/backgrounded, not fully closed).
  New icon set at `public/icons/` generated from the brand mark's colours via Pillow (no
  cairosvg/native SVG rasterizer available in this environment).
- Every change verified with a temporary `playwright-core` install against the dev server —
  this session additionally used `page.clock` to fake-advance time into a real class's
  window and confirmed an actual `showNotification` call fires with the right title/body/
  action, that the in-app "Class ended" button suppresses it immediately (same render, via
  the `manualEndedKey` state described above), and that it doesn't re-fire spuriously.
  Removed afterward, as always. `npm run lint && npm run build` clean throughout.
- **Data-quality finding, not a code change**: while testing, re-validated the rebuilt
  `FAST_Timetable_Fall2026.xlsx` (see workspace-root `CLAUDE.md`, 2026-08-24 entries) with a
  stricter check than the previous session used, and found ~13 more cells with the same
  PDF page-break duplication defect that the previous session's narrower validation missed
  (it only checked "does this parse into 5 comma fields", not "is the content actually
  clean" — a garbled-but-coincidentally-5-field cell passed silently). Fixed all of them the
  same way (char-position reconstruction, cross-checked against rendered PDF crops) and
  regenerated the workbook; a whole-file automated garble scan now finds zero suspects. The
  live Google Sheet still has the older, less-clean version — needs re-upload, see workspace
  To-do.
- **Not yet pushed to GitHub** — still not a git repo locally; see the workspace-root
  `CLAUDE.md` To-do for the current file list and the offer to set up git properly instead of
  continuing manual uploads.
- `npx cap sync android` + APK rebuild is still pending and now further out of date (the
  `dist/` folder predates all of today's changes too, on top of everything since
  2026-08-18).
- Possible future ideas (not requested yet): real server-backed push notifications (would
  need a database + scheduled job, see "Class notifications + PWA" above), multi-campus
  support (API already namespaces `karachi`), shareable timetable links.

> Cross-session To-do list and session log now live in `../CLAUDE.md` (workspace root) —
> check that file first when starting a new session.
