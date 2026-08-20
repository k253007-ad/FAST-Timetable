// Shared weekly-schedule builder: turns raw timetable rows + the current
// selection into a per-day grid of merged sessions (labs span 3 slots,
// identical consecutive sessions merge, overlapping different classes fold
// into one cell as a clash). Used by both the grid and the now/next summary
// so they never disagree about what a "session" is.

export const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Sheet times have no AM/PM marker; anything before 7 is an afternoon class.
export const toMinutes = (timeStr) => {
  if (!timeStr || !timeStr.includes(':')) return 0;
  let [hours, minutes] = timeStr.split(':').map(Number);
  if (hours < 7) hours += 12;
  return hours * 60 + (minutes || 0);
};

// Slot strings in the sheet are inconsistent ("09:50:-10:40", "1:30-2:20");
// extract the two clock times for tidy display while keeping the raw string as key.
export const formatSlot = (slot) => {
  const times = slot.match(/\d{1,2}:\d{2}/g) || [];
  return { start: times[0] || slot, end: times[1] || '' };
};

/** Start/end minutes for a raw slot string. */
export const slotMinuteRange = (slot) => {
  const { start, end } = formatSlot(slot);
  return { startMin: toMinutes(start), endMin: toMinutes(end) };
};

export const cleanRoom = (room) =>
  (room || 'N/A')
    .replace(/Academic Block/gi, 'AB')
    .replace(/\s*\(\d+\)\s*$/, '') // strip trailing seating capacity, e.g. "(50)"
    .trim();

const sameClass = (a, b) =>
  a.Course === b.Course && a.Section === b.Section && a.Instructor === b.Instructor;

/**
 * Builds { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount }
 * for the given timetable data and selection. `processedSchedule[day]` is an
 * ordered array of cells: `{ slot, colSpan, classes, isEmpty }`.
 */
export const buildSchedule = (data, selectedClasses) => {
  if (!data?.timetable) {
    return {
      days: [],
      timeSlots: [],
      processedSchedule: {},
      sessionCount: 0,
      courseCount: 0,
      clashCount: 0,
    };
  }

  const days = [...new Set(data.timetable.map((item) => item.Day))].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
  );

  const timeSlots = [...new Set(data.timetable.map((item) => item.Time))].sort(
    (a, b) => toMinutes(a.split('-')[0]) - toMinutes(b.split('-')[0])
  );

  const filteredData = data.timetable.filter((item) =>
    selectedClasses.includes(`${item.Course} - ${item.Section}`)
  );

  const schedule = {};
  days.forEach((day) => {
    schedule[day] = {};
    timeSlots.forEach((slot) => {
      schedule[day][slot] = [];
    });
  });
  filteredData.forEach((item) => {
    if (schedule[item.Day]?.[item.Time]) {
      schedule[item.Day][item.Time].push(item);
    }
  });

  // Merge consecutive identical sessions into one wider cell.
  // Labs always occupy three slots; any different class sitting inside a
  // lab's window is folded into the same cell so it stays visible (clash).
  const processedSchedule = {};
  let clashCount = 0;

  days.forEach((day) => {
    processedSchedule[day] = [];
    let i = 0;
    while (i < timeSlots.length) {
      const slot = timeSlots[i];
      const classesInSlot = schedule[day][slot];

      if (classesInSlot.length > 0) {
        const classItem = classesInSlot[0];
        let colSpan = 1;
        let cellClasses = classesInSlot;

        if (classItem.Course.toLowerCase().includes('lab')) {
          colSpan = Math.min(3, timeSlots.length - i);
          const merged = [...classesInSlot];
          for (let k = i + 1; k < i + colSpan; k++) {
            schedule[day][timeSlots[k]].forEach((c) => {
              if (!merged.some((m) => sameClass(m, c))) merged.push(c);
            });
          }
          cellClasses = merged;
        } else {
          for (let j = i + 1; j < timeSlots.length; j++) {
            const nextClasses = schedule[day][timeSlots[j]];
            if (nextClasses.length > 0 && sameClass(nextClasses[0], classItem)) {
              colSpan++;
            } else {
              break;
            }
          }
          if (i + colSpan > timeSlots.length) colSpan = timeSlots.length - i;
        }

        if (cellClasses.length > 1) clashCount++;
        const startLabel = formatSlot(slot).start;
        const endLabel = formatSlot(timeSlots[i + colSpan - 1]).end;
        const startMin = toMinutes(startLabel);
        const endMin = toMinutes(endLabel);
        processedSchedule[day].push({
          slot,
          colSpan,
          classes: cellClasses,
          isEmpty: false,
          startMin,
          endMin,
          startLabel,
          endLabel,
        });
        i += colSpan;
      } else {
        processedSchedule[day].push({ slot, colSpan: 1, classes: [], isEmpty: true });
        i++;
      }
    }
  });

  return {
    days,
    timeSlots,
    processedSchedule,
    sessionCount: filteredData.length,
    courseCount: new Set(filteredData.map((item) => item.Course)).size,
    clashCount,
  };
};
