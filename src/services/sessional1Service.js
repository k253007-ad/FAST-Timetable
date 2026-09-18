// Sessional-1 exam seating (added 2026-09-18, on request: "make an option
// of print Sessional-1 Seatings which gives timetable of selected
// courses"). Fetches the Sessional-1 Google Sheet (`karachi.sessional1.url`
// from `/api/data` — see api/sheetConfig.js) and matches it against the
// student's currently selected courses.
//
// **Reworked 2026-09-19, on request: "remake the exam schedule so the seat
// and room no is mentioned."** The sheet is now sourced from the
// university's own per-student seating-plan/exam-slip PDF (4,543 students,
// 22,881 exam entries — see workspace-root CLAUDE.md's "Sessional-1
// seatings" section for the extraction) instead of the earlier per-
// (course,section)-only datesheet. Critically, **room/seat vary PER
// STUDENT, not per course+section** — confirmed by scanning the whole
// source document before building this: 445 of 545 (course,section) pairs
// had multiple distinct room/seat values across their own students, so a
// single "this section sits in room X" fact would often just be wrong for
// a specific student. Day/date/time, by contrast, IS uniform within a
// (course,section) group (confirmed the same way, 0/545 groups
// disagreed) — only the physical seat differs.
//
// This is a genuinely SEPARATE data source from the weekly timetable/roll-
// number sheets — a one-off Fall 2026 exam dataset. It is NOT fetched as
// part of the main `fetchData()` waterfall on every load — only lazily,
// the first time the student opens the "Sessional-1 seatings" card in
// App.jsx — since it's a secondary, time-boxed feature that shouldn't add
// latency to the app's normal "instant open" path.

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
 * Fetches and parses the Sessional-1 sheet into a flat array of per-student
 * exam-entry records. Parses by column LABEL (not fixed index) — the
 * sheet's own header row — matching this project's existing convention
 * (see `parseRollNumbers`' doc comment in timetableSource.js) so column
 * reordering doesn't silently break this.
 */
export const fetchSessional1 = async (url) => {
  if (!url) return [];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Sessional-1 sheet (HTTP ${response.status})`);
  }
  const json = parseGvizResponse(await response.text());
  const cols = json?.table?.cols || [];
  let rows = json?.table?.rows || [];
  const idx = {};
  cols.forEach((c, i) => {
    if (c?.label) idx[c.label.trim()] = i;
  });

  // Google's gviz endpoint doesn't always recognize row 1 as a header —
  // whether it does depends on how the sheet's data was entered/pasted,
  // not something this app controls. When it doesn't, `cols[].label` come
  // back blank and the real header text ends up sitting in `rows[0]` as
  // ordinary data instead (confirmed directly against the real uploaded
  // sheet, 2026-09-19 — every `cols[].label` was `''`). Detect that case
  // and fall back to reading the header from `rows[0]`'s own cell values,
  // consuming that row so it isn't parsed as a bogus student record.
  if (cols.length > 0 && cols.every((c) => !c?.label) && rows.length > 0) {
    const headerCells = rows[0].c || [];
    headerCells.forEach((cell, i) => {
      const label = cell?.v;
      if (label) idx[String(label).trim()] = i;
    });
    rows = rows.slice(1);
  }

  const val = (cells, label) => {
    const i = idx[label];
    if (i === undefined) return '';
    const v = cells[i]?.v;
    return v === null || v === undefined ? '' : String(v).trim();
  };

  return rows.map((row) => {
    const cells = row.c || [];
    return {
      rollNo: val(cells, 'Roll No'),
      studentName: val(cells, 'Student Name'),
      code: val(cells, 'Course Code'),
      section: val(cells, 'Section'),
      name: val(cells, 'Course Name'),
      day: val(cells, 'Day'),
      date: val(cells, 'Date'),
      time: val(cells, 'Time'),
      room: val(cells, 'Room'),
      seat: val(cells, 'Seat') || null,
      teacher: val(cells, 'Teacher'),
    };
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

const normKey = (course, section) => `${course.trim().toLowerCase()}|${section.trim().toUpperCase()}`;

/**
 * Matches the student's selected "Course - Section" strings (same format
 * used throughout this app — see the workspace CLAUDE.md's localStorage
 * hard constraint) against the parsed Sessional-1 rows, grouped by exact
 * (course, section) — the new source uses the identical fine-grained
 * section codes ("BCS-1A", not a broader "BCS-1") the weekly sheet already
 * does, so no prefix/broader-section matching is needed any more (that
 * logic existed for the OLD per-section-only datesheet, which grouped
 * several sub-sections under one umbrella code — this dataset doesn't).
 *
 * `knownRollNo`, when given (the viewer's own roll number — see
 * `getSessional1KnownRollNo` in App.jsx for where this comes from), makes
 * the returned `entry.room`/`entry.seat` that SPECIFIC student's own exact
 * values, since those genuinely vary within a class (confirmed above).
 * Without it, `entry.room`/`entry.seat` are both `null` — day/date/time are
 * still shown (uniform across the class), but showing a specific room/seat
 * without knowing which real seat is the viewer's own would just be
 * guessing, and a wrong seat on exam day is worse than an honest "unknown."
 *
 * Returns one result per selected class: `{ classKey, course, section,
 * entry }`, where `entry` is null if that class has no Sessional-1 exam on
 * record at all (a real, expected state — shown as "not scheduled" rather
 * than hidden, i.e. simply omitted by `getSessional1Schedule` below).
 */
export const matchSessional1 = (rows, selectedClasses, knownRollNo) => {
  const groups = new Map();
  for (const row of rows) {
    const key = normKey(row.name, row.section);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return selectedClasses.map((classKey) => {
    const lastSep = classKey.lastIndexOf(' - ');
    const course = lastSep === -1 ? classKey : classKey.slice(0, lastSep);
    const section = lastSep === -1 ? 'N/A' : classKey.slice(lastSep + 3);
    const group = groups.get(normKey(course, section));
    if (!group || group.length === 0) {
      return { classKey, course, section, entry: null };
    }
    const mine = knownRollNo ? group.find((r) => r.rollNo === knownRollNo) : null;
    const rep = group[0]; // day/date/time are uniform across the group — confirmed above
    const entry = {
      day: rep.day,
      date: rep.date,
      time: rep.time,
      room: mine ? mine.room : null,
      seat: mine ? mine.seat : null,
      teacher: mine ? mine.teacher : null,
    };
    return { classKey, course, section, entry };
  });
};

/**
 * The actual list the UI renders (2026-09-18, on request: "the courses
 * which data is not found should not show. make it so the exam is in
 * order not course name order, time order") — `matchSessional1`'s output
 * filtered down to only classes with a real Sessional-1 match, sorted
 * chronologically by exam date then time, not by course name or the order
 * classes happen to be selected in.
 */
export const getSessional1Schedule = (rows, selectedClasses, knownRollNo) => {
  return matchSessional1(rows, selectedClasses, knownRollNo)
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
