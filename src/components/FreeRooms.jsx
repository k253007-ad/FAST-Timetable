import { useMemo, useState } from 'react';
import { DAY_ORDER, cleanRoom, formatSlot, getAllTimeSlots, toMinutes } from '../utils/schedule.js';
import { IconMapPin } from './Icons.jsx';

// Karachi is a fixed UTC+5 (no DST) — same convention as the rest of the app.
const karachiNow = (now) => {
  const d = new Date(now + 5 * 3600 * 1000);
  return { day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()], minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

const slotRange = (slot) => {
  const { start, end } = formatSlot(slot);
  return { start: toMinutes(start), end: toMinutes(end) };
};

// Default to the slot in progress now, else the next one today, else the
// first slot of the next teaching day.
const pickDefault = (slots, now) => {
  const { day, minutes } = karachiNow(now);
  if (DAY_ORDER.includes(day)) {
    const current = slots.find((s) => { const r = slotRange(s); return minutes >= r.start && minutes < r.end; });
    if (current) return { day, slot: current };
    const next = slots.find((s) => slotRange(s).start > minutes);
    if (next) return { day, slot: next };
  }
  const idx = DAY_ORDER.indexOf(day);
  return { day: DAY_ORDER[(idx + 1) % DAY_ORDER.length] || 'Monday', slot: slots[0] };
};

const groupOf = (room) => {
  const raw = (room.match(/\bAB\s?(\d|I{1,3})\b/i) || [])[1];
  const block = raw && ({ I: '1', II: '2', III: '3' }[raw.toUpperCase()] || raw);
  const building = block ? `Academic Block ${block}` : 'Other';
  return { building, isLab: /lab/i.test(room) };
};

const FreeRooms = ({ data, now }) => {
  const slots = useMemo(() => getAllTimeSlots(data), [data]);
  const [initial] = useState(() => pickDefault(slots, now));
  const [day, setDay] = useState(initial.day);
  const [picked, setSlot] = useState(initial.slot);
  const slot = slots.includes(picked) ? picked : slots[0];
  const [labsOnly, setLabsOnly] = useState(false);

  const { groups, total } = useMemo(() => {
    const rows = data?.timetable || [];
    const all = new Set(rows.map((r) => r.Room).filter(Boolean));
    const busy = new Set(rows.filter((r) => r.Day === day && r.Time === slot).map((r) => r.Room));
    const free = [...all].filter((r) => !busy.has(r) && (!labsOnly || /lab/i.test(r)));
    const byBuilding = new Map();
    free.forEach((room) => {
      const { building } = groupOf(cleanRoom(room));
      if (!byBuilding.has(building)) byBuilding.set(building, []);
      byBuilding.get(building).push(cleanRoom(room));
    });
    const sorted = [...byBuilding.entries()]
      .sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
      .map(([building, rooms]) => [building, [...new Set(rooms)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]);
    return { groups: sorted, total: sorted.reduce((n, [, r]) => n + r.length, 0) };
  }, [data, day, slot, labsOnly]);

  const live = karachiNow(now);
  const isNow = day === live.day && slot && (() => { const r = slotRange(slot); return live.minutes >= r.start && live.minutes < r.end; })();
  const { start, end } = slot ? formatSlot(slot) : { start: '', end: '' };

  return (
    <section className="card free-rooms no-print" aria-label="Free rooms">
      <div className="free-rooms-head">
        <div>
          <h2>Free rooms</h2>
          <p>{total} room{total === 1 ? '' : 's'} free · {day} {start}–{end}{isNow ? ' · right now' : ''}</p>
        </div>
        <label className="free-rooms-toggle"><input type="checkbox" checked={labsOnly} onChange={(e) => setLabsOnly(e.target.checked)} /> Labs only</label>
      </div>

      <div className="free-rooms-controls">
        <div className="day-picker" role="tablist" aria-label="Day">
          {DAY_ORDER.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={day === d} className={`day-tab${day === d ? ' is-active' : ''}`} onClick={() => setDay(d)}>
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="free-rooms-slots" role="tablist" aria-label="Time slot">
          {slots.map((s, i) => (
            <button key={s} type="button" role="tab" aria-selected={slot === s} className={`free-slot${slot === s ? ' is-active' : ''}`} onClick={() => setSlot(s)}>
              <span>Slot {i + 1}</span>{formatSlot(s).start}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="free-rooms-empty">No free rooms found for this slot.</p>
      ) : (
        groups.map(([building, rooms]) => (
          <div key={building} className="free-rooms-group">
            <h3>{building} <span>{rooms.length}</span></h3>
            <ul>
              {rooms.map((r) => (
                <li key={r} className={/lab/i.test(r) ? 'is-lab' : undefined}><IconMapPin size={13} />{r}</li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="free-rooms-note">Based on the official timetable — a room with no scheduled class may still be locked or booked.</p>
    </section>
  );
};

export default FreeRooms;
