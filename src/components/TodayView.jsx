import { useEffect, useMemo, useRef } from 'react';
import { abbreviateCourse, DAY_ORDER, cleanRoom, formatSlot, getBuildingLabel, sessionKey, toMinutes } from '../utils/schedule.js';
import { IconClock, IconMapPin, IconUser, IconAlert } from './Icons.jsx';
import { withAlpha } from '../utils/courseColors.js';
import { attendanceClassKey } from '../utils/weeklyChoices.js';

// Today view, 2nd rework (2026-09-28): a calendar-style day view.
// Top: Now / Next cards. Below: a time-scaled timeline where each
// class block's height matches its real length, breaks are real empty space
// (labelled with length, walk hints and empty rooms), plus a live "now" line.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PX_PER_MIN = 1.25;

// Karachi is fixed UTC+5 — use it regardless of the device's own timezone.
const karachi = (now) => {
  const d = new Date(now + 5 * 3600 * 1000);
  return {
    day: WEEKDAYS[d.getUTCDay()],
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dateLabel: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  };
};

const fmtDuration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const fmtClock = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}`;
};

const buildingOf = (room) => {
  const building = getBuildingLabel(room);
  return building === 'Other' ? null : building;
};

const mainItem = (cell) => cell.classes.find((c) => attendanceClassKey(c) === cell.attendanceChoice)
  || cell.classes.find((c) => !c.isActivity) || cell.classes[0];

export default function TodayView({ schedule, data, day, courseColors, now, onClassEnded, manualEndedKey, shortCourseNames = false, onChooseAttendance }) {
  const viewRef = useRef(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const fitNames = () => {
      view.querySelectorAll('.tv2-course-name').forEach((name) => {
        name.classList.remove('use-short-name');
        const full = name.querySelector('.tv2-full-name');
        const card = name.closest('.tv2-event');
        if (full.scrollHeight > full.clientHeight + 1 || full.scrollWidth > full.clientWidth + 1 ||
            card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1) {
          name.classList.add('use-short-name');
        }
      });
    };
    fitNames();
    const observer = new ResizeObserver(fitNames);
    view.querySelectorAll('.tv2-event').forEach((event) => observer.observe(event));
    return () => observer.disconnect();
  }, [schedule, day, shortCourseNames]);
  const live = karachi(now);
  const isToday = day === live.day;
  const minute = live.minutes;
  const cells = useMemo(() => (schedule.processedSchedule[day] || []).filter((c) => !c.isEmpty), [schedule, day]);

  // Rooms busy per slot on this day — for "empty rooms during your break".
  const { allRooms, busyBySlot } = useMemo(() => {
    const rows = [...(data?.timetable || []), ...(data?.roomBookings || [])];
    const busy = new Map();
    rows.forEach((r) => {
      if (r.Day !== day) return;
      if (!busy.has(r.Time)) busy.set(r.Time, new Set());
      busy.get(r.Time).add(r.Room);
    });
    return { allRooms: [...new Set(rows.map((r) => r.Room).filter(Boolean))], busyBySlot: busy };
  }, [data, day]);

  const freeRoomsBetween = (startMin, endMin, building) => {
    const gapSlots = (schedule.timeSlots || []).filter((s) => {
      const { start, end } = formatSlot(s);
      return toMinutes(start) >= startMin && toMinutes(end) <= endMin;
    });
    if (!gapSlots.length || !building) return 0;
    return allRooms.filter(
      (room) => buildingOf(cleanRoom(room)) === building && !/lab/i.test(room) && gapSlots.every((s) => !busyBySlot.get(s)?.has(room))
    ).length;
  };


  const isEnded = (c) => sessionKey({ ...c, classes: [mainItem(c)] }) === manualEndedKey;
  const current = isToday ? cells.find((c) => minute >= c.startMin && minute < c.endMin && !isEnded(c)) : null;
  const next = isToday ? cells.find((c) => c.startMin > minute) : null;
  const doneCount = isToday ? cells.filter((c) => c.endMin <= minute).length : 0;

  const nextDay = (() => {
    const idx = DAY_ORDER.indexOf(day);
    for (let k = 1; k <= DAY_ORDER.length; k++) {
      const d = DAY_ORDER[(idx + k) % DAY_ORDER.length];
      const list = (schedule.processedSchedule[d] || []).filter((c) => !c.isEmpty);
      if (list.length) return { day: d, cell: list[0] };
    }
    return null;
  })();

  // ---------- Top cards ----------
  const nowCard = (() => {
    if (!isToday) return { label: day, title: `${cells.length} session${cells.length === 1 ? '' : 's'}`, meta: 'Not today — showing the plan' };
    if (current) {
      const it = mainItem(current);
      return {
        tone: 'live', label: 'Now', title: it.isActivity || !shortCourseNames ? it.Course : abbreviateCourse(it.Course),
        meta: `${it.isActivity ? 'Activity' : cleanRoom(it.Room)} · ${fmtDuration(current.endMin - minute)} left`,
        progress: (minute - current.startMin) / (current.endMin - current.startMin),
      };
    }
    if (!cells.length) return { label: 'Now', title: 'Free day', meta: 'No classes today' };
    if (next) return { label: 'Now', title: `Next class in ${fmtDuration(next.startMin - minute)}`, meta: `${doneCount ? 'On a break · ' : ''}starts at ${next.startLabel}` };
    return { tone: 'done', label: 'Now', title: 'Done for today', meta: `${cells.length} of ${cells.length} finished` };
  })();

  const nextCard = (() => {
    const target = isToday ? next : cells[0];
    if (target) {
      const it = mainItem(target);
      return {
        label: isToday ? 'Next' : 'First class',
        title: it.isActivity || !shortCourseNames ? it.Course : abbreviateCourse(it.Course),
        meta: `${target.startLabel} · ${it.isActivity ? 'Activity' : cleanRoom(it.Room)}`,
      };
    }
    if (nextDay && nextDay.day !== day) {
      const it = mainItem(nextDay.cell);
      return { label: `Next · ${nextDay.day}`, title: it.isActivity || !shortCourseNames ? it.Course : abbreviateCourse(it.Course), meta: `${nextDay.cell.startLabel} · ${it.isActivity ? 'Activity' : cleanRoom(it.Room)}` };
    }
    return { label: 'Next', title: 'Nothing scheduled', meta: '' };
  })();

  // ---------- Timeline geometry ----------
  const dayStart = cells.length ? Math.floor(cells[0].startMin / 60) * 60 : 0;
  const dayEnd = cells.length ? Math.ceil(cells[cells.length - 1].endMin / 60) * 60 : 0;
  const y = (m) => (m - dayStart) * PX_PER_MIN;
  const hours = [];
  for (let m = dayStart; m <= dayEnd; m += 60) hours.push(m);
  const showNowLine = isToday && minute >= dayStart && minute <= dayEnd;

  const renderCard = (c) => (
    <div className={`tv2-card${c.tone ? ` is-${c.tone}` : ''}`}>
      <span className="tv2-card-label">{c.label}</span>
      <strong>{c.title}</strong>
      {c.meta && <span className="tv2-card-meta">{c.meta}</span>}
      {c.progress != null && <div className="tv2-progress"><span style={{ width: `${Math.min(100, c.progress * 100)}%` }} /></div>}
    </div>
  );

  return (
    <section ref={viewRef} className="card tv2 no-print" aria-label={`${day} day view`}>
      <header className="tv2-head">
        <h2>{isToday ? 'Today' : day}</h2>
        <span>{isToday ? live.dateLabel : 'Planned day'}</span>
      </header>

      <div className="tv2-cards">
        {renderCard(nowCard)}
        {renderCard(nextCard)}
      </div>

      {isToday && current && onClassEnded && (
        <button type="button" className="link-button tv2-end" onClick={onClassEnded}>Class ended early? Tap to skip ahead</button>
      )}

      {cells.length > 0 && (
        <div className="tv2-timeline" style={{ height: y(dayEnd) + 8 }}>
          {hours.map((m) => (
            <div key={m} className="tv2-hour" style={{ top: y(m) }}>
              <span>{fmtClock(m)}</span>
            </div>
          ))}

          {cells.map((cell, i) => {
            const prev = cells[i - 1];
            const gap = prev ? cell.startMin - prev.endMin : 0;
            const prevB = prev ? buildingOf(cleanRoom(mainItem(prev).Room)) : null;
            const curB = buildingOf(cleanRoom(mainItem(cell).Room));
            const walk = prev && prevB && curB && prevB !== curB && !mainItem(cell).isActivity;
            const free = gap >= 45 ? freeRoomsBetween(prev.endMin, cell.startMin, prevB || curB) : 0;
            return (
              prev && gap > 5 && (
                <div key={`gap-${cell.slot}`} className="tv2-gap" style={{ top: y(prev.endMin), height: y(cell.startMin) - y(prev.endMin) }}>
                  <span><IconClock size={12} /> {fmtDuration(gap)} break</span>
                  {walk && gap >= 20 && <span><IconMapPin size={12} /> walk {prevB} → {curB}</span>}
                  {free > 0 && gap >= 60 && <span>{free} empty room{free === 1 ? '' : 's'} in {prevB || curB}</span>}
                </div>
              )
            );
          })}

          {cells.map((cell) => {
            const past = isToday && cell.endMin <= minute;
            const isNow = cell === current;
            const isNext = isToday && cell === next;
            const height = y(cell.endMin) - y(cell.startMin);
            return (
              <div
                key={cell.slot}
                className={`tv2-block${past ? ' is-past' : ''}${isNow ? ' is-now' : ''}${isNext ? ' is-next' : ''}${cell.classes.length > 1 ? ' is-clash' : ''}`}
                style={{ top: y(cell.startMin), height }}
              >
                {cell.classes.map((item) => {
                  const color = courseColors[item.Course] || '#64748b';
                  const selected = cell.attendanceChoice === attendanceClassKey(item);
                  const chosen = cell.classes.some((candidate) => attendanceClassKey(candidate) === cell.attendanceChoice);
                  const choose = () => onChooseAttendance?.(cell.clashChoiceKey, attendanceClassKey(item));
                  return (
                    <div
                      key={`${item.Course}|${item.Section}`}
                      className={`tv2-event${selected ? ' is-attending' : chosen ? ' is-alternative' : ''}`}
                      style={{ flex: chosen ? selected ? '3 1 0' : '1 1 0' : '1 1 0', borderLeftColor: color, background: `linear-gradient(${withAlpha(color, 0.16)}, ${withAlpha(color, 0.16)}), var(--surface)` }}
                      role={cell.clashChoiceKey ? 'button' : undefined}
                      tabIndex={cell.clashChoiceKey ? 0 : undefined}
                      aria-pressed={cell.clashChoiceKey ? selected : undefined}
                      aria-label={cell.clashChoiceKey ? `Attend ${item.Course} (${item.Section}) this week` : undefined}
                      onClick={cell.clashChoiceKey ? choose : undefined}
                      onKeyDown={cell.clashChoiceKey ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
                      } : undefined}
                    >
                      {cell.clashChoiceKey && !selected && <span className="attendance-hint">Tap to attend</span>}
                      <div className="tv2-event-top">
                        <strong>
                          {isNow && <span className="tv2-flag now">Now</span>}
                          {isNext && <span className="tv2-flag next">Next</span>}
                          {item.isActivity || shortCourseNames ? (item.isActivity ? item.Course : abbreviateCourse(item.Course)) : (
                            <span className="tv2-course-name" title={item.Course}>
                              <span className="tv2-full-name">{item.Course}</span>
                              <span className="tv2-short-name">{abbreviateCourse(item.Course)}</span>
                            </span>
                          )}
                        </strong>
                        <span className="tv2-event-time">{cell.startLabel}–{cell.endLabel}</span>
                      </div>
                      {item.isActivity ? (
                        <span className="tv2-event-meta">Personal activity</span>
                      ) : (
                        <span className="tv2-event-meta">
                          <span><IconMapPin size={12} /><b>{cleanRoom(item.Room)}</b></span>
                          {height >= 62 && item.Section && item.Section !== 'N/A' && <span>{item.Section}</span>}
                          {height >= 62 && item.Instructor && <span><IconUser size={12} />{item.Instructor}</span>}
                          {item.isExtra && <span className="tv2-tag">Extra</span>}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {showNowLine && (
            <div className="tv2-now" style={{ top: y(minute) }} aria-label="Current time">
              <span>{fmtClock(minute)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
