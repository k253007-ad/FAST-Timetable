// Fetches and parses timetable data from the official Google Sheets source.
//
// Flow: a small metadata API tells us the sheet URL plus the name of each
// per-day tab; each tab is fetched by name (gviz `sheet=` param, no gid
// needed) as a JSONP payload, unwrapped, and flattened into
// { Course, Section, Instructor, Room, Day, Time } records. A second,
// optional roll-number sheet (added 2026-08-25, reworked 2026-08-27) is
// fetched the same way — see fetchRollNumbers below — but only ever carries
// each student's Course-short-code + Section list, never Day/Time/Room of
// its own; those get looked up live against the master timetable above by
// Course+Section, same as every other selection mode.

import { buildCourseCodeMap } from '../utils/schedule.js';

const API_META_URL = '/api/data';

/**
 * Parses the multi-line string from a cell in the Google Sheet.
 * Expected format:
 *   COURSE-CODE(Section)
 *   Instructor Name
 *
 * A course name can itself contain parentheses (e.g. "Understanding
 * Sirat-Un-Nabi (PBUH)(BCS-1K)") — the Section is always the LAST
 * parenthesized group, not the first, so only that one gets stripped from
 * the course text. Taking the first group here used to misread "(PBUH)" as
 * the section and leave the real section baked into the course name.
 */
const parseCellValue = (cellValue) => {
  if (!cellValue) {
    return {};
  }
  const parts = cellValue.split('\n');
  const courseAndSection = parts[0] || '';
  const instructor = (parts[1] || 'N/A').trim();

  const parenGroups = [...courseAndSection.matchAll(/\(([^)]+)\)/g)];
  const sectionMatch = parenGroups[parenGroups.length - 1];
  const section = sectionMatch ? sectionMatch[1].trim() : 'N/A';

  const course = sectionMatch
    ? (
        courseAndSection.slice(0, sectionMatch.index) +
        courseAndSection.slice(sectionMatch.index + sectionMatch[0].length)
      ).trim()
    : courseAndSection.trim();

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
  // see api/sheetConfig.js). Compact format: RollNo + a list of "SHORTCODE (Section)" cells,
  // no Day/Time/Room/Instructor of its own — codes are resolved against the master sheet's
  // own course names (buildCourseCodeMap) and every session detail comes live from
  // `allTimetableData` by Course+Section, exactly like Teacher/Section mode already do.
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
