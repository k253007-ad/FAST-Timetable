import { useMemo } from 'react';
import { DAY_LABELS, getWeekInsights, formatDuration } from '../utils/agenda.js';

export default function ScheduleOverview({ schedule, onOpenDay, onOpenAgenda }) {
  const insights = useMemo(() => getWeekInsights(schedule), [schedule]);
  const maxMinutes = Math.max(1, ...insights.days.map((day) => day.minutes));
  return (
    <section className="schedule-overview no-print" aria-labelledby="overview-title">
      <div className="overview-intro">
        <span className="eyebrow">WEEKLY SUMMARY</span>
        <h2 id="overview-title">Your week at a glance</h2>
        <p>{insights.sessions ? 'Scheduled time includes your classes and personal activities.' : 'Add classes to see your weekly workload.'}</p>
        <button type="button" className="btn overview-cta" onClick={onOpenAgenda}>Open agenda <span aria-hidden="true">↗</span></button>
        <dl className="insight-facts">
          <div><dt>Scheduled blocks</dt><dd>{insights.sessions}</dd></div>
          <div><dt>Average active day</dt><dd>{formatDuration(insights.averageMinutes)}</dd></div>
          <div><dt>Time between sessions</dt><dd>{formatDuration(insights.breakMinutes)}</dd></div>
          <div><dt>Busiest day</dt><dd>{insights.busiestDay ? `${insights.busiestDay.day} · ${formatDuration(insights.busiestDay.minutes)}` : 'No sessions yet'}</dd></div>
          <div><dt>Free weekdays</dt><dd>{insights.freeDays.map((day) => DAY_LABELS[day]).join(' · ') || 'None'}</dd></div>
        </dl>
      </div>
      <div className="overview-details">
        <div className="overview-stats">
          <div><strong>{schedule.courseCount}</strong><span>Courses</span></div>
          <div><strong>{formatDuration(insights.minutes)}</strong><span>Scheduled / week</span></div>
          <div><strong>{insights.activeDays}<small> / 5</small></strong><span>Active days</span></div>
        </div>
        <div className="week-rhythm" aria-label="Weekly workload; choose a day to view its timetable">
          {insights.days.map(({ day, minutes, cells }) => (
            <button type="button" key={day} onClick={() => onOpenDay(day)} aria-label={`${day}: ${cells.length} sessions, ${formatDuration(minutes)}. View day.`}>
              <span className="rhythm-track"><span style={{ height: `${Math.max(5, minutes / maxMinutes * 100)}%` }} /></span>
              <span>{DAY_LABELS[day]}</span>
              <small>{cells.length ? formatDuration(minutes) : 'Free'}</small>
            </button>
          ))}
        </div>
        <div className={`overview-note${schedule.clashCount ? ' has-clashes' : ''}`}>
          <span aria-hidden="true">{schedule.clashCount ? '!' : '✓'}</span>
          {schedule.clashCount ? `${schedule.clashCount} overlapping time ${schedule.clashCount === 1 ? 'block' : 'blocks'} — review your agenda` : insights.sessions ? 'Looking good. No timetable clashes.' : 'Your weekly overview will appear as you add classes.'}
        </div>
      </div>
    </section>
  );
}
