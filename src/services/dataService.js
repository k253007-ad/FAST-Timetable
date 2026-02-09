// This service is responsible for fetching and parsing data from the Google Sheets source.

const API_META_URL = '/api/data';

/**
 * Parses the multi-line string from a cell in the Google Sheet.
 * Expected format:
 * COURSE-CODE(Section)
 * Instructor Name
 * @param {string} cellValue The raw string value from the cell.
 * @returns {object} An object with course, section, and instructor properties.
 */
const parseCellValue = (cellValue) => {
  if (!cellValue) {
    return {};
  }
  const parts = cellValue.split('\n');
  const courseAndSection = parts[0] || '';
  const instructor = parts[1] || 'N/A';

  const sectionMatch = courseAndSection.match(/\(([^)]+)\)/);
  const section = sectionMatch ? sectionMatch[1] : 'N/A';

  const course = courseAndSection.replace(/\s*\([^)]+\)/, '').trim();

  return { course, section, instructor };
};


export const fetchData = async () => {
  try {
    // Step 1: Fetch metadata to get Google Sheet URL and gids
    const metaResponse = await fetch(API_META_URL, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      cache: 'no-cache'
    });

    if (!metaResponse.ok) {
      throw new Error(`Failed to fetch metadata: ${metaResponse.statusText}`);
    }
    const metaJson = await metaResponse.json();

    const sheetUrl = metaJson.karachi.url;
    const sheetGids = metaJson.karachi.codes;

    let allTimetableData = [];
    let allTimeSlots = new Set();
    let sheetsProcessed = 0;

    // Step 2: Fetch data from each sheet (gid) sequentially
    for (const sheetInfo of sheetGids) {
      try {
        const fetchUrl = `${sheetUrl}${sheetInfo.gid}`;

        const response = await fetch(fetchUrl);
        if (!response.ok) {
          console.error(`Failed to fetch sheet: ${sheetInfo.name}`, response.statusText);
          continue; // Skip to the next sheet
        }

        let text = await response.text();

        // Step 3: Parse the JSONP response to get clean JSON
        if (!text.includes('google.visualization.Query.setResponse')) {
          console.error(`Invalid response from sheet: ${sheetInfo.name}. Response did not contain expected JSONP wrapper.`);
          continue;
        }
        
        const jsonText = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
        if (!jsonText) {
          console.error(`Could not extract JSON from response for sheet: ${sheetInfo.name}`);
          continue;
        }

        const json = JSON.parse(jsonText);

        // Step 4: Transform the raw cell data into structured objects
        if (!json.table || !Array.isArray(json.table.rows) || json.table.rows.length === 0) {
          console.error(`Sheet '${sheetInfo.name}' is empty or has a malformed structure.`);
          continue; // Skip to next sheet
        }
        
        sheetsProcessed++;
        const rows = json.table.rows;
        const day = sheetInfo.name;

        const timeSlotHeaders = rows[1]?.c.map(cell => cell?.v).filter(v => v && v.includes('-')) || [];
        timeSlotHeaders.forEach(slot => allTimeSlots.add(slot));

        rows.forEach((row, rowIndex) => {
          if (rowIndex < 2) return;

          const room = row.c[0]?.v || 'N/A';

          row.c.forEach((cell, colIndex) => {
            if (colIndex < 1) return;

            if (cell?.v && timeSlotHeaders[colIndex - 1]) {
              const { course, section, instructor } = parseCellValue(cell.v);
              const time = timeSlotHeaders[colIndex - 1];

              if (course) {
                allTimetableData.push({
                  Course: course,
                  Section: section,
                  Instructor: instructor,
                  Room: room,
                  Day: day,
                  Time: time,
                });
              }
            }
          });
        });
      } catch (error) {
        console.error(`Error processing sheet: ${sheetInfo.name}`, error);
      }
    }

    // Filter out Saturday classes
    allTimetableData = allTimetableData.filter(item => item.Day !== 'Saturday');

    if (allTimetableData.length === 0) {
      if (sheetsProcessed === 0) {
        throw new Error("No timetable data could be loaded. All sheets failed to load or were empty. Please check the data source and your network connection.");
      } else {
        throw new Error("Timetable data was loaded, but no valid classes were found after filtering. Please check the data in the sheets.");
      }
    }

    return { 
      timetable: allTimetableData,
      allTimes: Array.from(allTimeSlots) 
    };

  } catch (error) {
    console.error("Failed to fetch or parse timetable data:", error);
    throw error;
  }
};
