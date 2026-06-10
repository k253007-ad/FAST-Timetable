# FAST Timetable — Karachi Campus

A clean, fast weekly-timetable builder for FAST NUCES (Karachi) students. Pick the course
sections you're enrolled in and get a colour-coded weekly grid — always in sync with the
official timetable sheet, with clash detection and one-click image export.

## Features

- **Live data** — reads the official Google Sheets timetable through a lightweight metadata API;
  all day tabs are fetched in parallel and refreshed hourly (plus manual refresh).
- **Section picker** — token-based search (`cs2005 4b` works), checkbox multi-select, and
  removable chips. Your selection is saved on-device and restored on the next visit.
- **Smart grid** — consecutive sessions of the same class merge into one cell, labs span three
  slots, the current day is highlighted, and overlapping sessions are flagged as time clashes.
- **Image export** — download your timetable as a high-resolution PNG or JPG, with the course
  legend included.
- **Light & dark themes** — follows your system preference, togglable, and remembered.
- **Responsive** — works on phones (horizontal-scroll grid with sticky day column) and ships as
  an Android app via Capacitor.

## Tech stack

- [React 19](https://react.dev/) + [Vite 7](https://vite.dev/)
- [html2canvas](https://html2canvas.hertzen.com/) for image export
- [Capacitor 8](https://capacitorjs.com/) for the Android build
- Plain CSS design system (no UI framework) with light/dark tokens

## Getting started

```bash
npm install
npm run dev       # local dev server (proxies /api to the metadata server)
npm run build     # production build into dist/
npm run preview   # serve the production build locally
npm run lint      # eslint
```

The dev server proxies `/api/*` to the timetable metadata server (see `vite.config.js`).
In production the same rewrite is handled by `vercel.json`.

## Android (Capacitor)

```bash
npm run build
npx cap sync android
npx cap open android   # open in Android Studio
```

## Data source

Timetable data comes from the official FAST NUCES Karachi timetable spreadsheet via its
`gviz` JSON endpoint. A small metadata API (`/api/data`) supplies the sheet URL and the
`gid` of each weekday tab so the app keeps working when the sheet changes.

> This is an unofficial, student-built project and is not affiliated with FAST NUCES.
