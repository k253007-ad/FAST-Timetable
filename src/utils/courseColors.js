// Course colour assignment.
//
// Colours are assigned per course (not per section) from a curated palette.
// Assignment is deterministic — a course hashes to the same palette slot
// regardless of selection order, with linear probing to resolve collisions
// inside the current selection.

export const COURSE_PALETTE = [
  '#4f6bd8', // indigo
  '#0d9488', // teal
  '#d97706', // amber
  '#dc4854', // rose
  '#7c5cd6', // violet
  '#16a34a', // green
  '#d3479b', // pink
  '#0e8db2', // cyan
  '#8d6e63', // taupe
  '#64748b', // slate
];

const hashString = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
};

/**
 * Splits a stored class value ("Course - Section") into its parts.
 * The separator is the LAST " - " so course names containing hyphens survive.
 * A section of "N/A" is treated as "no section".
 */
export const splitClassValue = (value) => {
  const idx = value.lastIndexOf(' - ');
  if (idx === -1) return { course: value, section: '' };
  const section = value.slice(idx + 3);
  return {
    course: value.slice(0, idx),
    section: section === 'N/A' ? '' : section,
  };
};

/** Human-friendly label for a stored class value. */
export const formatClassLabel = (value) => {
  const { course, section } = splitClassValue(value);
  return section ? `${course} (${section})` : course;
};

/**
 * Maps every course in the selection to a palette colour.
 * @param {string[]} selectedClasses stored "Course - Section" values
 * @returns {Object<string, string>} course → hex colour
 */
export const assignCourseColors = (selectedClasses) => {
  const courses = [...new Set(selectedClasses.map((v) => splitClassValue(v).course))].sort();
  const used = new Set();
  const map = {};

  for (const course of courses) {
    let idx = hashString(course) % COURSE_PALETTE.length;
    let steps = 0;
    while (used.has(idx) && steps < COURSE_PALETTE.length) {
      idx = (idx + 1) % COURSE_PALETTE.length;
      steps++;
    }
    used.add(idx);
    map[course] = COURSE_PALETTE[idx];
  }
  return map;
};

/** "#rrggbb" → "rgba(r, g, b, a)" */
export const withAlpha = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
