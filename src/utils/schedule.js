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

const ROMAN_BUILDING = { I: '1', II: '2', III: '3', IV: '4', V: '5' };

// "AB2 Room D25" -> "AB2", "Academic Block II Electronics Lab" -> "AB2" (a
// handful of lab venues in the sheet spell the building out with a roman
// numeral instead of the usual "AB<n>" short form) — anything that matches
// neither falls into a synthetic "Other" bucket rather than being dropped.
const getBuildingLabel = (room) => {
  const short = room.match(/^AB\s*(\d+)/i);
  if (short) return `AB${short[1]}`;
  const spelled = room.match(/^Academic Block\s+(I{1,3}|IV|V)\b/i);
  if (spelled) return `AB${ROMAN_BUILDING[spelled[1].toUpperCase()] || spelled[1]}`;
  return 'Other';
};

/**
 * Groups every distinct Room string in `data` for the classroom picker used
 * by "Adjust class times" and "Add extra class": `{ [building]: { labs:
 * [rawRoom, ...], classes: { [letter]: [{ raw, number }, ...] } } }`.
 * Buildings are derived from the data itself (not hardcoded to AB1/AB2) so a
 * new building in the sheet just shows up as another option.
 *
 * A room counts as a "lab" if its raw label doesn't contain the word "room"
 * at all (matches this sheet's own naming: "AB1 Lab 2", "Academic Block II
 * Physics Lab") — labs are listed flat, no letter/number split, since
 * they're not laid out on a lettered grid the way classrooms are.
 *
 * A "classroom" (label does contain "room") is parsed into a letter + number
 * by stripping the building prefix and the word "room" and matching
 * `letters` + `digits` (e.g. "E1", "R109"). A label that doesn't fit that
 * shape (e.g. the sheet's own "AB1 Room LLC", or "AB2RoomEng Lang") becomes
 * its own "letter" bucket with `number: null` — the picker skips the number
 * step for any bucket where every entry has no number, which naturally
 * covers LLC-style single-room buckets without a special case.
 */
export const getRoomOptions = (data) => {
  if (!data?.timetable) return {};
  const rooms = [...new Set(data.timetable.map((item) => item.Room).filter((r) => r && r !== 'N/A'))];

  const buildings = {};
  rooms.forEach((raw) => {
    const building = getBuildingLabel(raw);
    if (!buildings[building]) buildings[building] = { labs: [], classes: {} };

    if (!/room/i.test(raw)) {
      buildings[building].labs.push(raw);
      return;
    }

    const suffix = raw
      .replace(/^AB\s*\d+/i, '')
      .replace(/^Academic Block\s+(I{1,3}|IV|V)\b/i, '')
      .replace(/room/i, '')
      .trim();
    const match = suffix.match(/^([A-Za-z]+)\s*(\d+)$/);
    const letter = (match ? match[1] : suffix).toUpperCase() || 'OTHER';
    const number = match ? match[2] : null;

    if (!buildings[building].classes[letter]) buildings[building].classes[letter] = [];
    buildings[building].classes[letter].push({ raw, number });
  });

  Object.values(buildings).forEach((b) => {
    b.labs.sort();
    Object.values(b.classes).forEach((entries) =>
      entries.sort((a, c) => Number(a.number || 0) - Number(c.number || 0))
    );
  });

  return buildings;
};

/**
 * Reverse-lookup: given a raw Room string, finds where it sits in
 * `getRoomOptions`'s output — `{ building, type, letter, number, labRoom }`
 * (`type` is `'class'` or `'lab'`; whichever of letter/number vs labRoom
 * doesn't apply is `''`), or `null` if the room isn't in the current data.
 * Used to seed the classroom picker (Adjust class times / Add extra class)
 * from a session's actual current room instead of always defaulting to the
 * first building/type/letter.
 */
export const locateRoom = (roomOptions, raw) => {
  if (!raw) return null;
  for (const building of Object.keys(roomOptions)) {
    const group = roomOptions[building];
    if (group.labs.includes(raw)) return { building, type: 'lab', letter: '', number: '', labRoom: raw };
    for (const letter of Object.keys(group.classes)) {
      const found = group.classes[letter].find((e) => e.raw === raw);
      if (found) return { building, type: 'class', letter, number: found.number || '', labRoom: '' };
    }
  }
  return null;
};

/**
 * Fills in a possibly-partial/stale `{ building, type, letter, number,
 * labRoom }` selection (as picked by the cascading classroom UI) with valid
 * fallbacks and resolves it to one real raw Room string — same "derive a
 * valid value at render time instead of syncing state via an effect"
 * approach as ClassSelector's `effectiveExtraCourse`/`effectiveExtraSlot`.
 * A letter bucket with no numbered entries (e.g. "AB1 Room LLC") resolves
 * straight to its one room, skipping the number step entirely.
 */
export const resolveRoomSelection = (roomOptions, sel = {}) => {
  const buildingKeys = Object.keys(roomOptions).sort();
  const building = buildingKeys.includes(sel.building) ? sel.building : buildingKeys[0] || '';
  const group = roomOptions[building] || { labs: [], classes: {} };
  const hasLabs = group.labs.length > 0;
  const hasClasses = Object.keys(group.classes).length > 0;
  const type =
    sel.type === 'lab' && hasLabs ? 'lab' : sel.type === 'class' && hasClasses ? 'class' : hasClasses ? 'class' : 'lab';

  if (type === 'lab') {
    const labRoom = group.labs.includes(sel.labRoom) ? sel.labRoom : group.labs[0] || '';
    return { building, type, letter: '', number: '', labRoom, resolvedRoom: labRoom };
  }

  const classLetters = Object.keys(group.classes).sort();
  const letter = classLetters.includes(sel.letter) ? sel.letter : classLetters[0] || '';
  const entries = group.classes[letter] || [];
  const numbered = entries.filter((e) => e.number !== null);
  let number = '';
  let resolvedRoom = '';
  if (numbered.length > 0) {
    const found = numbered.find((e) => e.number === sel.number);
    number = found ? found.number : numbered[0]?.number || '';
    resolvedRoom = (found || numbered[0])?.raw || '';
  } else {
    resolvedRoom = entries[0]?.raw || '';
  }
  return { building, type, letter, number, labRoom: '', resolvedRoom };
};

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
 * Live "Course - Section" list for one roll number / section, read fresh
 * from `data` every time it's called — backs the "keep synced" feature
 * (App.jsx): unlike a one-time group-select (which just adds a fixed list of
 * classes once), a synced roll no/section is re-resolved against whatever
 * the sheet currently says, so a course added/dropped/changed for that roll
 * no or section is picked up automatically on the next data refresh.
 * Returns `null` (not `[]`) when the relevant data source isn't loaded at
 * all, so a caller can tell "nothing to sync yet" apart from "sheet says
 * this roll no/section now has zero classes" (a real, meaningful state once
 * the source data exists — the sync should overwrite existing entries).
 */
export const getClassesForRollNo = (data, rollNo) => {
  if (!rollNo || !data?.rollNumbers?.length) return null;
  const normalized = rollNo.trim().toLowerCase();
  const classes = new Set();
  data.rollNumbers.forEach((item) => {
    if ((item.RollNo || '').trim().toLowerCase() === normalized) {
      classes.add(`${item.Course} - ${item.Section}`);
    }
  });
  return [...classes];
};

export const getClassesForSection = (data, section) => {
  if (!section || !data?.timetable?.length) return null;
  const normalized = section.trim().toLowerCase();
  const classes = new Set();
  data.timetable.forEach((item) => {
    if ((item.Section || '').trim().toLowerCase() === normalized) {
      classes.add(`${item.Course} - ${item.Section}`);
    }
  });
  return [...classes];
};

/**
 * Manual per-device time overrides ("my class moved from Wednesday slot 4 to
 * Thursday slot 7") — the shared sheet is updated manually and can lag real
 * schedule changes, so this lets a student correct just their own view
 * without touching the shared data. Each override is one raw timetable row's
 * worth of relocation: `{ course, section, day, time, newDay, newTime,
 * newRoom? }`. `newRoom` (added 2026-09-01, alongside the classroom picker)
 * is optional — omitted, the row keeps its original Room. A multi-slot lab
 * moved as a block becomes several of these, one per raw slot it occupies —
 * see buildMoveOverrides below, which is what actually generates them from a
 * UI "move this session" action.
 */
export const applyOverrides = (items, overrides) => {
  if (!overrides || overrides.length === 0) return items;
  return items.map((item) => {
    const match = overrides.find(
      (o) => o.course === item.Course && o.section === item.Section && o.day === item.Day && o.time === item.Time
    );
    if (!match) return item;
    return {
      ...item,
      Day: match.newDay,
      Time: match.newTime,
      ...(match.newRoom ? { Room: match.newRoom } : {}),
    };
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

  const groups = new Map(); // "Course|Section|Day" -> { times: Set of distinct Time strings, room }
  relevant.forEach((item) => {
    const key = `${item.Course}|${item.Section}|${item.Day}`;
    if (!groups.has(key)) groups.set(key, { times: new Set(), room: item.Room });
    groups.get(key).times.add(item.Time);
  });

  const occurrences = [];
  groups.forEach(({ times: timeSet, room }, key) => {
    const [course, section, day] = key.split('|');
    const times = [...timeSet].sort((a, b) => slotIndex.get(a) - slotIndex.get(b));
    let run = [times[0]];
    for (let i = 1; i < times.length; i++) {
      if (slotIndex.get(times[i]) === slotIndex.get(run[run.length - 1]) + 1) {
        run.push(times[i]);
      } else {
        occurrences.push({ course, section, day, slots: run, room });
        run = [times[i]];
      }
    }
    occurrences.push({ course, section, day, slots: run, room });
  });

  return occurrences.sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
      slotIndex.get(a.slots[0]) - slotIndex.get(b.slots[0]) ||
      a.course.localeCompare(b.course)
  );
};

/**
 * Turns a "move this occurrence to {newDay} starting at {newStartSlot}
 * (optionally also into {newRoom})" UI action into the raw per-slot override
 * entries `applyOverrides` expects — one per slot the occurrence spans, kept
 * in the same relative order. Returns null if the day doesn't have enough
 * slots left from newStartSlot to fit the whole occurrence. `newRoom` is
 * optional — pass a falsy value to leave the occurrence's Room unchanged.
 */
export const buildMoveOverrides = (occurrence, timeSlots, newDay, newStartSlot, newRoom) => {
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
    ...(newRoom ? { newRoom } : {}),
  }));
};

/**
 * A one-off "extra class" — a single additional occurrence of an
 * already-selected course/section (a makeup lecture, an extra revision
 * session, etc.), added for one specific day/slot rather than as a
 * recurring weekly change like an override. `{ course, section, day, time,
 * room? }` is all a UI action needs to specify; `buildExtraRows` below fills
 * in the Instructor/Room by copying them from that course's own real
 * timetable row (there's no source-of-truth row for a slot that doesn't
 * officially exist) unless `room` was explicitly picked (added 2026-09-01,
 * alongside the classroom picker), in which case that overrides the copied
 * Room. The app has no real calendar/date model — everything is a recurring
 * weekly grid, so an extra is only ever "this week's Monday" etc., never a
 * specific date — **auto-removed once its own slot has passed** (see
 * `isExtraExpired` below, added 2026-09-01) rather than requiring the
 * student to remember to delete it themselves.
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
        ...(extra.room ? { Room: extra.room } : {}),
        isExtra: true,
      };
    })
    .filter(Boolean);
};

/**
 * True once an extra class's one-off slot has already ended relative to
 * `now` — the trigger for automatically removing it (App.jsx) instead of
 * leaving it for the student to delete by hand. Since an extra only ever
 * carries a weekday name (no real date), "passed" means: an earlier weekday
 * than today (already happened this week), or today's own weekday with an
 * end time at or before the current clock time. A day name outside
 * DAY_ORDER (shouldn't happen — extras are only ever added via the
 * DAY_ORDER picker) is treated as not-yet-expired rather than risking an
 * incorrect auto-delete.
 *
 * `extra.time` is only ever the *first* slot it was added at (see
 * buildExtraRows) — for a lab, the real session runs 3 slots, so its true
 * end is 2 slots later than `extra.time`'s own end. `data` (optional) lets
 * this look that up the same way buildSchedule's own merge logic decides
 * "is this a lab" (Room or Course containing "lab"); without `data`, this
 * falls back to just `extra.time`'s own end, which is only wrong (early) for
 * labs specifically.
 */
export const isExtraExpired = (extra, now, data) => {
  const todayIdx = DAY_ORDER.indexOf(now.toLocaleDateString('en-US', { weekday: 'long' }));
  const extraIdx = DAY_ORDER.indexOf(extra.day);
  if (todayIdx === -1 || extraIdx === -1) return false;
  if (extraIdx < todayIdx) return true;
  if (extraIdx > todayIdx) return false;

  let endSlot = extra.time;
  if (data?.timetable?.length) {
    const template = data.timetable.find(
      (item) => item.Course === extra.course && item.Section === extra.section
    );
    const room = extra.room || template?.Room;
    const isLab = (room || '').toLowerCase().includes('lab') || (extra.course || '').toLowerCase().includes('lab');
    if (isLab) {
      const slots = getAllTimeSlots(data);
      const idx = slots.indexOf(extra.time);
      if (idx !== -1) endSlot = slots[Math.min(idx + 2, slots.length - 1)];
    }
  }

  const endMin = toMinutes(formatSlot(endSlot).end);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= endMin;
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
  // A session is a 3-slot lab if it's held in a Lab room OR its course name
  // says "Lab" (either signal alone is enough — some labs meet in a
  // non-"Lab"-named room, some "... Lab" courses are still named that way in
  // rooms lacking "Lab" in the label); any different class sitting inside a
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

        if (
          (classItem.Room || '').toLowerCase().includes('lab') ||
          (classItem.Course || '').toLowerCase().includes('lab')
        ) {
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
