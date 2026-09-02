import { Fragment, useEffect, useMemo, useRef } from 'react';
import { splitClassValue, withAlpha } from '../utils/courseColors.js';
import { buildSchedule, cleanRoom, formatSlot } from '../utils/schedule.js';
import { IconAlert, IconCalendar } from './Icons.jsx';

// A course name that's too long for its box used to just get silently
// clipped by class-course's line-clamp, with no on-screen sign anything was
// cut off — and there's no reliable way to predict from the string alone
// whether it'll wrap to fit (word-break points vary: two labels the same
// length can wrap completely differently). So this measures the *actual*
// rendered box after layout and steps the font down only where real overflow
// is detected, escalating one tier at a time until it fits or the largest
// tier is reached. The tier classes' effect is scoped to desktop/print via a
// media query in index.css, so this runs unconditionally — it's a harmless
// no-op on mobile, which keeps its fixed size and clamp there.
const TIER_CLASSES = ['class-course--tier2', 'class-course--tier3'];

// Fixed per-type colours for personal activities (ACTIVITY_TYPES in
// schedule.js) — deliberately not derived from courseColors, which only
// knows about real "Course - Section" selections.
const ACTIVITY_COLORS = {
  Library: '#0891b2',
  Cafe: '#d97706',
  Spot: '#65a30d',
  Canteen: '#dc2626',
  'Prayer/Namaz': '#7c3aed',
  'Touch Grass': '#16a34a',
};

const fitCourseLabels = (container) => {
  if (!container) return;
  container.querySelectorAll('.class-course').forEach((el) => {
    el.classList.remove(...TIER_CLASSES);
    for (const tierClass of TIER_CLASSES) {
      if (el.scrollHeight <= el.clientHeight + 1) break;
      el.classList.add(tierClass);
    }
  });
};

// Merges consecutive empty slots into one combined "Free" block spanning
// their whole time range, instead of one row per empty slot (added
// 2026-09-01 — "4 separate Free [rows] in a line" read as noisy; a run of
// back-to-back free slots is just one open stretch of time). Non-empty
// cells pass through untouched, one row each, same as before.
const buildDayRows = (cells) => {
  const rows = [];
  let i = 0;
  while (i < cells.length) {
    if (!cells[i].isEmpty) {
      rows.push({ type: 'class', cell: cells[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < cells.length && cells[j].isEmpty) j++;
    rows.push({
      type: 'free',
      key: cells[i].slot,
      span: j - i,
      startLabel: formatSlot(cells[i].slot).start,
      endLabel: formatSlot(cells[j - 1].slot).end,
    });
    i = j;
  }
  return rows;
};

// "Slot 1" for a single slot, "Slot 1-3" for one spanning several (a lab's
// colSpan, or a merged run of Free slots) — added 2026-09-01 after feedback
// that a multi-slot row showing just its first slot's number silently hid
// how much time it actually occupied.
const slotRangeLabel = (timeSlots, startSlot, span) => {
  const startIdx = timeSlots.indexOf(startSlot);
  const endIdx = startIdx + span - 1;
  return startIdx === endIdx ? `Slot ${startIdx + 1}` : `Slot ${startIdx + 1}-${endIdx + 1}`;
};

// `viewMode` ('week' | 'day') and `selectedDay` (which weekday the 'day'
// view shows) are owned by App.jsx now (added 2026-09-01, moved out of this
// component into a standalone, more visible toggle box between NowNext and
// the grid) — this component just renders whichever one it's told to.
// Print/export always render the full week grid regardless of `viewMode`,
// via the .exporting/@media print overrides in index.css — see the
// hard-constraint comment there.
const TimetableGrid = ({
  data,
  selectedClasses,
  overrides,
  extraClasses,
  activities,
  courseColors,
  isDark,
  viewMode,
  selectedDay,
}) => {
  const gridRef = useRef(null);
  const dayViewRef = useRef(null);
  const { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount } = useMemo(
    () => buildSchedule(data, selectedClasses, overrides, extraClasses, activities),
    [data, selectedClasses, overrides, extraClasses, activities]
  );

  // Re-fit course labels after every render that could change them (new
  // selection, new data) and whenever either view's own size changes
  // (window resize, sidebar toggling, browser zoom) — box width is what
  // determines where text wraps, so a size change can un-fit or re-fit a
  // label. Covers both the full grid and the Today view's boxes (added
  // 2026-09-01) — same `.class-course` markup in both, so the same fit
  // logic applies unchanged; a ref that's currently unmounted (whichever
  // view isn't showing) is just skipped.
  useEffect(() => {
    const containers = [gridRef.current, dayViewRef.current].filter(Boolean);
    if (containers.length === 0) return undefined;
    containers.forEach(fitCourseLabels);
    const refit = () => containers.forEach(fitCourseLabels);
    const observer = new ResizeObserver(refit);
    containers.forEach((c) => observer.observe(c));
    // A real browser print can reflow the page at print-time dimensions
    // without firing a resize/ResizeObserver event in every browser, so
    // re-check explicitly when print starts.
    window.addEventListener('beforeprint', refit);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', refit);
    };
  }, [processedSchedule, viewMode]);

  if (!data?.timetable) return null;

  if (selectedClasses.length === 0) {
    return (
      <section className="card empty-card">
        <div className="empty-state">
          <div className="empty-icon">
            <IconCalendar size={26} />
          </div>
          <h3>Build your weekly timetable</h3>
          <p>
            Search for a course above and tick the sections you’re enrolled in. Your schedule
            appears here instantly — colour-coded, clash-checked, and ready to print.
          </p>
        </div>
      </section>
    );
  }

  if (sessionCount === 0) {
    return (
      <section className="card empty-card">
        <div className="empty-state">
          <div className="empty-icon is-warning">
            <IconAlert size={26} />
          </div>
          <h3>No sessions found for your selection</h3>
          <p>
            The official sheet may have been updated since you last picked your sections. Try
            clearing your selection and choosing your courses again.
          </p>
        </div>
      </section>
    );
  }

  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long' });
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Find the live-right-now cell and the next upcoming one, searching
  // forward from today (wrapping to Monday) across the days actually shown.
  const todayIndex = days.indexOf(today);
  let currentCellKey = null;
  let nextCellKey = null;

  if (todayIndex !== -1) {
    const currentCell = processedSchedule[today]?.find(
      (cell) => !cell.isEmpty && nowMinutes >= cell.startMin && nowMinutes < cell.endMin
    );
    if (currentCell) currentCellKey = `${today}-${currentCell.slot}`;
  }

  if (days.length > 0) {
    const startIndex = todayIndex !== -1 ? todayIndex : 0;
    for (let offset = 0; offset < days.length && !nextCellKey; offset++) {
      const day = days[(startIndex + offset) % days.length];
      const isToday = offset === 0 && todayIndex !== -1;
      const upcoming = processedSchedule[day]?.find((cell) => {
        if (cell.isEmpty) return false;
        if (!isToday) return true;
        return cell.startMin > nowMinutes;
      });
      if (upcoming) nextCellKey = `${day}-${upcoming.slot}`;
    }
  }

  // Now/Next for the Today view (added 2026-09-01) — deliberately day-scoped
  // rather than the week-wrapping search above (same "today only" reasoning
  // as NowNext.jsx): only meaningful when the day actually being browsed is
  // the real today, since "now" on a different day makes no sense.
  const dayViewCurrentSlot =
    selectedDay === today
      ? processedSchedule[selectedDay]?.find(
          (cell) => !cell.isEmpty && nowMinutes >= cell.startMin && nowMinutes < cell.endMin
        )?.slot
      : undefined;
  const dayViewNextSlot =
    selectedDay === today
      ? processedSchedule[selectedDay]?.find((cell) => !cell.isEmpty && cell.startMin > nowMinutes)?.slot
      : undefined;

  const legendCourses = Object.keys(courseColors).filter((course) =>
    selectedClasses.some((v) => splitClassValue(v).course === course)
  );

  const boxStyle = (course, isExtra) => {
    const color = courseColors[course] || '#64748b';
    if (isExtra) {
      // Same per-course colour, but a dashed outline + lighter fill instead
      // of the normal solid left-accent — distinct at a glance from a real
      // recurring session without needing a whole second colour system.
      return {
        backgroundColor: withAlpha(color, isDark ? 0.1 : 0.06),
        border: `1.5px dashed ${color}`,
        borderLeftWidth: '3px',
      };
    }
    return {
      backgroundColor: withAlpha(color, isDark ? 0.18 : 0.11),
      borderLeft: `3px solid ${color}`,
    };
  };

  // Activities get their own fixed palette (not courseColors — that map is
  // keyed by real "Course - Section" selections and knows nothing about
  // activity types) and a dotted outline, a third visual style distinct
  // from both a real course (solid left-accent) and an extra (dashed).
  const activityStyle = (type) => {
    const color = ACTIVITY_COLORS[type] || '#64748b';
    return {
      backgroundColor: withAlpha(color, isDark ? 0.14 : 0.08),
      border: `1.5px dotted ${color}`,
      borderLeftWidth: '3px',
    };
  };

  // Shared by both the full grid and the Today view so a session box never
  // looks or behaves differently between the two. An activity (Library,
  // Prayer/Namaz, ...) has no section/room/instructor to show, so its box
  // is deliberately sparser than a real class's.
  const renderClassBox = (classItem, index) => {
    if (classItem.isActivity) {
      return (
        <div
          key={index}
          className="class-box is-activity"
          style={activityStyle(classItem.Course)}
          title={`${classItem.Course} · Personal activity`}
        >
          <span className="activity-badge">Activity</span>
          <span className="class-course">{classItem.Course}</span>
        </div>
      );
    }
    const hasSection = classItem.Section !== 'N/A';
    const extraSuffix = classItem.isExtra ? ' · Extra, this week only' : '';
    return (
      <div
        key={index}
        className={`class-box${classItem.isExtra ? ' is-extra' : ''}`}
        style={boxStyle(classItem.Course, classItem.isExtra)}
        title={`${classItem.Course} · ${cleanRoom(classItem.Room)}${hasSection ? ` · ${classItem.Section}` : ''} · ${classItem.Instructor}${extraSuffix}`}
      >
        {classItem.isExtra && <span className="extra-badge">Extra</span>}
        <span className="class-course">{classItem.Course}</span>
        <span className="class-meta">{cleanRoom(classItem.Room)}</span>
        {hasSection && <span className="class-meta">{classItem.Section}</span>}
        <span className="class-meta">{classItem.Instructor}</span>
      </div>
    );
  };

  return (
    <section className="card grid-card">
      <div className="grid-toolbar">
        <ul className="legend" aria-label="Course colours">
          {legendCourses.map((course) => (
            <li key={course} className="legend-item">
              <span
                className="legend-dot"
                style={{ backgroundColor: courseColors[course] }}
              />
              {course}
            </li>
          ))}
        </ul>
        <div className="grid-stats">
          {sessionCount} session{sessionCount === 1 ? '' : 's'} · {courseCount} course
          {courseCount === 1 ? '' : 's'} / week
        </div>
      </div>

      {clashCount > 0 && (
        <div className="clash-banner" role="status">
          <IconAlert size={15} />
          {clashCount === 1
            ? '1 time clash detected — overlapping sessions are outlined below.'
            : `${clashCount} time clashes detected — overlapping sessions are outlined below.`}
        </div>
      )}

      <div className={`tt-scroll${viewMode === 'day' ? ' is-day-view' : ''}`}>
        <div
          ref={gridRef}
          className="tt"
          role="table"
          aria-label="Weekly timetable"
          style={{
            gridTemplateColumns: `132px repeat(${timeSlots.length}, minmax(108px, 1fr))`,
          }}
        >
          <div className="tt-cell tt-head tt-corner">Day / Time</div>
          {timeSlots.map((slot, index) => {
            const { start, end } = formatSlot(slot);
            return (
              <div key={slot} className="tt-cell tt-head tt-slot">
                <span className="tt-slot-num">Slot {index + 1}</span>
                <span className="tt-slot-time">
                  {start}
                  {end && <span className="tt-slot-dash"> – {end}</span>}
                </span>
              </div>
            );
          })}

          {days.map((day) => {
            const isToday = day === today;
            const rowMod = isToday ? ' is-today' : '';
            return (
              <Fragment key={day}>
                <div className={`tt-cell tt-daycell${rowMod}`}>
                  <span className="tt-dayname">{day}</span>
                  {isToday && <span className="today-pill">Today</span>}
                </div>
                {processedSchedule[day].map((cell) => {
                  const cellKey = `${day}-${cell.slot}`;
                  const isNow = cellKey === currentCellKey;
                  const isNext = !isNow && cellKey === nextCellKey;
                  return cell.isEmpty ? (
                    <div
                      key={cell.slot}
                      className={`tt-cell tt-body is-empty${rowMod}`}
                      style={{ gridColumn: `span ${cell.colSpan}` }}
                    />
                  ) : (
                    <div
                      key={cell.slot}
                      className={`tt-cell tt-body${cell.classes.length > 1 ? ' is-clash' : ''}${rowMod}${
                        isNow ? ' is-now' : ''
                      }${isNext ? ' is-next' : ''}`}
                      style={{ gridColumn: `span ${cell.colSpan}` }}
                    >
                      {isNow && <span className="now-badge">Now</span>}
                      {isNext && <span className="next-badge">Next</span>}
                      {cell.classes.map((classItem, index) => renderClassBox(classItem, index))}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>

      {viewMode === 'day' && (
        <div className="day-view no-print" ref={dayViewRef}>
          {!(selectedDay in processedSchedule) ? (
            <p className="day-view-empty">No classes that day.</p>
          ) : (
            buildDayRows(processedSchedule[selectedDay]).map((row) => {
              if (row.type === 'free') {
                return (
                  <div key={`free-${row.key}`} className="day-view-row is-empty">
                    <div className="day-view-time">
                      {slotRangeLabel(timeSlots, row.key, row.span)} · {row.startLabel}
                      {row.endLabel && ` – ${row.endLabel}`}
                    </div>
                    <div className="day-view-body">
                      <span className="day-view-free">Free</span>
                    </div>
                  </div>
                );
              }

              const { cell } = row;
              const isNow = cell.slot === dayViewCurrentSlot;
              const isNext = !isNow && cell.slot === dayViewNextSlot;
              return (
                <div
                  key={cell.slot}
                  className={`day-view-row${cell.classes.length > 1 ? ' is-clash' : ''}${isNow ? ' is-now' : ''}${
                    isNext ? ' is-next' : ''
                  }`}
                >
                  <div className="day-view-time">
                    {slotRangeLabel(timeSlots, cell.slot, cell.colSpan)} · {cell.startLabel}
                    {cell.endLabel && ` – ${cell.endLabel}`}
                    {isNow && <span className="day-view-badge is-now">Now</span>}
                    {isNext && <span className="day-view-badge is-next">Next</span>}
                  </div>
                  <div className="day-view-body">
                    {cell.classes.map((classItem, index) => renderClassBox(classItem, index))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
};

export default TimetableGrid;
