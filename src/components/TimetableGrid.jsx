import { Fragment, useMemo } from 'react';
import { splitClassValue, withAlpha } from '../utils/courseColors.js';
import { buildSchedule, cleanRoom, formatSlot, slotMinuteRange } from '../utils/schedule.js';
import { IconAlert, IconCalendar } from './Icons.jsx';

const TimetableGrid = ({ data, selectedClasses, courseColors, isDark }) => {
  const { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount } = useMemo(
    () => buildSchedule(data, selectedClasses),
    [data, selectedClasses]
  );

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
            appears here instantly — colour-coded, clash-checked, and ready to export.
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
    const currentCell = processedSchedule[today]?.find((cell) => {
      if (cell.isEmpty) return false;
      const { startMin, endMin } = slotMinuteRange(cell.slot);
      return nowMinutes >= startMin && nowMinutes < endMin;
    });
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
        const { startMin } = slotMinuteRange(cell.slot);
        return startMin > nowMinutes;
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
                      {cell.classes.map((classItem, index) => (
                        <div
                          key={index}
                          className="class-box"
                          style={boxStyle(classItem.Course)}
                          title={`${classItem.Course}${
                            classItem.Section !== 'N/A' ? ` (${classItem.Section})` : ''
                          } · ${cleanRoom(classItem.Room)} · ${classItem.Instructor}`}
                        >
                          <span className="class-course">{classItem.Course}</span>
                          <span className="class-meta">{cleanRoom(classItem.Room)}</span>
                          <span className="class-meta">{classItem.Instructor}</span>
                        </div>
                      ))}
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
