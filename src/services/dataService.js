// Fetches and parses timetable data from the official Google Sheets source.
//
// Flow: a small metadata API tells us the sheet URL plus the name of each
// per-day tab; each tab is fetched by name (gviz `sheet=` param, no gid
// needed) as a JSONP payload, unwrapped, and flattened into
// { Course, Section, Instructor, Room, Day, Time } records. A second,
// optional roll-number sheet (added 2026-08-25) is fetched the same way and
// merged in — see fetchRollNumbers below and the merge step in fetchData.

const API_META_URL = '/api/data';

/**
 * Parses the multi-line string from a cell in the Google Sheet.
 * Expected format:
 *   COURSE-CODE(Section)
 *   Instructor Name
 */
const parseCellValue = (cellValue) => {
  if (!cellValue) {
    return {};
  }
  const parts = cellValue.split('\n');
  const courseAndSection = parts[0] || '';
  const instructor = (parts[1] || 'N/A').trim();

  const sectionMatch = courseAndSection.match(/\(([^)]+)\)/);
  const section = sectionMatch ? sectionMatch[1].trim() : 'N/A';

  const course = courseAndSection.replace(/\s*\([^)]+\)/, '').trim();

  return { course, section, instructor };
};

/** Fetches one day tab and returns its flattened rows, or null on failure. */
const fetchSheet = async (sheetUrl, sheetInfo) => {
  try {
    const response = await fetch(`${sheetUrl}${encodeURIComponent(sheetInfo.name)}`);
    if (!response.ok) {
      console.error(`Failed to fetch sheet: ${sheetInfo.name}`, response.statusText);
      return null;
    }

    const text = await response.text();

    // The gviz endpoint returns JSONP; unwrap it to plain JSON.
    if (!text.includes('google.visualization.Query.setResponse')) {
      console.error(`Invalid response from sheet: ${sheetInfo.name} (no JSONP wrapper).`);
      return null;
    }
    const jsonText = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    if (!jsonText) {
      console.error(`Could not extract JSON from response for sheet: ${sheetInfo.name}`);
      return null;
    }

    const json = JSON.parse(jsonText);
    if (!json.table || !Array.isArray(json.table.rows) || json.table.rows.length === 0) {
      console.error(`Sheet '${sheetInfo.name}' is empty or has a malformed structure.`);
      return null;
    }

    const rows = json.table.rows;
    const day = sheetInfo.name;
    const entries = [];

    // Row 0: slot numbers · Row 1: "Venues/time" + slot headers · Row 2+: rooms.
    const timeSlotHeaders =
      rows[1]?.c.map((cell) => cell?.v).filter((v) => v && v.includes('-')) || [];

    rows.forEach((row, rowIndex) => {
      if (rowIndex < 2) return;

      const room = row.c[0]?.v || 'N/A';

      row.c.forEach((cell, colIndex) => {
        if (colIndex < 1) return;

        if (cell?.v && timeSlotHeaders[colIndex - 1]) {
          const { course, section, instructor } = parseCellValue(cell.v);
          if (course) {
            entries.push({
              Course: course,
              Section: section,
              Instructor: instructor,
              Room: room,
              Day: day,
              Time: timeSlotHeaders[colIndex - 1],
            });
          }
        }
      });
    });

    return { entries, timeSlots: timeSlotHeaders };
  } catch (error) {
    console.error(`Error processing sheet: ${sheetInfo.name}`, error);
    return null;
  }
};

/**
 * Fetches the flat roll-number sheet: one row per class a specific student
 * takes, columns RollNo | Day | Time | Course | Section | Instructor | Room
 * (built offline from the university's per-student PDF — see workspace root
 * TASK_roll_number_mode.md). Unlike the day tabs this isn't a Room×Time
 * grid, so it's parsed by header name instead of fixed row/column offsets.
 */
const fetchRollNumbers = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch roll-number sheet', response.statusText);
      return [];
    }
    const text = await response.text();
    if (!text.includes('google.visualization.Query.setResponse')) {
      console.error('Invalid response from roll-number sheet (no JSONP wrapper).');
      return [];
    }
    const jsonText = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const json = JSON.parse(jsonText);
    const rows = json?.table?.rows;
    if (!Array.isArray(rows) || rows.length < 2) return [];

    const headers = rows[0].c.map((cell) => (cell?.v || '').toString().trim());
    const idx = {
      RollNo: headers.indexOf('RollNo'),
      Day: headers.indexOf('Day'),
      Time: headers.indexOf('Time'),
      Course: headers.indexOf('Course'),
      Section: headers.indexOf('Section'),
      Instructor: headers.indexOf('Instructor'),
      Room: headers.indexOf('Room'),
    };
    if (Object.values(idx).some((i) => i === -1)) {
      console.error('Roll-number sheet is missing an expected column.', headers);
      return [];
    }

    const entries = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].c;
      const get = (colIdx) => (cells[colIdx]?.v ?? '').toString().trim();
      const rollNo = get(idx.RollNo);
      if (!rollNo) continue;
      entries.push({
        RollNo: rollNo,
        Day: get(idx.Day),
        Time: get(idx.Time),
        Course: get(idx.Course),
        Section: get(idx.Section),
        Instructor: get(idx.Instructor) || 'N/A',
        Room: get(idx.Room) || 'N/A',
      });
    }
    return entries;
  } catch (error) {
    console.error('Error processing roll-number sheet', error);
    return [];
  }
};

export const fetchData = async () => {
  // Step 1: metadata — sheet URL and the name of each day tab.
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

  const sheetUrl = metaJson.karachi.url;
  const sheetGids = metaJson.karachi.codes;

  // Step 2: fetch all day tabs in parallel; each failure is isolated.
  const results = await Promise.all(sheetGids.map((info) => fetchSheet(sheetUrl, info)));

  const allTimeSlots = new Set();
  let allTimetableData = [];
  let sheetsProcessed = 0;

  results.forEach((result) => {
    if (!result) return;
    sheetsProcessed++;
    result.timeSlots.forEach((slot) => allTimeSlots.add(slot));
    allTimetableData.push(...result.entries);
  });

  // Saturday tabs exist in the sheet but aren't part of the regular week.
  allTimetableData = allTimetableData.filter((item) => item.Day !== 'Saturday');

  if (allTimetableData.length === 0) {
    if (sheetsProcessed === 0) {
      throw new Error(
        'No timetable data could be loaded. All sheets failed to load or were empty. ' +
          'Please check the data source and your network connection.'
      );
    }
    throw new Error(
      'Timetable data was loaded, but no valid classes were found after filtering. ' +
        'Please check the data in the sheets.'
    );
  }

  // Step 3: roll-number sheet (optional — `rollNumbers` is null until the user uploads it,
  // see api/sheetConfig.js). Entries that describe a class the master sheet already has
  // aren't duplicated into `timetable` — selecting that course/section just reuses the
  // existing entry. Only entries the master sheet is missing (its own data-quality gaps, or
  // timing drift between the two sources) get added, so every roll number's classes always
  // resolve to something renderable, and a duplicate never gets double-counted as a false
  // clash by buildSchedule.
  //
  // A "session" is identified by (Section, Day, Time) only — deliberately NOT
  // Course/Room/Instructor text. The roll-number sheet was built offline, once, by
  // snapshotting the master sheet's text; the live master sheet is a moving target (it's
  // already been reverted once mid-project), so Room/Instructor formatting can drift between
  // extraction time and whenever a user's browser actually fetches both sheets. Comparing
  // that text directly caused real false negatives (e.g. a Room string differing only in
  // spacing) — the row would slip past this check, get appended as a "new" entry, and
  // buildSchedule (schedule.js) flags any cell with more than one entry as a clash
  // unconditionally, so the student's own class showed up flagged as clashing with itself.
  // Section+Day+Time is far more stable than the display text, and a section can't
  // legitimately meet twice at once, so it's a safe identity key.
  const rollNumberEntries = metaJson.karachi.rollNumbers
    ? await fetchRollNumbers(metaJson.karachi.rollNumbers.url)
    : [];

  const sessionKey = (item) => `${item.Section}|${item.Day}|${item.Time}`;
  const masterKeys = new Set(allTimetableData.map(sessionKey));

  rollNumberEntries.forEach((item) => {
    if (item.Day === 'Saturday') return;
    const key = sessionKey(item);
    if (masterKeys.has(key)) return;
    masterKeys.add(key);
    allTimeSlots.add(item.Time);
    allTimetableData.push({
      Course: item.Course,
      Section: item.Section,
      Instructor: item.Instructor,
      Room: item.Room,
      Day: item.Day,
      Time: item.Time,
    });
  });

  return {
    timetable: allTimetableData,
    allTimes: Array.from(allTimeSlots),
    rollNumbers: rollNumberEntries,
  };
};
