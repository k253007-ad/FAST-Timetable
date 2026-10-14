// Environment-agnostic core of dataService.js's fetching/parsing — pulled
// out (2026-09-02, alongside server-side push notifications) so the same
// logic can run in the browser (dataService.js, via a relative `/api/data`
// fetch) *and* in a Node serverless function (api/notify-tick.js, which
// calls getSheetData() directly instead of fetching a relative URL — a bare
// `fetch('/api/data')` has no implicit origin outside a browser tab). Only
// depends on global `fetch` (available in both environments) and
// buildCourseCodeMap (plain JS, no DOM).

import { buildCourseCodeMap } from '../utils/schedule.js';

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const BOOKING_DATES = new RegExp(`\\b(?:${MONTH}\\s+\\d{1,2}|\\d{1,2}\\s+${MONTH})(?:\\s*[,/+&]\\s*\\d{1,2}(?!\\d)(?:\\s+${MONTH})?)*(?:\\s*,?\\s+20\\d{2})?\\b`, 'gi');
const BOOKING_SECTIONS = /\b(B[A-Z]{2,3})\s*-?\s*(\d{1,2}[A-Z]\d?)\b((?:\s*\/\s*\d{1,2}[A-Z]\d?\b)*)/gi;

const parseReservation = (raw) => {
  const booking = raw.replace(/^reserved(?:\s+for)?\s*/i, '').trim();
  const dates = [...booking.matchAll(BOOKING_DATES)];
  const sections = [...booking.matchAll(BOOKING_SECTIONS)];
  const boundary = Math.min(dates[0]?.index ?? booking.length, sections[0]?.index ?? booking.length);
  let instructor = booking.slice(0, boundary).replace(/\s+Sec\s*$/i, '').trim();
  const shorthand = instructor.match(/\s+([A-Z]{2,8}(?:\s*-?\s*Lab)?)$/);
  if (shorthand) instructor = instructor.slice(0, shorthand.index).trim();
  instructor = instructor.replace(new RegExp(`\\s+${MONTH}\\s*$`, 'i'), '').trim();
  let course = booking.slice(boundary)
    .replace(BOOKING_DATES, ' ').replace(BOOKING_SECTIONS, ' ')
    .replace(/\b\d{2}K\s*-\s*\d{4}\b/gi, ' ')
    .replace(/\bLab\s+(?:Mid\s+)?Exam\b/gi, ' ')
    .replace(/\s+of\s*$/i, '').replace(/^[\s.,;:/+&-]+|[\s.,;:/+&-]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]/.test(course)) course = '';
  course ||= shorthand?.[1] || '';
  const sectionNames = sections.flatMap((match) =>
    [match[2], ...match[3].split('/').map((section) => section.trim()).filter(Boolean)]
      .map((section) => `${match[1]}-${section}`.toUpperCase()));
  return (sectionNames.length ? [...new Set(sectionNames)] : ['N/A']).map((section) => ({
    course, section, instructor: instructor || 'N/A', isExtra: true, isReserved: true,
    bookingText: booking || 'Reserved',
  }));
};

const courseReferenceKey = (value) => String(value || '').toLowerCase()
  .replace(/\([A-Z]{2,8}\)/gi, '').replace(/\bclass\b/g, '')
  .replace(/[^a-z0-9]/g, '');

/**
 * Parses the multi-line string from a cell in the Google Sheet.
 * Expected format (changed 2026-08-30 — the sheet itself was reformatted for
 * human readability, one field per line):
 *   Course Name
 *   Room
 *   Section
 *   Instructor Name
 *
 * The Room line is intentionally ignored here — it's already known from the
 * row's own first column (see `room` in fetchSheet below) and is only
 * repeated inside the cell so the sheet is readable without cross-referencing
 * the row header. Section now being its own line (rather than parsed out of
 * the course text via a trailing "(Section)") retires the old
 * last-parenthesized-group logic entirely — a course name containing its own
 * parentheses (e.g. "Understanding Sirat-Un-Nabi (PBUH)") is no longer
 * ambiguous with the section marker.
 */
export const parseCellValues = (cellValue) => {
  if (!cellValue) return [];
  const compact = String(cellValue).replace(/\s+/g, ' ').trim();
  if (/^reserved\b/i.test(compact)) {
    return compact.split(/\s*(?:&\s*)?(?=reserved\s+for\b)/i).filter(Boolean).flatMap(parseReservation);
  }
  if (/^maintenance\b/i.test(compact)) {
    return [{ course: '', section: 'N/A', instructor: 'N/A', isReserved: true, bookingText: compact }];
  }
  if (!/[A-Za-z]/.test(compact)) return [];
  // A venue can contain multiple course/section bookings. Match headers,
  // rather than newlines: course names also wrap across lines in this sheet.
  const headers = [...compact.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z]?)\s*,?\s*(B[A-Z]{2,3}-\d{1,2}[A-Z]\d?)\s*,\s*/gi)];
  if (!headers.length || headers[0].index !== 0) return [parseLegacyCellValue(cellValue)];
  return headers.map((header, index) => {
    const body = compact.slice(header.index + header[0].length, headers[index + 1]?.index)
      .replace(/[\s,"']+$/, '')
      .replace(/,\s*\d+\s*,?\s*(?:st(?:udents?)?)?\s*$/i, '')
      .trim();
    const [course, ...teacher] = body.split(',').map((part) => part.trim());
    return {
      course,
      courseCode: header[1],
      section: header[2],
      instructor: teacher.filter(Boolean).join(' ') || 'N/A',
    };
  });
};

export const parseCellValue = (cellValue) => parseCellValues(cellValue)[0] || {};

const parseLegacyCellValue = (cellValue) => {
  if (!cellValue) {
    return {};
  }
  const parts = cellValue.split('\n');
  if (parts.length < 4) return {};
  const course = (parts[0] || '').trim();
  const section = (parts[2] || 'N/A').trim();
  const instructor = (parts[3] || 'N/A').trim();

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
    const day = sheetInfo.name.charAt(0).toUpperCase() + sheetInfo.name.slice(1).toLowerCase();
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
          for (const { course, courseCode, section, instructor, isExtra, isReserved, bookingText } of parseCellValues(cell.v)) {
            if (course || isReserved) {
              entries.push({
                Course: course,
                ...(courseCode ? { CourseCode: courseCode } : {}),
                Section: section,
                Instructor: instructor,
                Room: room,
                Day: day,
                Time: timeSlotHeaders[colIndex - 1],
                ...(isReserved ? { isExtra, isReserved, Booking: bookingText } : {}),
              });
            }
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

// Matches "SHORTCODE (Section)", e.g. "COAL-Lab (BSE-3B)" -> code
// "COAL-Lab", section "BSE-3B".
const ROLL_ENTRY_PATTERN = /^(.+?)\s*\(([^)]+)\)$/;

/**
 * Parses the compact roll-number sheet's response: one row per student —
 * column A the roll number, every other column in that row one "SHORTCODE
 * (Section)" cell for a course they take (row 0 is a header, skipped;
 * trailing blank cells are fine since students take different numbers of
 * courses). Codes are resolved against `codeMap` (buildCourseCodeMap,
 * derived from the master sheet's own course names) back to the exact
 * course string buildSchedule matches on. A code the map doesn't recognize
 * is dropped with a console warning rather than injected as a broken
 * entry — most likely a typo in the sheet or the master sheet's course
 * list changed since the code was written down.
 *
 * Takes an already-in-flight `fetch()` Promise, not a URL — the caller
 * kicks the request off as early as possible (alongside the day-tab
 * fetches, which this doesn't depend on) and only awaits it once it
 * actually needs the parsed result, so the network round trip isn't
 * serialized onto the critical path behind unrelated work.
 */
const parseRollNumbers = async (responsePromise, codeMap) => {
  try {
    const response = await responsePromise;
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

    const entries = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].c || [];
      const rollNo = (cells[0]?.v ?? '').toString().trim();
      if (!rollNo) continue;

      for (let col = 1; col < cells.length; col++) {
        const raw = (cells[col]?.v ?? '').toString().trim();
        if (!raw) continue;

        const match = raw.match(ROLL_ENTRY_PATTERN);
        if (!match) {
          console.warn(`Roll-number sheet: couldn't parse "${raw}" for ${rollNo}`);
          continue;
        }
        const [, code, section] = match;
        const course = codeMap.get(code.trim());
        if (!course) {
          console.warn(`Roll-number sheet: unknown course code "${code}" for ${rollNo}`);
          continue;
        }
        entries.push({ RollNo: rollNo, Course: course, Section: section.trim() });
      }
    }
    return entries;
  } catch (error) {
    console.error('Error processing roll-number sheet', error);
    return [];
  }
};

/**
 * Turns the `/api/data`-shaped metadata (`{ karachi: { url, codes,
 * rollNumbers } }`, see api/sheetConfig.js) into the same
 * `{ timetable, allTimes, rollNumbers }` shape buildSchedule expects.
 * Shared by dataService.js's fetchData() (browser, metaJson comes from an
 * actual HTTP fetch of `/api/data`) and api/notify-tick.js (server, metaJson
 * comes straight from calling getSheetData() in-process — no HTTP round
 * trip, since a relative URL fetch has nothing to resolve against outside a
 * browser tab).
 */
export const buildTimetableFromMeta = async (metaJson) => {
  const sheetUrl = metaJson.karachi.url;
  const sheetGids = metaJson.karachi.codes;

  // The roll-number sheet fetch used to be `await`ed AFTER this Promise.all
  // resolved — a fully needless extra network round trip serialized onto
  // the critical path, since it doesn't depend on the day-tab results at
  // all (buildCourseCodeMap needs the day-tab COURSE NAMES, which arrive
  // fully formed with each fetchSheet result — the roll-number fetch itself
  // is independent, only the *parsing* of its response needs the code map,
  // which is built after Promise.all as before). Kicking it off alongside
  // the 5 day-tab fetches (2026-09-14, part of a PWA-open-speed
  // investigation) means it happens for free within the same round trip
  // instead of adding one after.
  const rollNumbersUrl = metaJson.karachi.rollNumbers?.url;
  const rollNumbersPromise = rollNumbersUrl ? fetch(rollNumbersUrl) : null;
  // A no-op handler attached immediately, purely so a fetch failure landing
  // before this promise is actually awaited below doesn't get reported as
  // an unhandled promise rejection in the console — parseRollNumbers still
  // receives (and really handles, via its own try/catch) this exact same
  // promise separately; attaching more than one handler to one promise is
  // fine, both fire independently.
  rollNumbersPromise?.catch(() => {});

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

  // Resolve reservation shorthand against regular courses, never against
  // other reservations (which can themselves contain unresolved shorthand).
  const regularCourses = allTimetableData.filter((item) => !item.isReserved);
  const namesByCode = buildCourseCodeMap(regularCourses);
  regularCourses.forEach((item) => {
    if (item.CourseCode) namesByCode.set(item.CourseCode, item.Course);
  });
  const officialCodes = new Map(regularCourses
    .filter((item) => item.CourseCode)
    .map((item) => [item.Course, item.CourseCode]));
  const courseReferences = new Map();
  const addReference = (reference, course) => {
    const key = courseReferenceKey(reference);
    if (!key) return;
    if (!courseReferences.has(key)) courseReferences.set(key, new Set());
    courseReferences.get(key).add(course);
  };
  regularCourses.forEach((item) => addReference(item.Course, item.Course));
  namesByCode.forEach((course, code) => addReference(code, course));
  const roomBookings = [];
  const knownClasses = new Set(regularCourses.map((item) => `${item.Course}|${item.Section}`));
  allTimetableData = allTimetableData.flatMap((item) => {
    if (!item.isReserved) return [item];
    const candidates = courseReferences.get(courseReferenceKey(item.Course));
    if (candidates?.size !== 1) {
      roomBookings.push(item);
      return [];
    }
    const [course] = candidates;
    if (!knownClasses.has(`${course}|${item.Section}`)) {
      roomBookings.push(item);
      return [];
    }
    return [{ ...item, Course: course,
      ...(officialCodes.has(course) ? { CourseCode: officialCodes.get(course) } : {}) }];
  });

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

  const courseCodeMap = buildCourseCodeMap(allTimetableData);
  const rollNumberEntries = rollNumbersPromise
    ? await parseRollNumbers(rollNumbersPromise, courseCodeMap)
    : [];

  return {
    timetable: allTimetableData,
    roomBookings,
    allTimes: Array.from(allTimeSlots),
    rollNumbers: rollNumberEntries,
  };
};
