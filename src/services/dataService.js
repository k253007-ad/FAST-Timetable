// This service is responsible for fetching and parsing data from the Google Sheets source.

const API_META_URL = 'https://server-timetable2.vercel.app/data';

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
    const metaResponse = await fetch(API_META_URL);
    const metaText = await metaResponse.text();
    const metaJson = JSON.parse(metaText);

    const sheetUrl = metaJson.karachi.url;
    const sheetGids = metaJson.karachi.codes;

    let allTimetableData = [];
    let allTimeSlots = new Set();

    // Step 2: Fetch data from each sheet (gid)
    const sheetPromises = sheetGids.map(async (sheetInfo) => {
      const response = await fetch(`${sheetUrl}${sheetInfo.gid}`);
      let text = await response.text();

      // Step 3: Parse the JSONP response to get clean JSON
      if (!text.includes('google.visualization.Query.setResponse')) {
        throw new Error(`Invalid response from sheet: ${sheetInfo.name}`);
      }
      text = text.substr(text.indexOf('(') + 1).slice(0, -2);
      const json = JSON.parse(text);
      
      // Step 4: Transform the raw cell data into structured objects
      const rows = json.table.rows;
      const day = sheetInfo.name; // The sheet name is the day

      // Determine time slots from the second row (index 1) of the sheet and filter them
      const timeSlotHeaders = rows[1]?.c.map(cell => cell?.v)
                                      .filter(v => v && v.includes('-')) || [];
      
      timeSlotHeaders.forEach(slot => allTimeSlots.add(slot));

      rows.forEach((row, rowIndex) => {
        // Data rows start from index 2 (after headers)
        if (rowIndex < 2) return; 

        // The first cell of each data row is the Room
        const roomCell = row.c[0];
        const room = roomCell ? roomCell.v : 'N/A';

        // Iterate through columns to find class details
        row.c.forEach((cell, colIndex) => {
          // Class data columns start from index 1 (after the Room column)
          if (colIndex < 1) return; 

          if (cell && cell.v && timeSlotHeaders[colIndex - 1]) {
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
    });

    await Promise.all(sheetPromises);
    
    // Add the missing time slot as requested by the user
    allTimeSlots.add("03:00 - 03:45");

    // The final data structure to be returned
    // Also including all discovered time slots to ensure consistency
    return { 
      timetable: allTimetableData,
      allTimes: Array.from(allTimeSlots) 
    };

  } catch (error) {
    console.error("Failed to fetch or parse timetable data:", error);
    throw error;
  }
};
