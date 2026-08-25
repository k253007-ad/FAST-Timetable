import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import TimetableGrid from './components/TimetableGrid.jsx';
import ClassSelector from './components/ClassSelector.jsx';
import NowNext from './components/NowNext.jsx';
import { fetchData } from './services/dataService.js';
import { assignCourseColors } from './utils/courseColors.js';
import { useClassNotifications } from './hooks/useClassNotifications.js';
import {
  BrandMark,
  IconAlert,
  IconBell,
  IconBellOff,
  IconChevronDown,
  IconPrinter,
  IconImage,
  IconMoon,
  IconRefresh,
  IconSun,
} from './components/Icons.jsx';
import './index.css';

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

const timeAgo = (date, now) => {
  const mins = Math.floor((now - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
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
  const [theme, setTheme] = useState(getInitialTheme);
  const [activeProfile, setActiveProfile] = useState(getSavedActiveProfile);
  const [selectedClasses, setSelectedClasses] = useState(() =>
    getSavedClasses(getSavedActiveProfile())
  );

  const captureRef = useRef(null);
  const exportMenuRef = useRef(null);
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

  const switchProfile = useCallback((profile) => {
    setActiveProfile(profile);
    setSelectedClasses(getSavedClasses(profile));
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
                <IconChevronDown size={14} />
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

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={notif.permission === 'granted' ? undefined : notif.requestPermission}
              disabled={notif.permission === 'unsupported' || notif.permission === 'granted'}
              aria-label={
                notif.permission === 'granted'
                  ? 'Class notifications are on'
                  : notif.permission === 'denied'
                    ? 'Notifications blocked — enable them in your browser settings'
                    : notif.permission === 'unsupported'
                      ? 'Notifications aren’t supported in this browser'
                      : 'Enable class notifications'
              }
              title={
                notif.permission === 'granted'
                  ? 'Class notifications are on — based on your Main timetable'
                  : notif.permission === 'denied'
                    ? 'Notifications blocked — enable them in your browser settings'
                    : notif.permission === 'unsupported'
                      ? 'Notifications aren’t supported in this browser (try installing this site as an app first)'
                      : 'Enable class notifications for your Main timetable'
              }
            >
              {notif.permission === 'granted' ? <IconBell size={17} /> : <IconBellOff size={17} />}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
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
              courseColors={courseColors}
              activeProfile={activeProfile}
              profileCount={PROFILE_COUNT}
              onSwitchProfile={switchProfile}
            />

            <NowNext
              data={timetableData}
              selectedClasses={selectedClasses}
              isMainProfile={activeProfile === 'main'}
              onClassEnded={notif.markCurrentEnded}
              manualEndedKey={notif.manualEndedKey}
            />

            <div ref={captureRef} data-capture className="capture-area">
              <TimetableGrid
                data={timetableData}
                selectedClasses={selectedClasses}
                courseColors={courseColors}
                isDark={theme === 'dark'}
              />
            </div>
          </>
        )}
      </main>

      <footer className="app-footer no-print">
        <span>An unofficial tool, built by students for FAST NUCES students.</span>
        <span>
          Live from the official timetable sheet
          {lastUpdated && ` · synced ${timeAgo(lastUpdated, now)}`} · auto-refreshes hourly
        </span>
      </footer>
    </div>
  );
}

export default App;
