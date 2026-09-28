import { Fragment, useMemo, useState } from 'react';
import { cleanRoom, DAY_ORDER } from '../utils/schedule.js';
import { DAY_LABELS, formatDuration, getWeekInsights, matchesAgendaQuery } from '../utils/agenda.js';
import { IconSearch, IconClock, IconMapPin, IconUser, IconCheck } from './Icons.jsx';

export default function AgendaView({ schedule, courseColors, now }) {
  const [query, setQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState('all');
  const insights = useMemo(() => getWeekInsights(schedule), [schedule]);
  const date = new Date(now);
  const today = date.toLocaleDateString('en-US', { weekday: 'long' });
  const minute = date.getHours() * 60 + date.getMinutes();
  const [hideFinished, setHideFinished] = useState(false);
  const filterDay = selectedDay;
  const days = insights.days.filter(({ day }) => filterDay === 'all' || filterDay === day)
    .map((day) => ({ ...day, visible: day.cells.filter((cell) => matchesAgendaQuery(cell, query)) }));
  const shownDays = days.map((day) => ({ ...day, visible: day.visible.filter((cell) => !hideFinished || day.day !== today || cell.endMin > minute) }));
  const resultCount = shownDays.reduce((sum, day) => sum + day.visible.length, 0);
  const nextCell = (insights.days.find((day) => day.day === today)?.cells || []).find((cell) => cell.startMin > minute);

  return (
    <section className="card agenda-view no-print" aria-labelledby="agenda-title">
      <div className="agenda-heading">
        <div><span className="eyebrow">ROOM TO PLAN</span><h2 id="agenda-title">Your weekly agenda</h2></div>
        <span className="agenda-count" role="status">{resultCount} {resultCount === 1 ? 'session' : 'sessions'}</span>
      </div>
      {days.some((day) => day.day === today && day.cells.some((cell) => cell.endMin <= minute)) && <label className="hide-finished"><input type="checkbox" checked={hideFinished} onChange={(event) => setHideFinished(event.target.checked)} /> Hide finished sessions today</label>}
      <details className="agenda-search-panel">
        <summary><IconSearch size={16} /> Search & filter{(query.trim() || selectedDay !== 'all') && <span className="agenda-count">Filtered</span>}</summary>
      <div className="agenda-tools">
        <label className="agenda-search"><IconSearch size={18} /><span className="sr-only">Search agenda by course, section, room, or teacher</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a course, room, or teacher…" />
        </label>
        <label className="agenda-day"><span className="sr-only">Filter agenda by day</span>
          <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}><option value="all">All weekdays</option>{DAY_ORDER.map((day) => <option key={day} value={day}>{DAY_LABELS[day]}</option>)}</select>
        </label>
      </div>
      </details>
      {!resultCount && <div className="agenda-empty"><IconCheck size={28} /><h3>{query.trim() ? 'No matching sessions' : hideFinished ? 'All clear for now' : 'A little breathing room'}</h3><p>{query.trim() ? 'Try another course, room, or teacher, or change the day filter.' : hideFinished ? 'Turn off the filter to see finished sessions.' : insights.sessions ? 'Nothing scheduled for this day. Make some time for yourself.' : 'Use Edit to add classes and build your personal agenda.'}</p>{query && <button type="button" className="btn btn-ghost" onClick={() => setQuery('')}>Clear search</button>}</div>}
      {shownDays.filter(({ visible }) => visible.length).map(({ day, visible, cells, minutes }) => (
        <section className="agenda-group" key={day} aria-label={day}>
          <div className="agenda-day-heading"><h3 className="agenda-day-badge" title={day} aria-label={day}>{DAY_LABELS[day]}</h3><span>{day === today ? 'Today · ' : ''}{formatDuration(minutes)} scheduled</span></div>
          <ol className="agenda-list">
            {visible.map((cell) => {
              const index = cells.indexOf(cell);
              const gap = index > 0 ? cell.startMin - cells[index - 1].endMin : 0;
              const status = day !== today ? null : minute >= cell.endMin ? 'Finished' : minute >= cell.startMin ? 'Now' : cell === nextCell ? 'Next' : null;
              return <Fragment key={cell.slot}>
                {!query.trim() && gap >= 15 && (!hideFinished || visible.indexOf(cell) > 0) && <li className="agenda-break"><IconClock size={13} /> {formatDuration(gap)} free <span>Room for a breather</span></li>}
                <li className={`agenda-session${cell.classes.length > 1 ? ' is-clash' : ''}${status === 'Now' ? ' agenda-now' : ''}`}>
                  <div className="agenda-time"><strong>{cell.startLabel}</strong><span>{cell.endLabel}</span><small>{formatDuration(cell.endMin - cell.startMin)}</small></div>
                  <div className="agenda-session-body">
                    {status && <span className={`agenda-live-status status-${status.toLowerCase()}`}>{status === 'Finished' && <IconCheck size={12} />}{status}{status === 'Next' ? ` · in ${formatDuration(cell.startMin - minute)}` : status === 'Now' ? ` · ${formatDuration(cell.endMin - minute)} left` : ''}</span>}
                    {cell.classes.length > 1 && <span className="agenda-clash">Overlapping classes</span>}
                    {cell.classes.map((item) => <div className="agenda-course" key={`${item.Course}|${item.Section}`} style={{ '--course-color': courseColors[item.Course] || 'var(--accent)' }}>
                      <h4>{item.Course}</h4>
                      <div className="agenda-meta">{item.isActivity ? <span>Personal activity</span> : <><span><IconMapPin size={13} />{cleanRoom(item.Room)}</span>{item.Section && item.Section !== 'N/A' && <span>Section {item.Section}</span>}{item.Instructor && item.Instructor !== 'N/A' && <span><IconUser size={13} />{item.Instructor}</span>}</>}{item.isExtra && <span>Extra class</span>}</div>
                    </div>)}
                  </div>
                </li>
              </Fragment>;
            })}
          </ol>
        </section>
      ))}
    </section>
  );
}
