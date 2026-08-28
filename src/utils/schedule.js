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
    .replace(/\bRoom\s*/gi, '') // drop the word "Room" — redundant, and eats space on mobile
    .replace(/\s*\(\d+\)\s*$/, '') // strip trailing seating capacity, e.g. "(50)"
    .trim();

const ABBR_STOPWORDS = new Set([
  'of', 'and', 'the', 'in', 'for', 'to', 'on', 'with', 'a', 'an', 'i', 'ii', 'iii',
]);

// "Applied Physics" -> "AP", "Object Oriented Programming" -> "OOP" — used by
// notifications, which need a course label short enough to fit a native
// notification's title bar. Strips a trailing "- Lab" first.
export const abbreviateCourse = (name) => {
  if (!name) return '';
  const base = name.replace(/\s*-\s*Lab\s*$/i, '').trim();
  const words = base.split(/\s+/).filter((w) => w && !ABBR_STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return base.slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
};

/**
 * Deterministic SHORTCODE -> full course name map, derived from the master
 * timetable's own course names (e.g. "Data Structures" -> "DS",
 * "Computer Organization and Assembly Language" -> "COAL"). Unlike
 * abbreviateCourse above, a lab keeps its lecture's code plus a "-Lab"
 * suffix instead of collapsing to the same code (matches the sheet's own
 * "- Lab" naming), and two different courses that happen to abbreviate to
 * the same code get disambiguated by appending 2, 3, ... to every course
 * after the first — this has to be a stable 1:1 map, not just a display
 * label. Ranked by session count (how many timetable rows that course name
 * appears in) so the plain, unsuffixed code goes to whichever course is
 * actually more common — e.g. "DS" resolves to "Data Structures" (a
 * mandatory course meeting dozens of times a week) rather than "Data
 * Science" (an elective meeting a handful of times), which is what anyone
 * writing "DS" in the compact roll-number sheet almost certainly means.
 * Ties fall back to alphabetical for determinism. Used to resolve the
 * compact roll-number sheet's short codes back to the exact course string
 * buildSchedule matches on.
 */
export const buildCourseCodeMap = (timetable) => {
  const isLab = (name) => /\s*-\s*lab\s*$/i.test(name);
  const baseCode = (name) => {
    const base = name.replace(/\s*-\s*lab\s*$/i, '').trim();
    // Strip punctuation from each word first — a word like "(PBUH)" would
    // otherwise contribute its literal "(" as an "initial".
    const words = base
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
      .filter((w) => w && !ABBR_STOPWORDS.has(w.toLowerCase()));
    let code;
    if (words.length === 0) code = base.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    else if (words.length === 1) code = words[0].slice(0, 3).toUpperCase();
    else code = words.map((w) => w[0].toUpperCase()).join('');
    return isLab(name) ? `${code}-Lab` : code;
  };

  const sessionCounts = new Map();
  timetable.forEach((item) => sessionCounts.set(item.Course, (sessionCounts.get(item.Course) || 0) + 1));

  const uniqueCourses = [...new Set(timetable.map((item) => item.Course))];
  const byCode = new Map();
  uniqueCourses.forEach((course) => {
    const code = baseCode(course);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(course);
  });

  const codeToCourse = new Map();
  byCode.forEach((courses, code) => {
    [...courses]
      .sort((a, b) => (sessionCounts.get(b) || 0) - (sessionCounts.get(a) || 0) || a.localeCompare(b))
      .forEach((course, i) => {
        codeToCourse.set(i === 0 ? code : `${code}${i + 1}`, course);
      });
  });
  return codeToCourse;
};

// Stable identity for a scheduled cell, shared by useClassNotifications and
// NowNext so they agree on which session is which without either
// recomputing the other's logic.
export const sessionKey = (cell) => {
  const item = cell.classes[0];
  return `${item.Course}|${item.Section}|${cell.startMin}|${cell.endMin}`;
};

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
