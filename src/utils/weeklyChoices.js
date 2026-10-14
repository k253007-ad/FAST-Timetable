export const WEEKLY_CHOICES_KEY = 'weeklyAttendanceChoices';

// Week boundaries follow the campus timezone, including on devices abroad.
export const getWeekKey = (now = Date.now()) => {
  const campus = new Date(Number(now) + 5 * 60 * 60 * 1000);
  campus.setUTCDate(campus.getUTCDate() - (campus.getUTCDay() + 6) % 7);
  return campus.toISOString().slice(0, 10);
};

export const attendanceClassKey = (item) => JSON.stringify([item.Course, item.Section]);
export const clashChoiceKey = (day, cell) => JSON.stringify([
  day, cell.slot, cell.endLabel, cell.classes.map(attendanceClassKey).sort(),
]);

export const readWeeklyChoices = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(WEEKLY_CHOICES_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
};

export const getWeeklyChoices = (profile, now = Date.now(), saved = readWeeklyChoices()) => {
  const entry = saved[profile];
  return entry?.week === getWeekKey(now) && entry.choices && typeof entry.choices === 'object'
    ? entry.choices : {};
};
