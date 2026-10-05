import { useMemo } from 'react';
import { getWeekInsights, formatDuration } from '../utils/agenda.js';

// Insights (reworked 2026-09-29): a plain weekly report — key numbers,
// a per-day table (click a row to open that day), and short highlights.
const fmtClock = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}`;

export default function ScheduleOverview({ schedule, onOpenDay }) {
  const insights = useMemo(() => getWeekInsights(schedule), [schedule]);
  const active = insights.days.filter((d) => d.cells.length);
  const earliest = active.length ? active.reduce((a, b) => (a.cells[0].startMin <= b.cells[0].startMin ? a : b)) : null;
  const latest = active.length ? active.reduce((a, b) => (a.cells.at(-1).endMin >= b.cells.at(-1).endMin ? a : b)) : null;
  const lightest = active.length ? active.reduce((a, b) => (a.minutes <= b.minutes ? a : b)) : null;
  const clashes = schedule.clashCount || 0;

  if (!insights.sessions) {
    return <p className="ins-empty">Add your classes to see your weekly report.</p>;
  }

  return (
    <div className="ins">
      <div className="ins-kpis">
        <div><strong>{schedule.courseCount}</strong><span>Courses</span></div>
        <div><strong>{formatDuration(insights.minutes)}</strong><span>In class / week</span></div>
        <div><strong>{insights.activeDays}<small>/5</small></strong><span>Days on campus</span></div>
        <div className={clashes ? 'is-bad' : 'is-good'}><strong>{clashes}</strong><span>{clashes === 1 ? 'Time clash' : 'Time clashes'}</span></div>
      </div>

      <h3 className="ins-title">Day by day</h3>
      <table className="ins-table">
        <thead>
          <tr><th>Day</th><th>Classes</th><th>On campus</th><th>In class</th><th>Longest break</th></tr>
        </thead>
        <tbody>
          {insights.days.map((d) => (
            <tr key={d.day} className={d.cells.length ? undefined : 'is-free'} onClick={() => onOpenDay(d.day)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpenDay(d.day); }} title={`Open ${d.day}`}>
              <th scope="row">{d.day}</th>
              {d.cells.length ? (
                <>
                  <td>{d.cells.length}</td>
                  <td>{fmtClock(d.cells[0].startMin)} – {fmtClock(d.cells.at(-1).endMin)}</td>
                  <td>
                    <span className="ins-bar"><span style={{ width: `${Math.round((d.minutes / Math.max(...insights.days.map((x) => x.minutes))) * 100)}%` }} /></span>
                    {formatDuration(d.minutes)}
                  </td>
                  <td>{d.longestBreak > 5 ? formatDuration(d.longestBreak) : '—'}</td>
                </>
              ) : (
                <td colSpan={4} className="ins-free">No classes</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="ins-title">Highlights</h3>
      <ul className="ins-highlights">
        {insights.busiestDay && <li><span>Busiest day</span><strong>{insights.busiestDay.day} · {formatDuration(insights.busiestDay.minutes)}</strong></li>}
        {lightest && active.length > 1 && <li><span>Lightest day</span><strong>{lightest.day} · {formatDuration(lightest.minutes)}</strong></li>}
        {earliest && <li><span>Earliest start</span><strong>{earliest.day} · {fmtClock(earliest.cells[0].startMin)}</strong></li>}
        {latest && <li><span>Latest finish</span><strong>{latest.day} · {fmtClock(latest.cells.at(-1).endMin)}</strong></li>}
        <li><span>Total break time</span><strong>{formatDuration(insights.breakMinutes)} / week</strong></li>
        <li><span>Free weekdays</span><strong>{insights.freeDays.join(', ') || 'None'}</strong></li>
      </ul>
    </div>
  );
}
