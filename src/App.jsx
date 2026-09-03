import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import TimetableGrid from './components/TimetableGrid.jsx';
import ClassSelector from './components/ClassSelector.jsx';
import NowNext from './components/NowNext.jsx';
import { fetchData } from './services/dataService.js';
import { assignCourseColors } from './utils/courseColors.js';
import {
  DAY_ORDER,
  getClassesForRollNo,
  getClassesForSection,
  getOccupiedSlots,
  isExtraExpired,
} from './utils/schedule.js';
import { useClassNotifications } from './hooks/useClassNotifications.js';
import {
  BrandMark,
  IconAlert,
  IconBell,
  IconBellOff,
  IconGithub,
  IconPhone,
  IconPrinter,
  IconImage,
  IconMoon,
  IconRefresh,
  IconSettings,
  IconSun,
} from './components/Icons.jsx';
import './index.css';

const GITHUB_PROFILE_URL = 'https://github.com/k253007-ad';
const WHATSAPP_URL = 'https://wa.me/923333320415';
const REFRESH_INTERVAL_MS = 3600000; // hourly, matching the sheet's update cadence

const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const PROFILE_COUNT = 5;

// Profile 1 keeps the legacy "selectedClasses" key so existing users' saved
// selections keep landing in the right place; profiles 2-5 are additive.
// "main" (added 2026-08-25) is a separate, additional slot — never repurposes
// an existing key — that specifically represents the user's OWN timetable;
// it's what useClassNotifications reads regardless of which profile tab is
// currently open, and it's the default landing slot for new users.
const getProfileStorageKey = (profile) => {
  if (profile === 'main') return 'selectedClasses_main';
  return profile === 1 ? 'selectedClasses' : `selectedClasses_${profile}`;
};

const getSavedActiveProfile = () => {
  try {
    const saved = localStorage.getItem('activeProfile');
    if (saved === 'main') return 'main';
    const n = Number(saved);
    if (Number.isInteger(n) && n >= 1 && n <= PROFILE_COUNT) return n;
  } catch {
    /* storage unavailable */
  }
  return 'main';
};

const getSavedClasses = (profile) => {
  try {
    const saved = localStorage.getItem(getProfileStorageKey(profile));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Manual per-class time overrides ("moved from Wed slot 4 to Thu slot 7") —
// same per-profile key scheme as selections above, additive/separate keys so
// it can't collide with the existing `selectedClasses*` storage.
const getOverrideStorageKey = (profile) => {
  if (profile === 'main') return 'classOverrides_main';
  return profile === 1 ? 'classOverrides' : `classOverrides_${profile}`;
};

const getSavedOverrides = (profile) => {
  try {
    const saved = localStorage.getItem(getOverrideStorageKey(profile));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// One-off "extra class" additions ("just this week, add one more Data
// Structures session Thursday slot 7") — same per-profile key scheme again,
// its own separate storage so it can't collide with selections or overrides.
const getExtraStorageKey = (profile) => {
  if (profile === 'main') return 'extraClasses_main';
  return profile === 1 ? 'extraClasses' : `extraClasses_${profile}`;
};

const getSavedExtras = (profile) => {
  try {
    const saved = localStorage.getItem(getExtraStorageKey(profile));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Personal "activities" (Library, Cafe, Prayer/Namaz, ...) — see "Manage
// activities" in ClassSelector.jsx, added 2026-09-02. Same per-profile key
// scheme again, own separate storage.
const getActivityStorageKey = (profile) => {
  if (profile === 'main') return 'activities_main';
  return profile === 1 ? 'activities' : `activities_${profile}`;
};

const getSavedActivities = (profile) => {
  try {
    const saved = localStorage.getItem(getActivityStorageKey(profile));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// "Keep synced" (2026-09-01, redesigned same day to full-replace semantics
// after feedback) — a per-profile link to exactly one live roll number OR
// one live section: `{ type: 'rollno'|'section', value: string } | null`.
// Picking a roll no/section **replaces the entire selection** with that
// group's current classes (not merged with whatever was selected before) —
// simpler than the original add/remove-diff design, and matches "syncing"
// meaning "your selection IS this roll no/section," full stop. The same
// resolve-and-replace effect below runs both the first time it's picked and
// on every later data load/refresh, so it doesn't need its own snapshot
// bookkeeping — the current live group is always the whole answer.
const getSyncStorageKey = (profile) => {
  if (profile === 'main') return 'linkedSync_main';
  return profile === 1 ? 'linkedSync' : `linkedSync_${profile}`;
};

const getSavedSync = (profile) => {
  try {
    const saved = localStorage.getItem(getSyncStorageKey(profile));
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const timeAgo = (date, now) => {
  const mins = Math.floor((now - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
};

// Falls back to Monday on a weekend, since the grid/day-picker only ever
// covers DAY_ORDER (Monday-Friday).
const getTodayName = () => {
  const name = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return DAY_ORDER.includes(name) ? name : DAY_ORDER[0];
};

function App() {
  const [timetableData, setTimetableData] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [activeProfile, setActiveProfile] = useState(getSavedActiveProfile);
  const [selectedClasses, setSelectedClasses] = useState(() =>
    getSavedClasses(getSavedActiveProfile())
  );
  const [overrides, setOverrides] = useState(() => getSavedOverrides(getSavedActiveProfile()));
  const [extraClasses, setExtraClasses] = useState(() => getSavedExtras(getSavedActiveProfile()));
  const [activities, setActivities] = useState(() => getSavedActivities(getSavedActiveProfile()));
  const [linkedSync, setLinkedSync] = useState(() => getSavedSync(getSavedActiveProfile()));
  // Today/Full Week grid view (added 2026-09-01, moved into its own visible
  // box between NowNext and the grid per feedback that the small in-grid
  // toggle wasn't visible enough) — 'week' is the default/existing full-grid
  // behavior; 'day' shows just one day's schedule top-to-bottom, defaulting
  // to today but browsable to any weekday via the day picker that appears
  // alongside it. Clicking "Today" always jumps back to the real today.
  const [gridView, setGridView] = useState('week');
  const [gridDay, setGridDay] = useState(getTodayName);

  const captureRef = useRef(null);
  const exportMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const hasDataRef = useRef(false);

  const notif = useClassNotifications(timetableData);

  useEffect(() => {
    hasDataRef.current = timetableData !== null;
  }, [timetableData]);

  // Persist selection under the active profile's slot (legacy key + format
  // kept for profile 1, so existing users' saved selections keep working).
  useEffect(() => {
    try {
      localStorage.setItem(getProfileStorageKey(activeProfile), JSON.stringify(selectedClasses));
    } catch {
      /* storage unavailable */
    }
  }, [selectedClasses, activeProfile]);

  useEffect(() => {
    try {
      localStorage.setItem('activeProfile', String(activeProfile));
    } catch {
      /* storage unavailable */
    }
  }, [activeProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(getOverrideStorageKey(activeProfile), JSON.stringify(overrides));
    } catch {
      /* storage unavailable */
    }
  }, [overrides, activeProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(getExtraStorageKey(activeProfile), JSON.stringify(extraClasses));
    } catch {
      /* storage unavailable */
    }
  }, [extraClasses, activeProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(getActivityStorageKey(activeProfile), JSON.stringify(activities));
    } catch {
      /* storage unavailable */
    }
  }, [activities, activeProfile]);

  // Auto-remove an activity the moment it clashes with a real course — a
  // course added, a manual move, new data from a refresh, or the activity
  // itself just being added on top of an already-occupied slot can all
  // trigger this (hence `activities` in the dependency array too, not just
  // the three things that change a course's own occupied slots). Never the
  // other way around: a course is never displaced to make room for an
  // activity. Safe against a re-render loop: when nothing needs removing,
  // `setActivities` gets back the exact same `prev` reference, so React
  // bails out instead of re-triggering this effect again.
  useEffect(() => {
    if (!timetableData) return;
    const occupied = getOccupiedSlots(timetableData, selectedClasses, overrides);
    setActivities((prev) => {
      const next = prev.filter((a) => !occupied.has(`${a.day}|${a.time}`));
      return next.length === prev.length ? prev : next;
    });
  }, [timetableData, selectedClasses, overrides, activities]);

  useEffect(() => {
    try {
      const key = getSyncStorageKey(activeProfile);
      if (linkedSync) localStorage.setItem(key, JSON.stringify(linkedSync));
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [linkedSync, activeProfile]);

  // "Keep synced" — whenever the profile has a linked roll no/section,
  // re-resolves it against whatever `timetableData` currently holds
  // (initial load, hourly auto-refresh, manual refresh) and **replaces
  // `selectedClasses` outright** with that group's current classes — this
  // is what makes syncing mean "your selection IS this roll no/section,"
  // not "these classes are also included." Runs on the very first pick too
  // (setLinkedSync itself is a dependency), so there's no separate
  // "apply once immediately" code path. `null` from getClassesForRollNo/
  // getClassesForSection means the relevant data source isn't loaded yet
  // (skip — don't wipe the selection over a transient gap); `[]` means it
  // loaded and this roll no/section genuinely has zero classes right now,
  // which is a real state to apply.
  useEffect(() => {
    if (!timetableData || !linkedSync) return;
    const live =
      linkedSync.type === 'rollno'
        ? getClassesForRollNo(timetableData, linkedSync.value)
        : getClassesForSection(timetableData, linkedSync.value);
    if (live === null) return;
    setSelectedClasses(live);
  }, [timetableData, activeProfile, linkedSync]);

  const switchProfile = useCallback((profile) => {
    setActiveProfile(profile);
    setSelectedClasses(getSavedClasses(profile));
    setOverrides(getSavedOverrides(profile));
    setExtraClasses(getSavedExtras(profile));
    setActivities(getSavedActivities(profile));
    setLinkedSync(getSavedSync(profile));
  }, []);

  // Apply + persist theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* storage unavailable */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#10131a' : '#ffffff');
  }, [theme]);

  const getData = useCallback(async () => {
    if (hasDataRef.current) {
      setRefreshing(true);
    } else {
      setStatus('loading');
    }
    try {
      const data = await fetchData();
      setTimetableData(data);
      setLastUpdated(new Date());
      setNow(Date.now());
      setRefreshError(false);
      setStatus('ready');
    } catch (err) {
      console.error('Failed to load timetable data:', err);
      if (hasDataRef.current) {
        setRefreshError(true); // keep showing the data we already have
      } else {
        setStatus('error');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    getData();
    const intervalId = setInterval(getData, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [getData]);

  // Keep the "updated X min ago" label fresh.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(tick);
  }, []);

  // Auto-remove one-off "extra classes" once their slot has passed — the
  // app has no calendar/date model, so an extra is only ever meant for
  // "this week"; this replaces the student having to remember to delete it
  // by hand (isExtraExpired, schedule.js). Piggybacks on the 60s `now`
  // ticker above rather than its own interval.
  useEffect(() => {
    setExtraClasses((prev) => {
      const nowDate = new Date();
      const next = prev.filter((e) => !isExtraExpired(e, nowDate, timetableData));
      return next.length === prev.length ? prev : next;
    });
  }, [now, timetableData]);

  // Close the export menu on outside click / Escape.
  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportOpen]);

  // Close the settings menu on outside click / Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  const allClasses = useMemo(
    () =>
      timetableData
        ? [...new Set(timetableData.timetable.map((item) => `${item.Course} - ${item.Section}`))].sort()
        : [],
    [timetableData]
  );

  const courseColors = useMemo(() => assignCourseColors(selectedClasses), [selectedClasses]);

  const handleExport = useCallback(
    async (format) => {
      setExportOpen(false);
      const element = captureRef.current;
      if (!element || exporting) return;

      setExporting(true);
      try {
        await document.fonts?.ready;
        const surface = getComputedStyle(document.documentElement)
          .getPropertyValue('--surface')
          .trim();

        const canvas = await html2canvas(element, {
          scale: 2,
          backgroundColor: surface || '#ffffff',
          windowWidth: 1560,
          onclone: (clonedDoc) => {
            const target = clonedDoc.querySelector('[data-capture]');
            if (target) {
              target.classList.add('exporting');
              target.style.width = '1480px';
            }
          },
        });

        const isPng = format === 'png';
        const stamp = new Date().toISOString().slice(0, 10);
        const link = document.createElement('a');
        link.href = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.95);
        link.download = `FAST-Timetable_${stamp}.${isPng ? 'png' : 'jpg'}`;
        link.click();
      } catch (err) {
        console.error('Export failed:', err);
      } finally {
        setExporting(false);
      }
    },
    [exporting]
  );

  const canExport = status === 'ready' && selectedClasses.length > 0 && !exporting;

  return (
    <div className="app">
      <header className="app-header no-print">
        <div className="header-inner">
          <div className="brand">
            <BrandMark size={34} />
            <div className="brand-text">
              <span className="brand-title">FAST Timetable</span>
              <span className="brand-sub">Karachi Campus</span>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={getData}
              disabled={status === 'loading' || refreshing}
              title={lastUpdated ? `Data synced ${timeAgo(lastUpdated, now)}` : 'Refresh data'}
            >
              <span className={refreshing ? 'spin' : undefined}>
                <IconRefresh size={16} />
              </span>
              <span className="btn-label">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>

            <div className="menu-wrap" ref={exportMenuRef}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setExportOpen((v) => !v)}
                disabled={!canExport}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                title={
                  selectedClasses.length === 0
                    ? 'Select classes first to print your timetable'
                    : 'Print your timetable as an image'
                }
              >
                <IconPrinter size={16} />
                <span className="btn-label">{exporting ? 'Printing…' : 'Print'}</span>
              </button>
              {exportOpen && (
                <div className="menu" role="menu">
                  <button type="button" role="menuitem" className="menu-item" onClick={() => handleExport('png')}>
                    <IconImage size={16} />
                    <span>
                      Download PNG
                      <small>Sharp, best for sharing</small>
                    </span>
                  </button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => handleExport('jpg')}>
                    <IconImage size={16} />
                    <span>
                      Download JPG
                      <small>Smaller file size</small>
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className="menu-wrap" ref={settingsMenuRef}>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setSettingsOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={settingsOpen}
                aria-label="Settings"
                title="Settings"
              >
                <IconSettings size={17} />
              </button>
              {settingsOpen && (
                <div className="menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={async () => {
                      if (notif.permission === 'granted') {
                        await notif.setNotificationsEnabled(!notif.userEnabled);
                      } else {
                        await notif.requestPermission();
                      }
                      setSettingsOpen(false);
                    }}
                    disabled={notif.permission === 'unsupported' || notif.permission === 'denied'}
                  >
                    {notif.permission === 'granted' && notif.userEnabled ? (
                      <IconBell size={16} />
                    ) : (
                      <IconBellOff size={16} />
                    )}
                    <span>
                      {notif.permission === 'granted'
                        ? notif.userEnabled
                          ? 'Notifications on'
                          : 'Notifications off'
                        : notif.permission === 'denied'
                          ? 'Notifications blocked'
                          : notif.permission === 'unsupported'
                            ? 'Notifications unsupported'
                            : 'Enable notifications'}
                      <small>
                        {notif.permission === 'granted'
                          ? notif.userEnabled
                            ? notif.pushStatus?.state === 'subscribed'
                              ? 'Push: connected — works even fully closed'
                              : notif.pushStatus?.state === 'error'
                                ? `Push error (${notif.pushStatus.detail}) — only works while open`
                                : 'Connecting to push...'
                            : 'Tap to turn back on'
                          : 'Based on your Main timetable'}
                      </small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
                      setSettingsOpen(false);
                    }}
                  >
                    {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                    <span>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
                  </button>

                  <div className="menu-divider" role="separator" />

                  <a
                    role="menuitem"
                    className="menu-item"
                    href={GITHUB_PROFILE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <IconGithub size={16} />
                    <span>GitHub</span>
                  </a>

                  <a
                    role="menuitem"
                    className="menu-item"
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <IconPhone size={16} />
                    <span>WhatsApp</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="app-main">
        {status === 'loading' && (
          <div className="skeleton-page" aria-label="Loading timetable" role="status">
            <div className="card selector-card">
              <div className="skel skel-title" />
              <div className="skel skel-input" />
            </div>
            <div className="card grid-skel">
              <div className="skel skel-bar" />
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skel skel-row" />
              ))}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="card error-card" role="alert">
            <div className="empty-icon is-warning">
              <IconAlert size={26} />
            </div>
            <h3>Couldn’t load the timetable</h3>
            <p>
              The official timetable sheet didn’t respond. Check your connection and try again — if
              the problem persists, the source sheet may be temporarily unavailable.
            </p>
            <button type="button" className="btn btn-primary" onClick={getData}>
              <IconRefresh size={16} />
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            {refreshError && (
              <div className="alert-bar no-print" role="status">
                <IconAlert size={15} />
                <span>Couldn’t refresh just now — showing the last loaded data.</span>
                <button type="button" className="link-button" onClick={getData}>
                  Retry
                </button>
              </div>
            )}

            <ClassSelector
              data={timetableData}
              allClasses={allClasses}
              selectedClasses={selectedClasses}
              setSelectedClasses={setSelectedClasses}
              overrides={overrides}
              setOverrides={setOverrides}
              extraClasses={extraClasses}
              setExtraClasses={setExtraClasses}
              activities={activities}
              setActivities={setActivities}
              courseColors={courseColors}
              activeProfile={activeProfile}
              profileCount={PROFILE_COUNT}
              onSwitchProfile={switchProfile}
              linkedSync={linkedSync}
              setLinkedSync={setLinkedSync}
            />

            <NowNext
              data={timetableData}
              selectedClasses={selectedClasses}
              overrides={overrides}
              extraClasses={extraClasses}
              activities={activities}
              isMainProfile={activeProfile === 'main'}
              onClassEnded={notif.markCurrentEnded}
              manualEndedKey={notif.manualEndedKey}
            />

            <section className="card view-toggle-card no-print">
              <div className="view-toggle">
                <button
                  type="button"
                  className={`view-tab${gridView === 'day' ? ' is-active' : ''}`}
                  onClick={() => {
                    setGridView('day');
                    setGridDay(getTodayName());
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`view-tab${gridView === 'week' ? ' is-active' : ''}`}
                  onClick={() => setGridView('week')}
                >
                  Full Week
                </button>
              </div>

              {gridView === 'day' && (
                <div className="day-picker" role="tablist" aria-label="Choose a day">
                  {DAY_ORDER.map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="tab"
                      aria-selected={gridDay === d}
                      className={`day-tab${gridDay === d ? ' is-active' : ''}`}
                      onClick={() => setGridDay(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div ref={captureRef} data-capture className="capture-area">
              <TimetableGrid
                data={timetableData}
                selectedClasses={selectedClasses}
                overrides={overrides}
                extraClasses={extraClasses}
                activities={activities}
                courseColors={courseColors}
                isDark={theme === 'dark'}
                viewMode={gridView}
                selectedDay={gridDay}
              />
            </div>
          </>
        )}
      </main>

      <footer className="app-footer no-print">
        <span>An unofficial tool, built by Adnan 25K-3007 for FAST NUCES students.</span>
        <span>
          Live from the official timetable sheet
          {lastUpdated && ` · synced ${timeAgo(lastUpdated, now)}`} · auto-refreshes hourly
        </span>
      </footer>
    </div>
  );
}

export default App;
