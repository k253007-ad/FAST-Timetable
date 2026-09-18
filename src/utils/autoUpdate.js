// Auto-refresh when a new Vercel deployment goes out (2026-09-19, on
// request: "make it refresh automatically when new development is made in
// vercel app"). Works by comparing the hashed bundle filename the RUNNING
// page loaded (e.g. /assets/index-AbC123.js) against the one the freshly-
// fetched index.html on the server references — Vite changes that hash on
// every build that changes any code, so a mismatch means a newer deploy.
// On mismatch: drop the service worker's shell cache (otherwise its
// stale-while-revalidate would hand the OLD index.html straight back on
// reload) and reload once. Never runs on localhost/dev (no hashed bundle).
const BUNDLE_RE = /\/assets\/index-[^"'\s]+\.js/;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const runningBundle = () => {
  const el = [...document.scripts].find((s) => BUNDLE_RE.test(s.src));
  return el ? new URL(el.src).pathname : null;
};

const checkForNewBuild = async () => {
  const current = runningBundle();
  if (!current) return;
  try {
    // `__check` param: public/sw.js skips its shell cache for it, so this
    // always reaches the network.
    const res = await fetch(`/index.html?__check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.text()).match(BUNDLE_RE)?.[0];
    if (!latest || latest === current) return;

    // Loop guard: if we already reloaded for this exact target and still
    // aren't on it (e.g. a CDN edge still serving the old file), don't
    // reload again — the next interval check retries.
    if (sessionStorage.getItem('autoUpdateTarget') === latest) return;
    sessionStorage.setItem('autoUpdateTarget', latest);

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('fast-timetable-shell-')).map((k) => caches.delete(k)));
    }
    window.location.reload();
  } catch {
    // offline / storage blocked — try again next interval.
  }
};

export const startAutoUpdate = () => {
  if (!import.meta.env.PROD) return;
  checkForNewBuild();
  setInterval(checkForNewBuild, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewBuild();
  });
};
