import { Fragment, useEffect, useMemo, useRef } from 'react';
import { splitClassValue, withAlpha } from '../utils/courseColors.js';
import { buildSchedule, cleanRoom, formatSlot } from '../utils/schedule.js';
import { IconAlert, IconCalendar } from './Icons.jsx';

// A course+section label that's too long for its box (more common now that
// the section is appended to the course name) used to just get silently
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

const TimetableGrid = ({ data, selectedClasses, courseColors, isDark }) => {
  const gridRef = useRef(null);
  const { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount } = useMemo(
    () => buildSchedule(data, selectedClasses),
    [data, selectedClasses]
  );

  // Re-fit course labels after every render that could change them (new
  // selection, new data) and whenever the grid's own size changes (window
  // resize, sidebar toggling, browser zoom) — box width is what determines
  // where text wraps, so a size change can un-fit or re-fit a label.
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return undefined;
    fitCourseLabels(container);
    const refit = () => fitCourseLabels(container);
    const observer = new ResizeObserver(refit);
    observer.observe(container);
    // A real browser print can reflow the page at print-time dimensions
    // without firing a resize/ResizeObserver event in every browser, so
    // re-check explicitly when print starts.
    window.addEventListener('beforeprint', refit);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', refit);
    };
  }, [processedSchedule]);

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

  const legendCourses = Object.keys(courseColors).filter((course) =>
    selectedClasses.some((v) => splitClassValue(v).course === course)
  );

  const boxStyle = (course) => {
    const color = courseColors[course] || '#64748b';
    return {
      backgroundColor: withAlpha(color, isDark ? 0.18 : 0.11),
      borderLeft: `3px solid ${color}`,
    };
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

      <div className="tt-scroll">
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
                      {cell.classes.map((classItem, index) => {
                        const label =
                          classItem.Section !== 'N/A'
                            ? `${classItem.Course} (${classItem.Section})`
                            : classItem.Course;
                        return (
                          <div
                            key={index}
                            className="class-box"
                            style={boxStyle(classItem.Course)}
                            title={`${label} · ${cleanRoom(classItem.Room)} · ${classItem.Instructor}`}
                          >
                            <span className="class-course">{label}</span>
                            <span className="class-meta">{cleanRoom(classItem.Room)}</span>
                            <span className="class-meta">{classItem.Instructor}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TimetableGrid;
