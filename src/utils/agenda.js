import { DAY_ORDER } from './schedule.js';
export const DAY_LABELS = { Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'Th', Friday: 'F' };

// Work from merged cells so labs, overrides, and clashes match the grid.
export const getWeekInsights = (schedule) => {
  let minutes = 0;
  let sessions = 0;
  let activeDays = 0;
  const days = DAY_ORDER.map((day) => {
    const cells = (schedule.processedSchedule[day] || []).filter((cell) => !cell.isEmpty);
    const duration = cells.reduce((sum, cell) => sum + Math.max(0, cell.endMin - cell.startMin), 0);
    minutes += duration;
    sessions += cells.length;
    if (cells.length) activeDays++;
    const breaks = cells.slice(1).map((cell, index) => Math.max(0, cell.startMin - cells[index].endMin));
    return { day, cells, minutes: duration, breakMinutes: breaks.reduce((sum, gap) => sum + gap, 0), longestBreak: Math.max(0, ...breaks) };
  });
  return { days, minutes, sessions, activeDays,
    averageMinutes: activeDays ? Math.round(minutes / activeDays) : 0,
    breakMinutes: days.reduce((sum, day) => sum + day.breakMinutes, 0),
    busiestDay: days.filter((day) => day.minutes > 0).sort((a, b) => b.minutes - a.minutes)[0] || null,
    freeDays: days.filter((day) => !day.cells.length).map((day) => day.day),
  };
};

export const matchesAgendaQuery = (cell, query) => {
  const text = cell.classes.map((item) =>
    [item.Course, item.Section, item.Room, item.Instructor].filter(Boolean).join(' ')
  ).join(' ').toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every((token) => text.includes(token));
};

export const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ') || '0m';
};
