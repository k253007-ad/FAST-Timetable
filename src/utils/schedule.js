// Shared weekly-schedule builder: turns raw timetable rows + the current
// selection into a per-day grid of merged sessions (labs span 3 slots,
// identical consecutive sessions merge, overlapping different classes fold
// into one cell as a clash). Used by both the grid and the now/next summary
// so they never disagree about what a "session" is.

// Exported again as of the manual-reschedule feature — ClassSelector needs
// the weekday list for its "move to..." day picker.
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

// Every distinct slot string across the whole timetable, in chronological
// order — shared by buildSchedule and getClassOccurrences below, and by the
// reschedule UI's "move to..." slot picker.
export const getAllTimeSlots = (data) => {
  if (!data?.timetable) return [];
  return [...new Set(data.timetable.map((item) => item.Time))].sort(
    (a, b) => toMinutes(a.split('-')[0]) - toMinutes(b.split('-')[0])
  );
};

/**
 * Manual per-device time overrides ("my class moved from Wednesday slot 4 to
 * Thursday slot 7") — the shared sheet is updated manually and can lag real
 * schedule changes, so this lets a student correct just their own view
 * without touching the shared data. Each override is one raw timetable row's
 * worth of relocation: `{ course, section, day, time, newDay, newTime }`.
 * A multi-slot lab moved as a block becomes several of these, one per raw
 * slot it occupies — see buildMoveOverrides below, which is what actually
 * generates them from a UI "move this session" action.
 */
export const applyOverrides = (items, overrides) => {
  if (!overrides || overrides.length === 0) return items;
  return items.map((item) => {
    const match = overrides.find(
      (o) => o.course === item.Course && o.section === item.Section && o.day === item.Day && o.time === item.Time
    );
    return match ? { ...item, Day: match.newDay, Time: match.newTime } : item;
  });
};

/**
 * One entry per distinct (Course, Section, Day) session among the given
 * classes' *official* (un-overridden) raw timetable rows — a multi-slot lab
 * collapses into a single occurrence spanning however many consecutive
 * slots (by `timeSlots` order) it actually occupies, so moving it moves the
 * whole block at once rather than one raw 50-minute row at a time. Always
 * computed from the official schedule, not the currently-overridden one, so
 * an occurrence's identity doesn't shift out from under an existing move.
 *
 * De-dupes to distinct *times* before detecting consecutive runs — the
 * sheet can have more than one raw row for the same (Course, Section, Day,
 * Time) (e.g. the same section split across two rooms/instructors for
 * capacity), and treating each raw row as its own run-position would split
 * those into bogus separate occurrences at the identical time instead of
 * recognizing them as one shared slot. `applyOverrides` already moves every
 * raw row matching a given (course, section, day, time), so collapsing here
 * doesn't lose either room's row when the slot is actually moved.
 */
export const getClassOccurrences = (data, selectedClasses) => {
  if (!data?.timetable) return [];

  const timeSlots = getAllTimeSlots(data);
  const slotIndex = new Map(timeSlots.map((t, i) => [t, i]));

  const relevant = data.timetable.filter((item) =>
    selectedClasses.includes(`${item.Course} - ${item.Section}`)
  );

  const groups = new Map(); // "Course|Section|Day" -> Set of distinct Time strings
  relevant.forEach((item) => {
    const key = `${item.Course}|${item.Section}|${item.Day}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(item.Time);
  });

  const occurrences = [];
  groups.forEach((timeSet, key) => {
    const [course, section, day] = key.split('|');
    const times = [...timeSet].sort((a, b) => slotIndex.get(a) - slotIndex.get(b));
    let run = [times[0]];
    for (let i = 1; i < times.length; i++) {
      if (slotIndex.get(times[i]) === slotIndex.get(run[run.length - 1]) + 1) {
        run.push(times[i]);
      } else {
        occurrences.push({ course, section, day, slots: run });
        run = [times[i]];
      }
    }
    occurrences.push({ course, section, day, slots: run });
  });

  return occurrences.sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
      slotIndex.get(a.slots[0]) - slotIndex.get(b.slots[0]) ||
      a.course.localeCompare(b.course)
  );
};

/**
 * Turns a "move this occurrence to {newDay} starting at {newStartSlot}" UI
 * action into the raw per-slot override entries `applyOverrides` expects —
 * one per slot the occurrence spans, kept in the same relative order.
 * Returns null if the day doesn't have enough slots left from newStartSlot
 * to fit the whole occurrence.
 */
export const buildMoveOverrides = (occurrence, timeSlots, newDay, newStartSlot) => {
  const startIdx = timeSlots.indexOf(newStartSlot);
  if (startIdx === -1) return null;
  const targetSlots = timeSlots.slice(startIdx, startIdx + occurrence.slots.length);
  if (targetSlots.length < occurrence.slots.length) return null;
  return occurrence.slots.map((time, i) => ({
    course: occurrence.course,
    section: occurrence.section,
    day: occurrence.day,
    time,
    newDay,
    newTime: targetSlots[i],
  }));
};

/**
 * A one-off "extra class" — a single additional occurrence of an
 * already-selected course/section (a makeup lecture, an extra revision
 * session, etc.), added for one specific day/slot rather than as a
 * recurring weekly change like an override. `{ course, section, day, time }`
 * is all a UI action needs to specify; `buildExtraRows` below fills in the
 * Instructor/Room by copying them from that course's own real timetable row
 * (there's no source-of-truth row for a slot that doesn't officially exist).
 * The app has no real calendar/date model — everything is a recurring
 * weekly grid — so "only for this week" is enforced by the student manually
 * removing it once the week is over, not by any date logic here.
 */
export const buildExtraRows = (data, extraClasses) => {
  if (!data?.timetable || !extraClasses || extraClasses.length === 0) return [];
  return extraClasses
    .map((extra) => {
      const template = data.timetable.find(
        (item) => item.Course === extra.course && item.Section === extra.section
      );
      if (!template) return null;
      return {
        ...template,
        Day: extra.day,
        Time: extra.time,
        isExtra: true,
      };
    })
    .filter(Boolean);
};

/**
 * Builds { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount }
 * for the given timetable data and selection. `processedSchedule[day]` is an
 * ordered array of cells: `{ slot, colSpan, classes, isEmpty }`. `overrides`
 * (see applyOverrides above) relocates specific sessions before the grid is
 * built, so a manually-moved class clashes/merges exactly like a real one
 * scheduled there would. `extraClasses` (see buildExtraRows above) adds
 * one-off sessions on top — they participate in clash detection like any
 * other session, but are flagged `isExtra` so the UI can style/hide them
 * differently (not printed, distinct look) and so their tally is excluded
 * from `sessionCount`/`courseCount` (those numbers are print/export-only —
 * see .grid-toolbar — and should describe what the printed grid shows).
 */
export const buildSchedule = (data, selectedClasses, overrides = [], extraClasses = []) => {
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

  const timeSlots = getAllTimeSlots(data);

  const filteredData = [
    ...applyOverrides(
      data.timetable.filter((item) => selectedClasses.includes(`${item.Course} - ${item.Section}`)),
      overrides
    ),
    ...buildExtraRows(data, extraClasses),
  ];

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
    sessionCount: filteredData.filter((item) => !item.isExtra).length,
    courseCount: new Set(filteredData.filter((item) => !item.isExtra).map((item) => item.Course)).size,
    clashCount,
  };
};
