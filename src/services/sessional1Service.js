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

// Extracts the first clock time in a Sessional-1 `time` string and converts
// it to minutes-since-midnight, for chronological sorting. Handles both
// formats this sheet actually contains: bare "HH:MM-HH:MM" (Main Campus —
// same "no AM/PM, hours under 7 mean afternoon" dirty-data convention the
// weekly timetable's own `toMinutes` already relies on, schedule.js) and
// explicit "HH:MM A.M./P.M." (Senior City Campus).
const timeToMinutes = (timeStr) => {
  const m = (timeStr || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const isPM = /P\.?M\.?/i.test(timeStr);
  const isAM = /A\.?M\.?/i.test(timeStr);
  if (isPM && hours < 12) hours += 12;
  else if (!isAM && !isPM && hours < 7) hours += 12;
  return hours * 60 + minutes;
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
