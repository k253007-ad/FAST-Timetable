# FAST Timetable

An independent, student-built web app that turns FAST-NUCES Karachi's official timetable
data into a personal, searchable, notification-aware weekly schedule.

*Unofficial and not affiliated with FAST-NUCES. Built by Adnan (25K-3007) for FAST Karachi
students.*

---

## Overview

FAST Timetable reads the same official university timetable data every student already has
access to, and presents it the way a student actually needs it: as *their* week, not a
university-wide grid of every room and every section.

## Features

### Three ways to build a schedule

| Mode | What it does |
|---|---|
| **Manual** | Search and select individual course sections directly (e.g. `cs2005 3a`). |
| **Roll No** | Enter a roll number (e.g. `22K-4740`) to load that student's full personal schedule, electives included, sourced from the university's own per-student records. |
| **Teacher** | Select an instructor to view their complete weekly teaching schedule. |
| **Section** | Select a section or cohort code (e.g. `BCS-3A`) to load everything that group takes. |

### A schedule that's easy to read

- Clean, color-coded weekly grid — one color per course.
- Course name and section shown together (e.g. "Pakistan Studies (BSBA-3A)"), with text
  that automatically shrinks to fit so nothing is cut off, even on dense schedules.
- Automatic clash detection — overlapping classes are visibly flagged, not silently hidden.
- Labs correctly span their full time block instead of appearing as separate sessions.

### Live status, not just a static grid

- A "Now / Next" card shows the current class and what's coming up next, for today.
- The grid itself highlights the live class and the next one, looking ahead into next week
  once today's classes are finished.
- Optional OS-level notifications: alerts when a class starts, reminders at 30, 10, and 5
  minutes before a class ends or the next one begins, and a one-tap "End Class" action.

### Built for daily use

- Up to six independent saved timetables (a student's own, plus friends' or classmates') that
  can be switched between instantly — useful for comparing electives or checking who's free.
- Installable as an app (Add to Home Screen) on both phone and desktop.
- Light and dark themes, following the system setting automatically.
- One-click Print — export the grid as a high-resolution image to save or share.
- Refreshes from the official sheet automatically every hour — no manual reloading.

## Why use this instead of the official timetable

The official source is a raw spreadsheet, organized by room and time slot rather than by
student. Finding one week's schedule means scanning a dense grid of every room on campus and
cross-referencing section codes — and repeating the process for a friend's schedule or a
single time slot.

FAST Timetable is built around the opposite premise:

- **Personal.** Enter a roll number once, and that student's schedule is simply there — no
  piecing together a week from a room-by-room grid.
- **Readable at a glance.** Color-coded, clash-checked, and laid out as an actual weekly
  timetable, not a table of every class the university runs.
- **Aware of "now."** The official sheet has no concept of a current or upcoming class; this
  app does.
- **Persistent.** Selections are saved automatically. The official sheet resets to the same
  blank grid every time it's opened.
- **Mobile-friendly.** A responsive, installable app, built for a small screen — not a wide
  spreadsheet.
- **Data-consistent.** This isn't a separate or potentially outdated source. It reads the same
  data the university publishes, refreshed hourly.

## A note on data accuracy

The timetable data behind this app is maintained manually by a single person. While it is kept
in sync with the official source as closely as possible, students should always cross-check
their schedule against official university communications (email, portal announcements) before
relying on it for anything time-sensitive.

---

*Built by a student, for students, using data the university already publishes.*
