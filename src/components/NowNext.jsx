import { useMemo } from 'react';
import { buildSchedule, cleanRoom, formatSlot, slotMinuteRange } from '../utils/schedule.js';

/**
 * "Now" / "Next" status card shown between the class selector and the grid.
 * Scoped to today only — once today's sessions are done it says so rather
 * than reaching into tomorrow (the grid's own now/next cell highlighting
 * still looks across the whole week; this card is a same-day summary).
 */
const NowNext = ({ data, selectedClasses }) => {
  const { processedSchedule } = useMemo(
    () => buildSchedule(data, selectedClasses),
    [data, selectedClasses]
  );

  if (!data?.timetable || selectedClasses.length === 0) return null;

  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long' });
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todaySessions = (processedSchedule[today] || []).filter((cell) => !cell.isEmpty);

  const currentSession = todaySessions.find((cell) => {
    const { startMin, endMin } = slotMinuteRange(cell.slot);
    return nowMinutes >= startMin && nowMinutes < endMin;
  });

  const nextSession = todaySessions.find((cell) => {
    const { startMin } = slotMinuteRange(cell.slot);
    return startMin > nowMinutes;
  });

  const lastSession = todaySessions[todaySessions.length - 1];
  const dayIsOver = lastSession ? nowMinutes >= slotMinuteRange(lastSession.slot).endMin : false;

  const currentEmptyReason =
    todaySessions.length === 0 ? 'No classes today' : dayIsOver ? 'No further classes' : 'No class right now';
  const nextEmptyReason = todaySessions.length === 0 ? 'No classes today' : 'No further classes';

  const sessionDetails = (cell) => {
    const item = cell.classes[0];
    const { start, end } = formatSlot(cell.slot);
    return { course: item.Course, room: cleanRoom(item.Room), instructor: item.Instructor, start, end };
  };

  const renderCol = (label, badgeClass, session, emptyReason) => (
    <div className="nownext-col">
      <span className={`nownext-label ${badgeClass}`}>{label}</span>
      {session ? (
        (() => {
          const { course, room, instructor, start, end } = sessionDetails(session);
          return (
            <div className="nownext-body">
              <span className="nownext-course">{course}</span>
              <span className="nownext-meta">
                {start} – {end} · {room}
              </span>
              <span className="nownext-meta">{instructor}</span>
            </div>
          );
        })()
      ) : (
        <div className="nownext-empty">{emptyReason}</div>
      )}
    </div>
  );

  return (
    <section className="card nownext-card no-print" aria-label="Today's class status">
      {renderCol('Now', 'now', currentSession, currentEmptyReason)}
      <div className="nownext-divider" />
      {renderCol('Next', 'next', nextSession, nextEmptyReason)}
    </section>
  );
};

export default NowNext;
