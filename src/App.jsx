import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import TimetableGrid from './components/TimetableGrid.jsx';
import ClassSelector, { Modal } from './components/ClassSelector.jsx';
import NowNext from './components/NowNext.jsx';
import { fetchData } from './services/dataService.js';
import { getSessional1Url, fetchSessional1, getSessional1Schedule } from './services/sessional1Service.js';
import { assignCourseColors } from './utils/courseColors.js';
import {
  DAY_ORDER,
  getClassesForRollNo,
  getClassesForSection,
  getOccupiedSlots,
  isExtraExpired,
} from './utils/schedule.js';
import { useClassNotifications, getMainSchedule } from './hooks/useClassNotifications.js';
import {
  getOrCreateCalendarFeedId,
  getCalendarFeedUrl,
  pushCalendarSchedule,
  openGoogleCalendarSubscribePrompt,
} from './utils/calendarExport.js';
import {
  isGoogleSignInConfigured,
  initGoogleSignIn,
  renderGoogleSignInButton,
  disableGoogleAutoSelect,
  exchangeGoogleCredential,
  fetchGoogleSession,
  logoutGoogleServer,
  pushAccountSync,
} from './utils/googleAuth.js';
import { isNuEmail, getRollNoFromNuEmail } from './utils/nuEmail.js';
import {
  BrandMark,
  IconAlert,
  IconBell,
  IconBellOff,
  IconCalendar,
  IconDownload,
  IconGithub,
  IconLogOut,
  IconPhone,
  IconPrinter,
  IconImage,
  IconMoon,
  IconRefresh,
  IconSettings,
  IconSun,
  IconUser,
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

// Last-good timetable snapshot (added 2026-09-14, diagnosing "PWA takes long
// to open" vs. a competing student PWA that "loads instantly") — this app
// always fetches genuinely fresh data over the network on every load (the
// whole point of a manually-updated shared sheet is that it can change at
// any time), but there is no reason the FIRST PAINT has to wait on that
// fetch: it can render last session's data instantly, then quietly swap in
// the real fetch's result the moment it arrives, same "stale-while-
// revalidate" idea already used at the HTTP layer by faster sites. This is
// purely a perceived-speed optimization at the render layer — the network
// fetch in `getData()` below is completely unchanged, still runs every
// load, still is the only source of truth once it resolves.
const TIMETABLE_CACHE_KEY = 'cachedTimetableData';

const getCachedTimetableSnapshot = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMETABLE_CACHE_KEY) || 'null');
    // Shape-checked, not just truthy — this bypasses the loading skeleton
    // entirely (see `status`'s initializer below), so a malformed or
    // schema-drifted cache entry (e.g. saved by a future/past app version
    // with a different `timetableData` shape) must be rejected here rather
    // than crash deep inside a component that assumes `.timetable` is an
    // array.
    if (saved?.data && Array.isArray(saved.data.timetable) && saved.at) return saved;
  } catch {
    /* storage unavailable, or the cached JSON was corrupt */
  }
  return null;
};

const saveCachedTimetableSnapshot = (data) => {
  try {
    localStorage.setItem(TIMETABLE_CACHE_KEY, JSON.stringify({ data, at: Date.now() }));
  } catch {
    /* storage unavailable (e.g. full, or private-browsing quota) — the app
       still works, just without the instant-first-paint benefit next open */
  }
};

// "Install app" card (added 2026-09-14) — is the site currently running as
// an installed PWA rather than a normal browser tab? `display-mode:
// standalone` is the cross-browser signal (Chrome/Edge/Android, and
// desktop installs); `navigator.standalone` is Safari's own pre-standard
// equivalent for an iOS home-screen install, which never matches the media
// query. Checked once on load (not reactively) to decide whether to show
// the card at all — once true, it can never become false again within a
// single page load (an install can't un-install itself mid-session).
const isRunningStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iOS Safari/Chrome never fire `beforeinstallprompt` and have no
// programmatic install API at all — "Add to Home Screen" is a manual step
// under the Share sheet. Detected by user-agent (there's no feature-test
// for "this browser lacks an install prompt" — the card has to know to
// show instructions instead of a button before ever finding out whether
// `beforeinstallprompt` fires, since not-firing looks identical to
// "hasn't fired yet").
const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

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

// 1-5 plus 'main' — every profile slot's override storage, used by the
// "master sheet actually changed" reset below (2026-09-10) so a stale
// override can't survive under a profile that isn't currently open.
const ALL_OVERRIDE_PROFILES = [1, 2, 3, 4, 5, 'main'];
const TIMETABLE_SIGNATURE_KEY = 'timetableSignature';

// Cheap content fingerprint for "did the sheet's actual data change", not
// "did a fetch happen" — the hourly auto-refresh re-fetches identical data
// far more often than the sheet genuinely changes, so a plain djb2-style
// string hash (not cryptographic, just needs to differ when the content
// does) is enough; no need to store or compare the full JSON. Shared by the
// master-timetable-change override reset below and the roll-number-sheet-
// change resync in ClassSelector's sync effect (2026-09-10).
const hashContent = (rows) => {
  const str = JSON.stringify(rows || []);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
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

const ALL_PROFILES = ['main', 1, 2, 3, 4, 5];

// Raw key literals duplicated from their owning modules on purpose (rather
// than importing a getter/setter from each) — ClassSelector.jsx's
// CUSTOM_ACTIVITY_KEY, useClassNotifications.js's NOTIF_ENABLED_KEY, and
// calendarExport.js's CALENDAR_FEED_ID_KEY are all device-wide (not
// per-profile) preferences that make sense to carry along with an account
// too. This is the one place outside each of those files that needs to
// know these specific strings; keep it in sync by hand if any of them ever
// change (same "kept in sync by hand" tradeoff already accepted elsewhere
// in this codebase, e.g. notifyLogic.js/useClassNotifications.js).
const CUSTOM_ACTIVITY_KEY = 'customActivityTypes';
const NOTIF_ENABLED_KEY = 'notificationsUserEnabled';
const CALENDAR_FEED_ID_KEY = 'calendarFeedId';

// Builds the full "everything this device would otherwise remember"
// snapshot sent to /api/sync — see the "Google accounts" section of the
// workspace-root CLAUDE.md for the exact shape and why it covers all 6
// profile slots (not just the one currently open) plus device-wide
// preferences. `liveActive` lets the caller supply the CURRENTLY active
// profile's real-time React state for its 5 fields instead of whatever's
// last been flushed to localStorage — the two are normally in sync within
// a render or two anyway (separate persist-effects write each field), but
// passing the live values avoids a theoretical race where a sync fires in
// the same tick as a state change that hasn't been persisted yet.
const buildAccountSyncPayload = (activeProfile, liveActive) => {
  const profiles = {};
  ALL_PROFILES.forEach((profile) => {
    if (profile === activeProfile) {
      profiles[profile] = liveActive;
    } else {
      profiles[profile] = {
        selectedClasses: getSavedClasses(profile),
        overrides: getSavedOverrides(profile),
        extraClasses: getSavedExtras(profile),
        activities: getSavedActivities(profile),
        linkedSync: getSavedSync(profile),
      };
    }
  });
  let customActivityTypes = [];
  try {
    customActivityTypes = JSON.parse(localStorage.getItem(CUSTOM_ACTIVITY_KEY) || '[]');
  } catch {
    /* storage unavailable or corrupt — sync an empty list rather than throw */
  }
  return {
    profiles,
    activeProfile,
    theme: getInitialTheme(),
    customActivityTypes,
    notificationsEnabled: localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false',
    calendarFeedId: localStorage.getItem(CALENDAR_FEED_ID_KEY) || null,
  };
};

// The inverse — writes an account's synced data back into this device's
// localStorage (every profile slot, not just the active one) and, for
// whichever profile ends up active, also updates the live React state via
// the setters passed in `setters`, so the currently-rendered UI reflects
// the newly-applied account data immediately rather than only on next
// profile switch/reload.
const applyAccountData = (data, setters) => {
  if (!data || typeof data !== 'object') return;

  ALL_PROFILES.forEach((profile) => {
    const p = data.profiles?.[profile];
    if (!p) return;
    try {
      localStorage.setItem(getProfileStorageKey(profile), JSON.stringify(p.selectedClasses || []));
      localStorage.setItem(getOverrideStorageKey(profile), JSON.stringify(p.overrides || []));
      localStorage.setItem(getExtraStorageKey(profile), JSON.stringify(p.extraClasses || []));
      localStorage.setItem(getActivityStorageKey(profile), JSON.stringify(p.activities || []));
      if (p.linkedSync) localStorage.setItem(getSyncStorageKey(profile), JSON.stringify(p.linkedSync));
      else localStorage.removeItem(getSyncStorageKey(profile));
    } catch {
      /* storage unavailable — this device just won't have the synced copy locally */
    }
  });

  const nextActive = ALL_PROFILES.includes(data.activeProfile) ? data.activeProfile : 'main';
  try {
    localStorage.setItem('activeProfile', String(nextActive));
  } catch {
    /* storage unavailable */
  }

  if (Array.isArray(data.customActivityTypes)) {
    try {
      localStorage.setItem(CUSTOM_ACTIVITY_KEY, JSON.stringify(data.customActivityTypes));
    } catch {
      /* storage unavailable */
    }
  }
  if (typeof data.notificationsEnabled === 'boolean') {
    try {
      localStorage.setItem(NOTIF_ENABLED_KEY, String(data.notificationsEnabled));
    } catch {
      /* storage unavailable */
    }
  }
  if (data.calendarFeedId) {
    try {
      localStorage.setItem(CALENDAR_FEED_ID_KEY, data.calendarFeedId);
    } catch {
      /* storage unavailable */
    }
  }
  if (data.theme === 'light' || data.theme === 'dark') {
    try {
      localStorage.setItem('theme', data.theme);
    } catch {
      /* storage unavailable */
    }
    setters.setTheme(data.theme);
  }

  const activeData = data.profiles?.[nextActive];
  setters.setActiveProfile(nextActive);
  if (activeData) {
    setters.setSelectedClasses(activeData.selectedClasses || []);
    setters.setOverrides(activeData.overrides || []);
    setters.setExtraClasses(activeData.extraClasses || []);
    setters.setActivities(activeData.activities || []);
    setters.setLinkedSync(activeData.linkedSync || null);
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

// Google's own rendered "Sign in with Google" button (googleAuth.js) has
// to be rendered into a real DOM node it controls, not built as normal
// JSX — this small wrapper owns that node and re-initializes/re-renders it
// whenever it (re)mounts, which happens each time the Settings menu opens
// while signed out (the menu's contents unmount when closed). If
// VITE_GOOGLE_CLIENT_ID isn't configured yet (see .env.example), shows a
// plain explanatory line instead of a button that could never work.
const GoogleSignInButton = ({ onCredential }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isGoogleSignInConfigured()) return undefined;
    let cancelled = false;
    initGoogleSignIn(onCredential).then((ok) => {
      if (!cancelled && ok) renderGoogleSignInButton(containerRef.current, { width: 200 });
    });
    return () => {
      cancelled = true;
    };
  }, [onCredential]);

  if (!isGoogleSignInConfigured()) {
    return <p className="menu-item-hint">Google sign-in isn&rsquo;t set up yet.</p>;
  }
  return <div ref={containerRef} className="google-signin-btn" />;
};

function App() {
  const [timetableData, setTimetableData] = useState(() => getCachedTimetableSnapshot()?.data ?? null);
  // Read by the "Keep synced" resolve effect below instead of depending on
  // `timetableData` directly — see that effect's own comment for why.
  const timetableDataRef = useRef(timetableData);
  useEffect(() => {
    timetableDataRef.current = timetableData;
  }, [timetableData]);
  // Content fingerprints (not raw `timetableData`, which gets a new object
  // reference every fetch even when byte-identical) that change value only
  // when the master sheet's or the roll-number sheet's actual rows do —
  // see the "Keep synced" resolve effect and `hashContent`'s own comment.
  const timetableHash = useMemo(() => hashContent(timetableData?.timetable), [timetableData]);
  const rollNumbersHash = useMemo(() => hashContent(timetableData?.rollNumbers), [timetableData]);
  // 'loading' | 'ready' | 'error' — starts 'ready' when a cached snapshot
  // exists (see getCachedTimetableSnapshot above), so a returning student
  // sees last session's schedule instantly instead of the loading skeleton
  // while the real, fresh fetch runs quietly in the background.
  const [status, setStatus] = useState(() => (getCachedTimetableSnapshot() ? 'ready' : 'loading'));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  // Distinguishes "you're offline" from "the fetch failed for some other
  // reason" purely for the alert bar's wording below — both cases already
  // behave identically otherwise (cached data keeps showing either way).
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  const [lastUpdated, setLastUpdated] = useState(() => {
    const cached = getCachedTimetableSnapshot();
    return cached ? new Date(cached.at) : null;
  });
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
  // "Install app" card — see isRunningStandalone/isIOS above for what each
  // of these means. `installPrompt` holds the captured `beforeinstallprompt`
  // event itself (calling `.prompt()` on it is the only way to show
  // Chrome/Edge/Android's native install dialog, and it can only be called
  // once per captured event). `showInstallCard` starts `true` unless
  // already running standalone at load — the one condition that hides the
  // card outright, everything else (no prompt captured yet, iOS, dismissed
  // the native prompt) keeps it showing, matching "stays until the user
  // downloads the app" — there's deliberately no manual close button.
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallCard, setShowInstallCard] = useState(() => !isRunningStandalone());
  // Sessional-1 seatings (added 2026-09-18, on request: "make an option of
  // print Sessional-1 Seatings which gives timetable of selected
  // courses"). Time-boxed on purpose — the banner/button below only shows
  // through the last exam day (see `sessional1WindowActive` near the JSX),
  // then disappears on its own with no code change needed. Data is fetched
  // LAZILY (only once the student actually opens the modal), not as part
  // of the main load — see sessional1Service.js's own doc comment for why.
  // `sessional1Entries` stays `null` until the first fetch attempt so a
  // second open of the modal doesn't refetch.
  const [sessional1Open, setSessional1Open] = useState(false);
  const [sessional1Entries, setSessional1Entries] = useState(null);
  const [sessional1Status, setSessional1Status] = useState('idle'); // idle | loading | ready | error
  const [sessional1Exporting, setSessional1Exporting] = useState(false);
  const sessional1CaptureRef = useRef(null);
  // Google accounts / cross-device sync (added 2026-09-14). `account` is
  // `null` while signed out, `{ user: { email, name, picture } }` once
  // signed in — deliberately never holds the raw synced `data` itself as
  // React state (it's applied straight into the existing per-profile
  // localStorage + state via applyAccountData instead, see the sign-in
  // handler below), so there's exactly one source of truth for "what's
  // currently selected," not two that could drift apart. `authChecked`
  // gates rendering the Settings menu's sign-in/out UI until the initial
  // session check (a network round trip) resolves, so it doesn't flash a
  // "Sign in" button for a fraction of a second on every load for a
  // student who's actually already signed in.
  const [account, setAccount] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [accountNotice, setAccountNotice] = useState(null); // { state: 'signed-in' | 'error', message } | null

  const captureRef = useRef(null);
  const exportMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const hasDataRef = useRef(false);
  // Marks a real, explicit sign-in action (set in `handleGoogleCredential`)
  // so the FAST-NU-email auto-sync effect below can tell that apart from the
  // silent session-restore on every page load — see that effect's own
  // comment for why the distinction matters.
  const justSignedInRef = useRef(false);

  const notif = useClassNotifications(timetableData);

  useEffect(() => {
    hasDataRef.current = timetableData !== null;
  }, [timetableData]);

  // "Install app" card, part 2 — Chrome/Edge/Android fire
  // `beforeinstallprompt` once the browser's own installability criteria
  // are met (manifest + service worker present, both already true here);
  // `preventDefault()` stops the browser's own mini-infobar so this card is
  // the only install UI shown, and the event itself is stashed so the
  // card's button can call `.prompt()` on it later, on a real user click
  // (`.prompt()` silently no-ops without a user gesture right before it).
  // `appinstalled` is the one thing allowed to hide the card outright after
  // load — an actual successful install, not a dismissed prompt (dismissing
  // the native dialog does NOT fire this event, so the card correctly stays
  // up per "stays until the user downloads the app").
  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onAppInstalled = () => {
      setShowInstallCard(false);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  // Google accounts — restore a signed-in session on load (a returning
  // visit with a still-valid session cookie), applying whatever the
  // account has synced so far straight into this device's own storage +
  // live state. Runs once on mount; deliberately does NOT depend on
  // anything else, since it should only ever fire for the initial page
  // load's own session check, not re-run every time some unrelated piece
  // of state changes.
  useEffect(() => {
    (async () => {
      const { user, data } = await fetchGoogleSession();
      if (user) {
        setAccount({ user });
        applyAccountData(data, {
          setTheme,
          setActiveProfile,
          setSelectedClasses,
          setOverrides,
          setExtraClasses,
          setActivities,
          setLinkedSync,
        });
      }
      setAuthChecked(true);
    })();
  }, []);

  // Fires once GIS hands back a signed JWT credential from the rendered
  // "Sign in with Google" button (see the Settings-menu JSX below) —
  // exchanges it for a real session, then either applies the account's
  // existing data (a returning student signing in on a new device) or
  // uploads this device's current data as the account's starting point (a
  // brand-new account, "migrate it to your account" per the original
  // request).
  const handleGoogleCredential = useCallback(
    async (credential) => {
      try {
        const localData = buildAccountSyncPayload(activeProfile, {
          selectedClasses,
          overrides,
          extraClasses,
          activities,
          linkedSync,
        });
        const { user, data, isNewAccount } = await exchangeGoogleCredential(credential, localData);
        justSignedInRef.current = true;
        setAccount({ user });
        if (!isNewAccount) {
          applyAccountData(data, {
            setTheme,
            setActiveProfile,
            setSelectedClasses,
            setOverrides,
            setExtraClasses,
            setActivities,
            setLinkedSync,
          });
        }
        setAccountNotice({
          state: 'signed-in',
          message: isNewAccount
            ? `Signed in as ${user.name} — this device's classes are now saved to your account.`
            : `Signed in as ${user.name} — your saved classes have been loaded.`,
        });
        setSettingsOpen(false);
      } catch (err) {
        console.error('Google sign-in failed:', err);
        setAccountNotice({ state: 'error', message: 'Sign-in failed — please try again.' });
      }
    },
    [activeProfile, selectedClasses, overrides, extraClasses, activities, linkedSync]
  );

  const handleGoogleSignOut = useCallback(async () => {
    disableGoogleAutoSelect();
    await logoutGoogleServer();
    setAccount(null);
    setSettingsOpen(false);
  }, []);

  // FAST NU student emails (k<YY><NNNN>@nu.edu.pk) encode the student's own
  // roll number directly — auto-link the Main profile to it the moment a
  // sign-in with one of these addresses actually completes (2026-09-16, on
  // request: "if the login has k(Roll-No)@nu.edu.pk in it then make it so it
  // automatically syncs to roll no"). Gated on `justSignedInRef` (set in
  // `handleGoogleCredential` above) rather than running on every `account`
  // change, so this only fires for a real, explicit sign-in action — not the
  // silent session-restore on every page load (the mount effect above), which
  // would otherwise fight a student who'd deliberately cancelled the sync
  // since their last sign-in.
  //
  // Deliberately a separate effect watching BOTH `account` and
  // `activeProfile` rather than running this logic directly inline in
  // `handleGoogleCredential`, to dodge a real race: for a RETURNING account,
  // `applyAccountData` above may itself call `setActiveProfile` from the
  // account's own stored `activeProfile` — reading the `activeProfile`
  // closure variable synchronously inside `handleGoogleCredential` would see
  // the OLD value, since that setState call hasn't committed yet at that
  // point. This effect instead re-runs once both updates land in the same
  // commit, so `activeProfile` here is always the truly current value.
  //
  // **Always targets the Main profile specifically, never whichever profile
  // tab happens to be active** — same convention push notifications and the
  // calendar feed already use for "the signed-in student's own schedule."
  // Written straight to Main's own storage key so it applies even when Main
  // isn't the currently active profile (picked up next time it's switched to
  // or the page reloads, via the existing `getSavedSync`/resolve-effect
  // path); also pushed into live `linkedSync` state when Main IS active, so
  // the resolve effect (`getClassesForRollNo` above) picks it up and
  // populates the grid immediately instead of only on next switch/reload. A
  // fresh `{ type: 'rollno', value }` (no `lastLive`) deliberately overrides
  // whatever Main was previously linked to, or not linked to at all —
  // signing in with a real FAST NU email is a stronger, more authoritative
  // signal of exactly which roll number this student is than any prior
  // manual link, on this device or a previously synced one.
  useEffect(() => {
    if (!justSignedInRef.current || !account) return;
    justSignedInRef.current = false;
    const rollNo = getRollNoFromNuEmail(account.user.email);
    if (!rollNo) return;
    const autoSync = { type: 'rollno', value: rollNo };
    try {
      localStorage.setItem(getSyncStorageKey('main'), JSON.stringify(autoSync));
    } catch {
      /* storage unavailable — the live state update below still covers this tab */
    }
    if (activeProfile === 'main') {
      setLinkedSync(autoSync);
    }
  }, [account, activeProfile]);

  // Keeps the account's synced data current: whenever anything that
  // `buildAccountSyncPayload` covers changes while signed in, re-uploads
  // the full payload (debounced by comparing against the last-synced JSON,
  // same technique already used for the calendar-feed and push-
  // notification resyncs elsewhere in this app) — this is what makes
  // syncing mean "any change on any signed-in device reaches every other
  // one," not just a one-time import at sign-in.
  const lastAccountSyncRef = useRef(null);
  useEffect(() => {
    if (!account) {
      lastAccountSyncRef.current = null;
      return;
    }
    const payload = buildAccountSyncPayload(activeProfile, {
      selectedClasses,
      overrides,
      extraClasses,
      activities,
      linkedSync,
    });
    const serialized = JSON.stringify(payload);
    if (serialized === lastAccountSyncRef.current) return;
    lastAccountSyncRef.current = serialized;
    pushAccountSync(payload);
  }, [account, activeProfile, selectedClasses, overrides, extraClasses, activities, linkedSync, theme]);

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

  // Auto-prune "Adjust class times" overrides for a course+section the
  // student no longer has selected (2026-09-10, on request) — an override
  // keyed to a course that's since been deselected is dead weight: it can
  // never show up in the "Adjust class times" list any more (that list is
  // built from `selectedClasses`), but it silently persists in storage and
  // would spring back to life if the exact same course+section were ever
  // reselected later, moving it to wherever it was left with no visible
  // explanation. `selectedClasses.includes(...)` reuses the identical
  // "Course - Section" membership check already used everywhere else in
  // this codebase (schedule.js), so no new normalization logic is needed.
  useEffect(() => {
    setOverrides((prev) => {
      const next = prev.filter((o) => selectedClasses.includes(`${o.course} - ${o.section}`));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedClasses]);

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
  // re-resolves it against the current data. `null` from
  // getClassesForRollNo/getClassesForSection means the relevant data
  // source isn't loaded yet (skip — don't wipe the selection over a
  // transient gap); `[]` means it loaded and this roll no/section
  // genuinely has zero classes right now, which is a real state to apply.
  //
  // **Additive/subtractive, not a destructive full replace (2026-09-10, on
  // request: "Add courses should not De-Sync the roll-no. added courses
  // should be synced to roll no and removed courses should be removed")**
  // — the very first time a given sync target is resolved (a fresh pick,
  // or `linkedSync.lastLive` is missing because it predates this design),
  // `selectedClasses` is fully replaced with `live` and that snapshot is
  // remembered as `linkedSync.lastLive`. Every resolve *after* that only
  // applies the DIFF between the new `live` and the remembered
  // `lastLive` — courses the university added since last time get added,
  // courses the university dropped get removed — on top of whatever
  // `selectedClasses` currently is, rather than discarding it. This is
  // what lets a student freely add a course (via the "Search courses"
  // popup, no longer cancelling sync — see `openCourseSearch`,
  // `ClassSelector.jsx`) or remove one (via a "Selected courses" chip) and
  // have that survive the next resync: neither action is itself part of
  // `live` vs `lastLive`, so the diff never touches it. `lastLive` is
  // stored *inside* `linkedSync` (persisted the same way `linkedSync`
  // already is, per profile) specifically so this survives a page reload
  // too, not just the current tab session — without it, reloading would
  // have no memory of "what was official last time" and would fall back
  // to a full replace, silently discarding any manual additions/removals
  // made in a previous session.
  //
  // **Re-resolves on actual sheet content changing, not merely "a fetch
  // happened" (2026-09-10, on request: resync "when it is changed by me in
  // spreadsheet," not "when it is taken from spread sheet")** — depends on
  // `timetableHash`/`rollNumbersHash` (below) rather than `timetableData`
  // itself: `timetableData` gets a brand-new object reference on every
  // fetch (hourly auto-refresh included) even when the sheet's actual rows
  // are byte-identical, which would otherwise re-run this effect on every
  // routine refetch for no reason. Reads `timetableData` through a ref
  // instead of a dependency — the ref is intentionally not itself a
  // trigger, the hashes are. This effect also calls `setLinkedSync` itself
  // (to update `lastLive`), which re-triggers it once more via the
  // `linkedSync` dependency — that second pass finds `live` already equal
  // to the just-stored `lastLive`, computes an empty diff, and returns
  // without looping further.
  useEffect(() => {
    const data = timetableDataRef.current;
    if (!data || !linkedSync) return;
    const live =
      linkedSync.type === 'rollno'
        ? getClassesForRollNo(data, linkedSync.value)
        : getClassesForSection(data, linkedSync.value);
    if (live === null) return;

    if (linkedSync.lastLive === undefined) {
      setSelectedClasses(live);
      setLinkedSync({ ...linkedSync, lastLive: live });
      return;
    }

    const prevLive = linkedSync.lastLive;
    const addedByUniversity = live.filter((c) => !prevLive.includes(c));
    const removedByUniversity = prevLive.filter((c) => !live.includes(c));
    if (addedByUniversity.length === 0 && removedByUniversity.length === 0) return;

    setSelectedClasses((prev) => {
      const next = prev.filter((c) => !removedByUniversity.includes(c));
      addedByUniversity.forEach((c) => {
        if (!next.includes(c)) next.push(c);
      });
      return next;
    });
    setLinkedSync({ ...linkedSync, lastLive: live });
  }, [timetableHash, rollNumbersHash, activeProfile, linkedSync]);

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
      usedRealDataRef.current = true;
      setTimetableData(data);
      saveCachedTimetableSnapshot(data);
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

  // A genuinely FIRST-EVER open (no localStorage cache yet, so `status`
  // started 'loading' above) falls back to a small build-time snapshot
  // (`public/timetable-snapshot.json`, regenerated by every production
  // build — see scripts/generate-timetable-snapshot.mjs) instead of
  // sitting on the loading skeleton for the real fetch's full multi-
  // request round trip (2026-09-15, on request: "make it so the pwa...
  // opens instant and shows timetable without any delay"). This is a
  // SEPARATE mechanism from the localStorage cache above — that one only
  // helps a RETURNING visit; this one is what makes the very first install
  // fast too. `usedRealDataRef` (set synchronously the instant `getData`'s
  // real fetch actually succeeds, not via a state read that could still be
  // one render behind) is the race guard: if the real, live fetch already
  // won by the time this resolves, the stale bootstrap snapshot is
  // silently discarded rather than clobbering fresher real data — and even
  // in the rare case this loses that race anyway, the next real fetch
  // self-corrects within a render or two, same as any other stale-briefly
  // cache in this app. Deliberately does NOT write to
  // `cachedTimetableData` — only the real fetch is trusted to update that,
  // so `lastUpdated` never claims a bootstrap snapshot's build time is
  // "when this was last refreshed."
  const usedRealDataRef = useRef(false);
  useEffect(() => {
    if (hasDataRef.current) return; // a localStorage cache already covered this
    fetch('/timetable-snapshot.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((snapshot) => {
        if (!snapshot || usedRealDataRef.current) return;
        if (!Array.isArray(snapshot.timetable) || snapshot.timetable.length === 0) return;
        setTimetableData(snapshot);
        setStatus('ready');
      })
      .catch(() => {
        /* no snapshot shipped with this build, or offline before even that
           could load — the normal loading-skeleton/error path still covers
           it via the real fetch above */
      });
  }, []);

  // Refetch the instant real connectivity returns (2026-09-14, on request:
  // the timetable data should work fully offline — via the localStorage
  // snapshot hydration in `timetableData`'s own initial state above — "and
  // updates normally as it gets online"). Without this, a device that went
  // offline mid-session would otherwise just sit on stale data until the
  // next hourly `REFRESH_INTERVAL_MS` tick or a manual Refresh press, which
  // could be up to an hour of staleness for something that's actually
  // available again immediately. `navigator.onLine` flipping to `true`
  // doesn't guarantee the network is fully usable yet (a captive portal,
  // say) — `getData()` already handles a still-failing fetch gracefully
  // (keeps showing cached data, flags `refreshError`), so firing eagerly
  // here is safe even if the "online" event fires a beat early.
  useEffect(() => {
    window.addEventListener('online', getData);
    return () => window.removeEventListener('online', getData);
  }, [getData]);

  // "Install app" card's button — shows Chrome/Edge/Android's native install
  // dialog using the stashed `beforeinstallprompt` event. A captured event
  // can only be prompted once; if the student dismisses it, `installPrompt`
  // is cleared (the browser won't refire `beforeinstallprompt` for the same
  // page load) and the card falls back to its "not available in this
  // browser session" copy rather than showing a dead button. Accepting
  // doesn't need to touch `showInstallCard` here — the `appinstalled`
  // listener above handles hiding the card once the install actually
  // completes, which is the more reliable signal than the prompt's own
  // "accepted" outcome (a user can accept the dialog and still have the
  // install itself fail).
  const handleInstallClick = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  // Reset every "Adjust class times" override — across ALL profiles, not
  // just whichever one is currently open — the moment the master sheet's
  // own content genuinely changes (2026-09-10, on request). An override is
  // a correction against the OLD official schedule ("my class moved to X
  // because the shared sheet hasn't caught up yet"); once the sheet DOES
  // change, a stale override could now be moving an already-correct class
  // to the wrong place instead. Deliberately keyed off the data's own
  // content via `hashContent`, not merely "a fetch happened" — the hourly
  // auto-refresh above re-fetches identical data far more often than the
  // sheet actually changes, and resetting on every routine refetch would
  // silently wipe a student's real, still-valid overrides. The very first
  // time this check ever runs (no stored signature yet) just records it
  // without resetting anything, so shipping this doesn't wipe existing
  // overrides for everyone already using the app.
  useEffect(() => {
    if (!timetableData?.timetable) return;
    const signature = hashContent(timetableData.timetable);
    let stored;
    try {
      stored = localStorage.getItem(TIMETABLE_SIGNATURE_KEY);
    } catch {
      return;
    }
    if (stored === signature) return;
    try {
      localStorage.setItem(TIMETABLE_SIGNATURE_KEY, signature);
      if (stored !== null) {
        ALL_OVERRIDE_PROFILES.forEach((profile) => localStorage.removeItem(getOverrideStorageKey(profile)));
      }
    } catch {
      /* storage unavailable */
    }
    if (stored !== null) setOverrides([]);
  }, [timetableData]);

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
  const canSyncCalendar = status === 'ready';

  // Sessional-1 seatings — opening the modal is what triggers the (lazy,
  // one-time) fetch; a second open just reopens against the already-fetched
  // `sessional1Entries`, no refetch. Deliberately reads `selectedClasses`
  // (whichever profile is CURRENTLY ACTIVE), same as the main Print button
  // above operates on whatever's on screen right now — not forced to Main
  // like notifications/the calendar feed, since this isn't a background
  // sync, it's "show me my seating for what I'm looking at."
  const openSessional1 = useCallback(async () => {
    setSessional1Open(true);
    if (sessional1Entries !== null) return;
    setSessional1Status('loading');
    try {
      const url = await getSessional1Url();
      if (!url) {
        setSessional1Status('error');
        return;
      }
      const entries = await fetchSessional1(url);
      setSessional1Entries(entries);
      setSessional1Status('ready');
    } catch (err) {
      console.error('Failed to load Sessional-1 data:', err);
      setSessional1Status('error');
    }
  }, [sessional1Entries]);

  // Only classes with a real Sessional-1 match, in exam chronological order
  // — not course-name/selection order (2026-09-18, on request: "the
  // courses which data is not found should not show... make it so the
  // exam is in order not course name order, time order").
  const sessional1Matches = useMemo(() => {
    if (!sessional1Entries) return [];
    return getSessional1Schedule(sessional1Entries, selectedClasses);
  }, [sessional1Entries, selectedClasses]);

  // Own dedicated html2canvas capture (separate ref/target from the main
  // weekly-grid export above) — the modal's content is portaled to
  // `document.body` via `Modal`, so it needs its own ref rather than
  // reusing `captureRef`, which stays pointed at the grid.
  const handleSessional1Print = useCallback(async () => {
    const element = sessional1CaptureRef.current;
    if (!element || sessional1Exporting) return;
    setSessional1Exporting(true);
    try {
      await document.fonts?.ready;
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: surface || '#ffffff' });
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png', 0.95);
      link.download = `Sessional1-Seatings_${stamp}.png`;
      link.click();
    } catch (err) {
      console.error('Sessional-1 print failed:', err);
    } finally {
      setSessional1Exporting(false);
    }
  }, [sessional1Exporting]);

  // Available through the last exam day (Wed 23 Sep 2026), then hides
  // itself automatically the next day — no code change needed to "turn it
  // off." Uses the existing `now` ticker (already re-rendered every 60s
  // for the header's "synced Xm ago" text), so it genuinely disappears at
  // midnight without needing a page reload. Karachi has no DST, fixed +5h
  // year-round — same fact the server-side notification math already
  // relies on (see notifyLogic.js).
  const SESSIONAL1_CUTOFF_MS = useMemo(() => new Date('2026-09-24T00:00:00+05:00').getTime(), []);
  const sessional1WindowActive = now < SESSIONAL1_CUTOFF_MS;

  // null | { state: 'success' | 'empty' | 'error' }
  const [calendarNotice, setCalendarNotice] = useState(null);
  const [calendarSyncing, setCalendarSyncing] = useState(false);

  // Always syncs the MAIN profile's schedule (not whichever profile tab is
  // currently open) — same convention push notifications already use, and
  // what the auto-resync tick in useClassNotifications keeps updated
  // afterward, so the two never disagree about which schedule is "the" one
  // being synced. See src/utils/calendarExport.js for the full design.
  const handleAddToCalendar = useCallback(async () => {
    setCalendarSyncing(true);
    try {
      const id = getOrCreateCalendarFeedId();
      if (!id) {
        setCalendarNotice({ state: 'error' });
        return;
      }
      const { selectedClasses: mainClasses, overrides: mainOverrides } = getMainSchedule();
      if (mainClasses.length === 0) {
        setCalendarNotice({ state: 'empty' });
        return;
      }
      const ok = await pushCalendarSchedule(id, { selectedClasses: mainClasses, overrides: mainOverrides });
      if (!ok) {
        setCalendarNotice({ state: 'error' });
        return;
      }
      openGoogleCalendarSubscribePrompt(id);
      setCalendarNotice({ state: 'success', url: getCalendarFeedUrl(id) });
    } finally {
      setCalendarSyncing(false);
    }
  }, []);

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
                      setSettingsOpen(false);
                      handleAddToCalendar();
                    }}
                    disabled={!canSyncCalendar || calendarSyncing}
                  >
                    <IconCalendar size={16} />
                    <span>
                      {calendarSyncing ? 'Syncing…' : 'Sync to Google Calendar'}
                      <small>No login needed — set up once, stays in sync</small>
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

                  {/* The sign-IN prompt itself now lives in its own top-of-page banner
                      (see "signin-banner" above the disclaimer, 2026-09-15) — this stays
                      only for managing an ALREADY-signed-in account (identity + sign out),
                      so there's nothing to show here at all while signed out. */}
                  {authChecked && account && (
                    <>
                      <div className="menu-item menu-item-static" role="none">
                        {account.user.picture ? (
                          <img src={account.user.picture} alt="" className="menu-avatar" referrerPolicy="no-referrer" />
                        ) : (
                          <IconUser size={16} />
                        )}
                        <span>
                          {account.user.name}
                          <small>Classes sync automatically across your devices</small>
                        </span>
                      </div>
                      <button type="button" role="menuitem" className="menu-item" onClick={handleGoogleSignOut}>
                        <IconLogOut size={16} />
                        <span>Sign out</span>
                      </button>
                      <div className="menu-divider" role="separator" />
                    </>
                  )}

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
                <span>
                  {isOffline
                    ? "You're offline — showing your last saved schedule. It'll update automatically once you're back online."
                    : 'Couldn’t refresh just now — showing the last loaded data.'}
                </span>
                {!isOffline && (
                  <button type="button" className="link-button" onClick={getData}>
                    Retry
                  </button>
                )}
              </div>
            )}

            {calendarNotice?.state === 'success' && (
              <div className="alert-bar alert-bar-info no-print" role="status">
                <IconCalendar size={15} />
                <span>
                  A Google Calendar tab should have opened asking you to add your timetable — click{' '}
                  <strong>Add</strong> there. It&rsquo;ll then stay in sync automatically from now on,
                  including future changes to your Main profile — no need to press this again. If no tab
                  opened (a popup blocker can block it),{' '}
                  <button
                    type="button"
                    className="link-button-inline"
                    onClick={() => navigator.clipboard?.writeText(calendarNotice.url)}
                  >
                    copy the calendar link
                  </button>{' '}
                  and add it yourself in Google Calendar &rarr; Other calendars &rarr; From URL.
                </span>
                <button type="button" className="link-button" onClick={() => setCalendarNotice(null)}>
                  Got it
                </button>
              </div>
            )}

            {calendarNotice?.state === 'empty' && (
              <div className="alert-bar no-print" role="status">
                <IconAlert size={15} />
                <span>
                  Your Main profile has no classes selected yet — switch to the Main profile, pick your
                  classes, then press Calendar again.
                </span>
                <button type="button" className="link-button" onClick={() => setCalendarNotice(null)}>
                  Got it
                </button>
              </div>
            )}

            {calendarNotice?.state === 'error' && (
              <div className="alert-bar no-print" role="status">
                <IconAlert size={15} />
                <span>Couldn&rsquo;t set up calendar sync just now — check your connection and try again.</span>
                <button type="button" className="link-button" onClick={() => setCalendarNotice(null)}>
                  Dismiss
                </button>
              </div>
            )}

            {accountNotice && (
              <div
                className={`alert-bar no-print ${accountNotice.state === 'signed-in' ? 'alert-bar-info' : ''}`}
                role="status"
              >
                {accountNotice.state === 'signed-in' ? <IconUser size={15} /> : <IconAlert size={15} />}
                <span>{accountNotice.message}</span>
                <button type="button" className="link-button" onClick={() => setAccountNotice(null)}>
                  Got it
                </button>
              </div>
            )}

            {/* Sign-in prompt moved here from inside the Settings menu (2026-09-15, on
                request: "make the sign in appear at top in beginning") — the very first
                thing on the page, above even the disclaimer, while signed out; hides
                itself the moment `account` is set, same "stays up until done, no manual
                dismiss" pattern as the install-app card below. Once signed in, account
                status/sign-out stays in the Settings menu — this banner's only job is the
                initial prompt, not ongoing account management. `authChecked` gates it so
                it doesn't flash for the ~one network round trip the initial session check
                takes on every load. */}
            {authChecked && !account && (
              <section className="card signin-banner no-print" aria-label="Sign in with Google">
                <IconUser size={16} className="signin-banner-icon" />
                <span className="signin-banner-text">Sign in to sync your classes across devices</span>
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              </section>
            )}

            {/* Shown in place of the login banner once signed in with anything OTHER
                than a FAST NU student email (2026-09-16, on request: "the ones loging
                in from other emails should always have message at top(in place of
                login)") — `isNuEmail`/`getRollNoFromNuEmail` (utils/nuEmail.js) parse
                the "k<YY><NNNN>@nu.edu.pk" format FAST NU issues, which also encodes
                the student's own roll number (see the auto-sync effect below). A real
                FAST NU email hides this AND the login banner entirely — from then on,
                account state lives only in the Settings menu (identity + sign out),
                same "login goes to settings" pattern as any other signed-in account. */}
            {authChecked && account && !isNuEmail(account.user.email) && (
              <section
                className="card signin-banner signin-banner-warning no-print"
                aria-label="Signed in with a non-FAST-NU email"
              >
                <IconAlert size={16} className="signin-banner-icon" />
                <span className="signin-banner-text">Login from FAST NU Email</span>
              </section>
            )}

            {/* Moved here from ClassSelector.jsx (2026-09-14, on request: "disclamer
                should be above download") — the install card sits between this and
                "My classes," so the disclaimer had to move up a level to stay above it. */}
            <div className="data-disclaimer no-print" role="note">
              <IconAlert size={15} />
              <span>
                This is an unofficial tool maintained independently by a student. Since data is
                updated manually, please cross-verify your schedule with official university
                announcements.
              </span>
            </div>

            {/* Sessional-1 seatings (added 2026-09-18, on request: "make an option of
                print Sessional-1 Seatings which gives timetable of selected courses" —
                placed "below disclaimer", per the same request). Time-boxed on purpose
                ("it will be avalible till 23 sept wednesday, after wednesday it will
                dissapear") via `sessional1WindowActive` — no manual cleanup needed once
                exams are over, it just stops rendering on its own past the cutoff. */}
            {sessional1WindowActive && (
              <section className="card signin-banner no-print" aria-label="Sessional-1 exam seatings">
                <IconPrinter size={16} className="signin-banner-icon" />
                <span className="signin-banner-text">Sessional-1 exams: Sat 19 – Wed 23 Sep</span>
                <button type="button" className="btn btn-primary install-card-btn" onClick={openSessional1}>
                  Print Sessional-1 Seatings
                </button>
              </section>
            )}

            {sessional1Open && (
              <Modal title="Sessional-1 Seatings" onClose={() => setSessional1Open(false)}>
                <div className="sessional1-modal-body">
                  {sessional1Status === 'loading' && <p className="sessional1-status">Loading Sessional-1 schedule…</p>}
                  {sessional1Status === 'error' && (
                    <p className="sessional1-status">
                      Couldn&rsquo;t load the Sessional-1 schedule right now — check your connection and try
                      again.
                    </p>
                  )}
                  {sessional1Status === 'ready' && (
                    <>
                      <div ref={sessional1CaptureRef} className="sessional1-capture">
                        <h4 className="sessional1-capture-title">Sessional-1 Seatings</h4>
                        {sessional1Matches.length === 0 ? (
                          <p className="sessional1-status">
                            {selectedClasses.length === 0
                              ? 'No classes selected yet — pick your courses first, then reopen this.'
                              : 'None of your selected courses have a Sessional-1 exam on record.'}
                          </p>
                        ) : (
                          <table className="sessional1-table">
                            <thead>
                              <tr>
                                <th aria-hidden="true"></th>
                                <th>Course</th>
                                <th>Section</th>
                                <th>Day &amp; Date</th>
                                <th>Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sessional1Matches.map((m) => (
                                <tr key={m.classKey}>
                                  <td>
                                    <span
                                      className="sessional1-color-dot"
                                      style={{ backgroundColor: courseColors[m.course] || '#64748b' }}
                                    />
                                  </td>
                                  <td>{m.course}</td>
                                  <td>{m.section}</td>
                                  <td>
                                    {m.entry.day}, {m.entry.date}
                                  </td>
                                  <td>{m.entry.time}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary sessional1-print-btn"
                        onClick={handleSessional1Print}
                        disabled={sessional1Exporting || sessional1Matches.length === 0}
                      >
                        <IconPrinter size={16} />
                        {sessional1Exporting ? 'Printing…' : 'Print / Download'}
                      </button>
                    </>
                  )}
                </div>
              </Modal>
            )}

            {showInstallCard && (
              <section className="card install-card no-print" aria-label="Install the app">
                <IconDownload size={16} className="install-card-icon" />
                {isIOS() ? (
                  <span className="install-card-text">
                    Tap Share, then <strong>Add to Home Screen</strong>
                  </span>
                ) : (
                  <>
                    <span className="install-card-text">Install for quick access</span>
                    <button
                      type="button"
                      className="btn btn-primary install-card-btn"
                      onClick={handleInstallClick}
                      disabled={!installPrompt}
                      title={!installPrompt ? 'Not available in this browser session yet' : undefined}
                    >
                      Install
                    </button>
                  </>
                )}
              </section>
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
