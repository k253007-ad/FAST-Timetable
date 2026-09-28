import assert from 'node:assert/strict';
import { buildSchedule, getClassesForTeacher } from '../src/utils/schedule.js';
import { getWeekInsights, matchesAgendaQuery, formatDuration } from '../src/utils/agenda.js';

const row = (Course, Day, Time, Room = 'AB1 Room 12', Section = 'A') => ({ Course, Day, Time, Room, Section, Instructor: 'Test Teacher' });
const data = { timetable: [
  row('Programming - Lab', 'Monday', '08:00-08:50', 'Lab 1'),
  row('Other', 'Tuesday', '08:50-09:40'),
  row('Other', 'Tuesday', '09:40-10:30'),
  row('Mathematics', 'Monday', '11:00-11:50'),
  row('Mathematics', 'Monday', '11:00-11:50', 'AB2 Room 3'),
  row('Physics', 'Monday', '11:00-11:50'),
] };
const schedule = buildSchedule(data, ['Programming - Lab - A', 'Mathematics - A', 'Physics - A']);
const insights = getWeekInsights(schedule);
assert.equal(insights.sessions, 2, 'Lab slots merge and room duplicates do not inflate sessions');
assert.equal(insights.minutes, 200, 'Clashes count occupied time once');
assert.equal(insights.activeDays, 1);
assert.equal(insights.breakMinutes, 30);
assert.equal(insights.averageMinutes, 200);
assert.equal(insights.busiestDay.day, 'Monday');
assert.equal(insights.days[0].longestBreak, 30);
assert.equal(insights.freeDays.length, 4);
assert.equal(schedule.clashCount, 1);
assert.equal(insights.days[0].cells[1].startMin - insights.days[0].cells[0].endMin, 30);
assert.equal(matchesAgendaQuery(insights.days[0].cells[1], 'physics teacher'), true);
assert.equal(matchesAgendaQuery(insights.days[0].cells[1], 'missing'), false);
assert.equal(matchesAgendaQuery(insights.days[0].cells[1], '  AB1   MATH '), true);
const moved = buildSchedule(data, ['Mathematics - A'], [{ course: 'Mathematics', section: 'A', day: 'Monday', time: '11:00-11:50', newDay: 'Tuesday', newTime: '08:50-09:40' }]);
assert.equal(getWeekInsights(moved).days[1].cells.length, 1, 'Agenda follows schedule overrides');
assert.equal(getWeekInsights(buildSchedule(null, [])).sessions, 0);
assert.equal(formatDuration(90), '1h 30m');
assert.equal(formatDuration(0), '0m');
console.log('Agenda checks passed: lab merging, duplicate rooms, conflicts, gaps, search, overrides, empty state.');
assert.equal(getClassesForTeacher(null, 'Test Teacher'), null);
assert.deepEqual(getClassesForTeacher(data, 'missing'), []);
assert.equal(getClassesForTeacher(data, ' TEST TEACHER ').length, 4, 'Teacher matching is case-insensitive and deduplicates sections');
