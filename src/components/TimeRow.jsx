import React from 'react';

const TimeRow = ({ timeSlots }) => {
  if (!timeSlots || timeSlots.length === 0) {
    return null;
  }

  return (
    <React.Fragment>
      <div className="timetable-cell timetable-header-cell timetable-day-header" style={{ gridColumn: 'span 1' }}>Time</div>
      {timeSlots.map((slot, index) => (
        <div key={`time-${index}`} className="timetable-cell timetable-header-cell timetable-slot-time" style={{ gridColumn: 'span 1' }}>
          {slot}
        </div>
      ))}
    </React.Fragment>
  );
};

export default TimeRow;
