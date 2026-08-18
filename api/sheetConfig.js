// Single source of truth for the timetable's Google Sheet, shared by the
// production serverless function (api/data.js) and the Vite dev-server
// middleware (vite.config.js) so `npm run dev` and the deployed site agree.
//
// To point at a different sheet: replace SHEET_ID and each day's gid below
// (Sheet → open the tab → copy the number after "gid=" in the URL).

const SHEET_ID = '1rRo5Gqu2nqj1K1xzxO-4n8KQmnXq7fx65P4Yz9CkxN0';

export const sheetData = {
  karachi: {
    url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=`,
    codes: [
      { name: 'Monday', gid: '1134238629' },
      { name: 'Tuesday', gid: '691038107' },
      { name: 'Wednesday', gid: '1806922756' },
      { name: 'Thursday', gid: '1156209512' },
      { name: 'Friday', gid: '1228197298' },
    ],
  },
};
