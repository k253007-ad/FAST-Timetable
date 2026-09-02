// Environment-agnostic core of dataService.js's fetching/parsing — pulled
// out (2026-09-02, alongside server-side push notifications) so the same
// logic can run in the browser (dataService.js, via a relative `/api/data`
// fetch) *and* in a Node serverless function (api/notify-tick.js, which
// calls getSheetData() directly instead of fetching a relative URL — a bare
// `fetch('/api/data')` has no implicit origin outside a browser tab). Only
// depends on global `fetch` (available in both environments) and
// buildCourseCodeMap (plain JS, no DOM).

import { buildCourseCodeMap } from '../utils/schedule.js';

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
const parseCellValue = (cellValue) => {
  if (!cellValue) {
    return {};
  }
  const parts = cellValue.split('\n');
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

// Matches "SHORTCODE (Section)", e.g. "COAL-Lab (BSE-3B)" -> code
// "COAL-Lab", section "BSE-3B".
const ROLL_ENTRY_PATTERN = /^(.+?)\s*\(([^)]+)\)$/;

/**
 * Fetches the compact roll-number sheet: one row per student — column A the
 * roll number, every other column in that row one "SHORTCODE (Section)"
 * cell for a course they take (row 0 is a header, skipped; trailing blank
 * cells are fine since students take different numbers of courses). Codes
 * are resolved against `codeMap` (buildCourseCodeMap, derived from the
 * master sheet's own course names) back to the exact course string
 * buildSchedule matches on. A code the map doesn't recognize is dropped
 * with a console warning rather than injected as a broken entry — most
 * likely a typo in the sheet or the master sheet's course list changed
 * since the code was written down.
 */
const fetchRollNumbers = async (url, codeMap) => {
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

  const courseCodeMap = buildCourseCodeMap(allTimetableData);
  const rollNumberEntries = metaJson.karachi.rollNumbers
    ? await fetchRollNumbers(metaJson.karachi.rollNumbers.url, courseCodeMap)
    : [];

  return {
    timetable: allTimetableData,
    allTimes: Array.from(allTimeSlots),
    rollNumbers: rollNumberEntries,
  };
};
