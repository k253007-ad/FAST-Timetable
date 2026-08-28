import { useMemo } from 'react';
import { buildSchedule, cleanRoom, sessionKey } from '../utils/schedule.js';

/**
 * "Now" / "Next" status card shown between the class selector and the grid.
 * Scoped to today only — once today's sessions are done it says so rather
 * than reaching into tomorrow (the grid's own now/next cell highlighting
 * still looks across the whole week; this card is a same-day summary).
 */
const NowNext = ({ data, selectedClasses, isMainProfile, onClassEnded, manualEndedKey }) => {
  const { processedSchedule } = useMemo(
    () => buildSchedule(data, selectedClasses),
    [data, selectedClasses]
  );

  if (!data?.timetable || selectedClasses.length === 0) return null;

  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long' });
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todaySessions = (processedSchedule[today] || []).filter((cell) => !cell.isEmpty);

  const rawCurrentSession = todaySessions.find(
    (cell) => nowMinutes >= cell.startMin && nowMinutes < cell.endMin
  );
  // A "Class ended" click (this profile only) suppresses the current session
  // immediately rather than waiting for its real scheduled end time.
  const currentSession =
    rawCurrentSession && isMainProfile && manualEndedKey === sessionKey(rawCurrentSession)
      ? null
      : rawCurrentSession;

  const nextSession = todaySessions.find((cell) => cell.startMin > nowMinutes);

  const emptyReason = todaySessions.length === 0 ? 'No classes today' : 'No further classes today';

  const formatCountdown = (mins) => {
    if (mins <= 0) return 'starting now';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const sessionDetails = (cell) => {
    const item = cell.classes[0];
    return {
      course: item.Section !== 'N/A' ? `${item.Course} (${item.Section})` : item.Course,
      room: cleanRoom(item.Room),
      instructor: item.Instructor,
      start: cell.startLabel,
      end: cell.endLabel,
    };
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

  const renderNowCol = () => {
    if (currentSession) {
      const { course, room, instructor, start, end } = sessionDetails(currentSession);
      return (
        <div className="nownext-body">
          <span className="nownext-course">{course}</span>
          <span className="nownext-meta">
            {start} – {end} · {room}
          </span>
          <span className="nownext-meta">{instructor}</span>
          {isMainProfile && onClassEnded && (
            <button
              type="button"
              className="link-button nownext-ended-btn"
              onClick={onClassEnded}
              title="Mark this class as ended early — switches your notifications to the next class"
            >
              End Class
            </button>
          )}
        </div>
      );
    }
    if (nextSession) {
      const minutesUntilNext = Math.max(0, nextSession.startMin - nowMinutes);
      return (
        <div className="nownext-body">
          <span className="nownext-empty">Next class in</span>
          <span className="nownext-countdown">{formatCountdown(minutesUntilNext)}</span>
        </div>
      );
    }
    return <div className="nownext-empty">{emptyReason}</div>;
  };

  return (
    <section className="card nownext-card no-print" aria-label="Today's class status">
      <div className="nownext-col">
        <span className="nownext-label now">Now</span>
        {renderNowCol()}
      </div>
      <div className="nownext-divider" />
      {renderCol('Next', 'next', nextSession, emptyReason)}
    </section>
  );
};

export default NowNext;
