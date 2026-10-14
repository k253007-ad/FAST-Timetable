import { Fragment, useEffect, useRef } from 'react';
import { abbreviateCourse, cleanRoom, formatSlot, getBuildingLabel } from '../utils/schedule.js';

const classroom = (item) => item.isActivity ? '-' : cleanRoom(item.Room)
  .replace(/^AB\s*\d+\s*-?\s*/i, '').replace(/^([A-Za-z]+)\s*(\d+)$/, '$1-$2') || '-';
const block = (item) => {
  const label = getBuildingLabel(item.Room);
  return item.isActivity || label === 'Other' ? '-' : label.slice(2);
};
const fields = [
  { label: 'Subject', value: (item) => item.isActivity ? item.Course : abbreviateCourse(item.Course).replace(/-Lab$/, ' Lab') },
  { label: 'Classroom', value: classroom },
  { label: 'Block', value: block },
];

export default function GreenTimetable({ schedule, now }) {
  const frameRef = useRef(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      if (frame.clientWidth > 0) frame.style.setProperty('--pak-scale', String(frame.clientWidth / 2200));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [schedule.timeSlots.length]);
  const { days, timeSlots, processedSchedule } = schedule;
  if (!timeSlots.length) return null;
  const date = new Date(now).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  return <section className="pak-timetable" aria-label="Green weekly timetable">
    <div ref={frameRef} className="pak-timetable-scroll">
      <table className="pak-grid">
        <caption className="sr-only">Weekly timetable: subject, classroom, and academic block</caption>
        <thead>
          <tr className="pak-slots"><th scope="row">Slots</th>{timeSlots.map((slot, i) => <th scope="col" key={slot}>{i + 1}</th>)}</tr>
          <tr className="pak-times"><th scope="row">TIME</th>{timeSlots.map((slot) => {
            const { start, end } = formatSlot(slot);
            return <th scope="col" key={slot}>{start}{end && `–${end}`}</th>;
          })}</tr>
        </thead>
        <tbody>
          {days.map((day) => <Fragment key={day}>
            <tr className="pak-day"><th colSpan={timeSlots.length + 1} scope="rowgroup"><span>{day.toUpperCase()}</span></th></tr>
            {fields.map((field) => <tr key={field.label} className="pak-detail-row">
              <th scope="row">{field.label}</th>
              {(processedSchedule[day] || []).map((cell, index, cells) => <td key={cell.slot} colSpan={cell.colSpan}
                style={{ '--pak-class-count': Math.max(1, cell.classes.length) }}
                className={`${cell.isEmpty ? 'pak-empty' : 'pak-class'}${cell.classes.length > 1 ? ' pak-clash' : ''}${!cell.isEmpty && index > 0 && !cells[index - 1].isEmpty ? ' pak-class-divider' : ''}`}>
                {cell.isEmpty ? '---' : cell.classes.map((item) => <span key={`${item.Course}|${item.Section}`}
                  className={item.isExtra ? 'pak-extra' : undefined}
                  title={`${item.Course}${item.Section !== 'N/A' ? ` (${item.Section})` : ''} · ${item.Instructor || ''}`}>
                  {field.value(item)}
                </span>)}
              </td>)}
            </tr>)}
          </Fragment>)}
        </tbody>
        <tfoot><tr><td colSpan={timeSlots.length + 1}><span>{date}</span></td></tr></tfoot>
      </table>
    </div>
  </section>;
}
