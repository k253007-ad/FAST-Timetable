import { Fragment, useMemo } from 'react';
import { splitClassValue, withAlpha } from '../utils/courseColors.js';
import { IconAlert, IconCalendar } from './Icons.jsx';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Sheet times have no AM/PM marker; anything before 7 is an afternoon class.
const toMinutes = (timeStr) => {
  if (!timeStr || !timeStr.includes(':')) return 0;
  let [hours, minutes] = timeStr.split(':').map(Number);
  if (hours < 7) hours += 12;
  return hours * 60 + (minutes || 0);
};

// Slot strings in the sheet are inconsistent ("09:50:-10:40", "1:30-2:20");
// extract the two clock times for tidy display while keeping the raw string as key.
const formatSlot = (slot) => {
  const times = slot.match(/\d{1,2}:\d{2}/g) || [];
  return { start: times[0] || slot, end: times[1] || '' };
};

const cleanRoom = (room) =>
  (room || 'N/A')
    .replace(/Academic Block/gi, 'AB')
    .replace(/\s*\(\d+\)\s*$/, '') // strip trailing seating capacity, e.g. "(50)"
    .trim();

const sameClass = (a, b) =>
  a.Course === b.Course && a.Section === b.Section && a.Instructor === b.Instructor;

const TimetableGrid = ({ data, selectedClasses, courseColors, isDark }) => {
  const { days, timeSlots, processedSchedule, sessionCount, courseCount, clashCount } =
    useMemo(() => {
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
            processedSchedule[day].push({ slot, colSpan, classes: cellClasses, isEmpty: false });
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
    }, [data, selectedClasses]);

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

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
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
                {processedSchedule[day].map((cell) =>
                  cell.isEmpty ? (
                    <div
                      key={cell.slot}
                      className={`tt-cell tt-body is-empty${rowMod}`}
                      style={{ gridColumn: `span ${cell.colSpan}` }}
                    />
                  ) : (
                    <div
                      key={cell.slot}
                      className={`tt-cell tt-body${cell.classes.length > 1 ? ' is-clash' : ''}${rowMod}`}
                      style={{ gridColumn: `span ${cell.colSpan}` }}
                    >
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
                  )
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TimetableGrid;
