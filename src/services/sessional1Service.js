// Sessional-1 exam seating (added 2026-09-18, on request: "make an option
// of print Sessional-1 Seatings which gives timetable of selected
// courses"). Fetches the Sessional-1 Google Sheet (`karachi.sessional1.url`
// from `/api/data` — see api/sheetConfig.js) and matches it against the
// student's currently selected courses.
//
// This is a genuinely SEPARATE data source from the weekly timetable/roll-
// number sheets — a one-off Fall 2026 exam datesheet built by extracting
// the university's own Sessional-1 PDF (see workspace-root CLAUDE.md for
// the extraction process). It is NOT fetched as part of the main
// `fetchData()` waterfall on every load — only lazily, the first time the
// student opens the "Sessional-1 seatings" card in App.jsx — since it's a
// secondary, time-boxed feature that shouldn't add latency to the app's
// normal "instant open" path.

// A small, dedicated `/api/data` call (rather than plumbing the URL through
// `buildTimetableFromMeta`'s return shape) — this is a lazy, click-
// triggered fetch, not part of the main data-load waterfall, so a second
// tiny request here (the endpoint is already server-side cached for 10
// minutes, see api/sheetConfig.js) is simpler than widening an unrelated
// function's contract just to carry one extra URL through it.
export const getSessional1Url = async () => {
  const res = await fetch('/api/data', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to fetch /api/data (HTTP ${res.status})`);
  const json = await res.json();
  return json?.karachi?.sessional1?.url || null;
};

const parseGvizResponse = (text) => {
  if (!text.includes('google.visualization.Query.setResponse')) {
    throw new Error('Invalid response from Sessional-1 sheet (no JSONP wrapper).');
  }
  const jsonText = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
  return JSON.parse(jsonText);
};

/**
 * Fetches and parses the Sessional-1 sheet into an array of records. Parses
 * by column LABEL (not fixed index) — the sheet's own header row —
 * matching this project's existing convention (see `parseRollNumbers`'
 * doc comment in timetableSource.js) so column reordering doesn't silently
 * break this.
 */
export const fetchSessional1 = async (url) => {
  if (!url) return [];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Sessional-1 sheet (HTTP ${response.status})`);
  }
  const json = parseGvizResponse(await response.text());
  const cols = json?.table?.cols || [];
  const rows = json?.table?.rows || [];
  const idx = {};
  cols.forEach((c, i) => {
    if (c?.label) idx[c.label.trim()] = i;
  });

  const val = (cells, label) => {
    const i = idx[label];
    if (i === undefined) return '';
    const v = cells[i]?.v;
    return v === null || v === undefined ? '' : String(v).trim();
  };

  return rows.map((row) => {
    const cells = row.c || [];
    return {
      campus: val(cells, 'Campus'),
      day: val(cells, 'Day'),
      date: val(cells, 'Date'),
      time: val(cells, 'Time'),
      room: val(cells, 'Room'),
      code: val(cells, 'Course Code'),
      name: val(cells, 'Course Name'),
      section: val(cells, 'Section'),
      allSections: val(cells, 'All Sections (same exam)'),
      studentCount: val(cells, 'Student Count'),
      invigilators: val(cells, 'Invigilators'),
    };
  });
};

// The Sessional-1 sheet groups sections at a broader level than the weekly
// timetable does — e.g. one exam session covers section "BCS-1" as a
// whole, while a selected class is the finer "BCS-1J"/"BCS-1A"/etc. (one
// specific room-section from the weekly sheet). A selected section matches
// a Sessional-1 row's section if it's EXACTLY that code, or if it's that
// code plus exactly one trailing uppercase letter (the sub-section
// suffix) — verified directly against the live master sheet before
// building this (e.g. "BCS-1A".."BCS-1L" all trace back to "BCS-1").
const sectionMatches = (selectedSection, sessionalSection) => {
  if (!sessionalSection) return false;
  const a = selectedSection.trim().toUpperCase();
  const b = sessionalSection.trim().toUpperCase();
  if (a === b) return true;
  return a.startsWith(b) && /^[A-Z]$/.test(a.slice(b.length));
};

/**
 * Matches the student's selected "Course - Section" strings (same format
 * used throughout this app — see the workspace CLAUDE.md's localStorage
 * hard constraint) against the parsed Sessional-1 entries. Returns one
 * result per selected class: `{ classKey, course, section, entry }`, where
 * `entry` is null if that class has no Sessional-1 exam on record (a real,
 * expected state for e.g. a lab-only component or a course this datesheet
 * simply doesn't cover — shown as "not scheduled" rather than hidden).
 */
export const matchSessional1 = (entries, selectedClasses) => {
  return selectedClasses.map((classKey) => {
    const lastSep = classKey.lastIndexOf(' - ');
    const course = lastSep === -1 ? classKey : classKey.slice(0, lastSep);
    const section = lastSep === -1 ? 'N/A' : classKey.slice(lastSep + 3);
    const normCourse = course.trim().toLowerCase();
    const entry =
      entries.find(
        (e) => e.name.trim().toLowerCase() === normCourse && sectionMatches(section, e.section)
      ) || null;
    return { classKey, course, section, entry };
  });
};

// Extracts every clock time found in a Sessional-1 `time` string and
// converts each to minutes-since-midnight — used both for chronological
// sorting (just the first/start time) and for clean AM/PM display (start
// AND end). Handles both formats this sheet actually contains: bare
// "HH:MM-HH:MM" (Main Campus — same "no AM/PM, hours under 7 mean
// afternoon" dirty-data convention the weekly timetable's own `toMinutes`
// already relies on, schedule.js) and explicit "HH:MM A.M./P.M." (Senior
// City Campus) — the AM/PM markers, when present, always win over the
// hours-under-7 heuristic.
const parseTimeRangeMinutes = (timeStr) => {
  const isPM = /P\.?M\.?/i.test(timeStr);
  const isAM = /A\.?M\.?/i.test(timeStr);
  return [...(timeStr || '').matchAll(/(\d{1,2}):(\d{2})/g)].map(([, h, m]) => {
    let hours = Number(h);
    if (isPM && hours < 12) hours += 12;
    else if (!isAM && !isPM && hours < 7) hours += 12;
    return hours * 60 + Number(m);
  });
};

const timeToMinutes = (timeStr) => parseTimeRangeMinutes(timeStr)[0] ?? 0;

const minutesToClock = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

/**
 * Reconstructs a clean, unambiguous "8:30 AM – 9:30 AM" range from whatever
 * this sheet's own `time` string looks like — added 2026-09-18 (on request:
 * "polish the exam timetable and make it visually beautifull and easy to
 * understand") specifically because the raw Main Campus format
 * ("01:00-02:00") reads as ambiguous/wrong at a glance without knowing the
 * sheet's own "under 7 means afternoon" convention; this makes that
 * explicit instead of leaving the student to work it out. Falls back to
 * the raw string untouched if it doesn't contain two parseable times,
 * rather than risk mangling an unexpected format.
 */
export const formatSessional1TimeRange = (timeStr) => {
  const [start, end] = parseTimeRangeMinutes(timeStr);
  if (start === undefined || end === undefined) return timeStr;
  return `${minutesToClock(start)} – ${minutesToClock(end)}`;
};

/** "2026-09-19" -> "Sep 19, 2026" (falls back to the raw string if unparseable). */
export const formatSessional1Date = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * The actual list the UI renders (2026-09-18, on request: "the courses
 * which data is not found should not show. make it so the exam is in
 * order not course name order, time order") — `matchSessional1`'s output
 * filtered down to only classes with a real Sessional-1 match, sorted
 * chronologically by exam date then time, not by course name or the order
 * classes happen to be selected in.
 */
export const getSessional1Schedule = (entries, selectedClasses) => {
  return matchSessional1(entries, selectedClasses)
    .filter((m) => m.entry)
    .sort((a, b) => {
      if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
      return timeToMinutes(a.entry.time) - timeToMinutes(b.entry.time);
    });
};

/**
 * Groups an already-sorted `getSessional1Schedule` result by exam date —
 * `[{ date, day, isToday, isTomorrow, items }]`, in the same chronological
 * order. `todayISO` is the caller's current date (Asia/Karachi, since
 * that's the calendar the sheet's own dates are in — same fixed +5h
 * convention `notifyLogic.js` already relies on) as "YYYY-MM-DD", used
 * only to flag "Today"/"Tomorrow" — a real, useful cue given exams are
 * imminent, not decorative.
 */
export const groupSessional1ByDay = (schedule, todayISO) => {
  const groups = [];
  let current = null;
  // Deliberately Date.UTC (not `new Date(\`${todayISO}T00:00:00\`)`, which
  // parses as LOCAL time) — mixing a local-parsed Date with `toISOString`'s
  // always-UTC read-back is exactly the kind of off-by-one bug this hit
  // once already: on a machine whose system timezone happens to already be
  // Asia/Karachi (UTC+5), any `todayISO` before ~05:00 local would parse as
  // local midnight, land at 19:00 UTC the PREVIOUS day, and the +24h/
  // toISOString round trip would land back on today's date instead of
  // tomorrow's. `Date.UTC` builds midnight UTC for that Y-M-D directly, so
  // the whole +1-day/toISOString round trip stays UTC-to-UTC throughout,
  // with no local-timezone step to introduce ambiguity.
  const [y, mo, d] = todayISO.split('-').map(Number);
  const tomorrowISO = new Date(Date.UTC(y, mo - 1, d) + 86400000).toISOString().slice(0, 10);
  for (const m of schedule) {
    const { date, day } = m.entry;
    if (!current || current.date !== date) {
      current = { date, day, isToday: date === todayISO, isTomorrow: date === tomorrowISO, items: [] };
      groups.push(current);
    }
    current.items.push(m);
  }
  return groups;
};
