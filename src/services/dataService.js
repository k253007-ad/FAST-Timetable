// Fetches and parses timetable data from the official Google Sheets source.
//
// Flow: a small metadata API tells us the sheet URL plus the gid of each
// per-day tab; each tab is fetched as a gviz JSONP payload, unwrapped, and
// flattened into { Course, Section, Instructor, Room, Day, Time } records.

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
    const response = await fetch(`${sheetUrl}${sheetInfo.gid}`);
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

export const fetchData = async () => {
  // Step 1: metadata — sheet URL and the gid for each day tab.
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

  return {
    timetable: allTimetableData,
    allTimes: Array.from(allTimeSlots),
  };
};
