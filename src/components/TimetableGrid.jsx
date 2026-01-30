import React from 'react';
import '../index.css'; // Import the global styles

const TimetableGrid = ({ data, selectedClasses }) => {
  if (!data || !data.timetable) {
    return null;
  }

  if (selectedClasses.length === 0) {
    return (
      <div className="timetable-message">
        <h3>Welcome to your Timetable</h3>
        <p>Select one or more classes from the list on the left to display them on the grid.</p>
      </div>
    );
  }

  const allDays = [...new Set(data.timetable.map(item => item.Day))];
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const days = allDays.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

  const allTimes = [...new Set(data.timetable.map(item => item.Time))];
  const timeSlots = allTimes.sort((a, b) => {
    try {
      const toMinutes = (timeStr) => {
        if (!timeStr || !timeStr.includes(':')) return 0;
        let [hours, minutes] = timeStr.split(':').map(Number);
        if (hours < 7) { 
          hours += 12;
        }
        return hours * 60 + (minutes || 0);
      };
      return toMinutes(a.split('-')[0]) - toMinutes(b.split('-')[0]);
    } catch (e) {
      console.error("Could not parse time for sorting:", a, b, e);
      return 0;
    }
  });

  const filteredData = data.timetable.filter(item => 
    selectedClasses.includes(`${item.Course} - ${item.Section}`)
  );

  const schedule = {};
  days.forEach(day => {
    schedule[day] = {};
    timeSlots.forEach(slot => {
      schedule[day][slot] = [];
    });
  });

  filteredData.forEach(item => {
    if (schedule[item.Day] && schedule[item.Day][item.Time]) {
      schedule[item.Day][item.Time].push(item);
    }
  });

  // Re-introduce courseColors logic
  const courseColors = {};
  const colors = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];
  let colorIndex = 0;
  selectedClasses.forEach(className => {
    const courseName = className.split(' - ')[0];
    if (!courseColors[courseName]) {
      courseColors[courseName] = colors[colorIndex % colors.length];
      colorIndex++;
    }
  });

  // Process schedule to handle colSpan
  const processedSchedule = {};
  days.forEach(day => {
    processedSchedule[day] = [];
    let i = 0;
    while (i < timeSlots.length) {
      const slot = timeSlots[i];
      const classesInSlot = schedule[day][slot];
      
      if (classesInSlot.length > 0) {
        const classItem = classesInSlot[0];
        let colSpan = 1;

        if (classItem.Course.toLowerCase().includes('lab')) {
          colSpan = 3;
        } else {
          for (let j = i + 1; j < timeSlots.length; j++) {
            const nextSlot = timeSlots[j];
            const nextClasses = schedule[day][nextSlot];
            if (nextClasses.length > 0 && 
                nextClasses[0].Course === classItem.Course &&
                nextClasses[0].Section === classItem.Section &&
                nextClasses[0].Instructor === classItem.Instructor) {
              colSpan++;
            } else {
              break;
            }
          }
        }

        if (i + colSpan > timeSlots.length) {
          colSpan = timeSlots.length - i;
        }

        processedSchedule[day].push({
          slot,
          colSpan,
          classes: classesInSlot,
          isEmpty: false,
        });
        i += colSpan;
      } else {
        processedSchedule[day].push({
          slot,
          colSpan: 1,
          classes: [],
          isEmpty: true,
        });
        i++;
      }
    }
  });

  const totalGridColumns = timeSlots.length + 1; // 1 for the day column + time slots

  return (
    <div className="timetable-grid-container">
      <div className="timetable-table" style={{ gridTemplateColumns: `120px repeat(${timeSlots.length}, 1fr)` }}>
        {/* Header */}
        <div className="timetable-row timetable-header-row">
          <div className="timetable-cell timetable-header-cell timetable-day-header" style={{ gridColumn: 'span 1' }}>Slots</div>
          {timeSlots.map((slot, index) => (
            <div key={`slot-num-${index}`} className="timetable-cell timetable-header-cell timetable-slot-num" style={{ gridColumn: 'span 1' }}>{index + 1}</div>
          ))}
        </div>
        <div className="timetable-row timetable-header-row">
          <div className="timetable-cell timetable-header-cell timetable-day-header" style={{ gridColumn: 'span 1' }}>Time</div>
          {timeSlots.map((slot, index) => (
            <div key={`time-${index}`} className="timetable-cell timetable-header-cell timetable-slot-time" style={{ gridColumn: 'span 1' }}>{slot}</div>
          ))}
        </div>

        {/* Table Body */}
        {days.map(day => (
          <React.Fragment key={day}>
            <div className="timetable-row timetable-day-separator">
              <div className="timetable-cell" style={{ gridColumn: '1 / -1' }}>{day}</div>
            </div>
            <div className="timetable-row timetable-body-row">
              <div className="timetable-cell timetable-day-column-header" style={{ gridColumn: 'span 1' }}>
                <span className="timetable-label">Subject</span>
                <span className="timetable-label">Classroom</span>
                <span className="timetable-label">Teacher</span>
              </div>
              {processedSchedule[day].map(cellInfo => (
                <div 
                  key={cellInfo.slot} 
                  className={`timetable-cell timetable-class-cell ${cellInfo.isEmpty ? 'empty' : ''}`} 
                  style={{ 
                    gridColumn: `span ${cellInfo.colSpan}`,
                    backgroundColor: cellInfo.isEmpty ? '#f5f5f5' : courseColors[cellInfo.classes[0]?.Course],
                    color: cellInfo.isEmpty ? '#333' : '#fff', // White text for class boxes
                  }}
                >
                  {!cellInfo.isEmpty && cellInfo.classes.map((classItem, index) => (
                    <div key={index} className="timetable-class-box">
                      <div className="timetable-class-course">{classItem.Course}</div>
                      <div className="timetable-class-room">{classItem.Room.replace('Academic Block', 'AB')}</div>
                      <div className="timetable-class-instructor">{classItem.Instructor}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default TimetableGrid;
