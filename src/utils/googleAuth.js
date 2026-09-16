// Client-side Google Sign-In (added 2026-09-14, "Google accounts") — uses
// Google Identity Services' (GIS) ID-token flow, not a full server-side
// OAuth redirect: the rendered "Sign in with Google" button itself handles
// the whole popup/redirect dance and hands back a signed JWT ("credential")
// containing the user's identity, which is then POSTed to our own
// api/auth-google.js for verification (Google's tokeninfo endpoint) and
// session creation. This needs only a public OAuth Client ID on the client
// (no client secret ever touches the browser or even this app's server —
// see .env.example's own note on why the traditional server-side flow's
// secret isn't needed here).

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisLoadPromise = null;
const loadGis = () => {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
};

export const isGoogleSignInConfigured = () => Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

// `google.accounts.id.initialize()` is only ever actually called ONCE per
// page load (module-level guard below), never once per call to this
// function — GIS itself warns "initialize() is called multiple times...
// only the last initialized instance will be used" if called repeatedly,
// and in practice a second rapid-fire call was also observed triggering a
// spurious "origin not allowed" 403 even with a correct, already-verified
// origin (found 2026-09-15 while moving the sign-in button to a top-of-page
// banner — React 19 StrictMode double-invokes effects in dev, so
// `GoogleSignInButton`'s effect below called this twice in a row on first
// mount). `latestOnCredential` is kept up to date on every call regardless,
// so the ONE real `initialize()` call's callback always dispatches to
// whichever `onCredential` is current, even across remounts.
let gisInitialized = false;
let latestOnCredential = null;

// `onCredential` is called with the raw JWT string once the student
// actually completes a sign-in via the rendered button below —
// initializing GIS on its own does not sign anyone in.
export const initGoogleSignIn = async (onCredential) => {
  if (!isGoogleSignInConfigured()) return false;
  await loadGis();
  latestOnCredential = onCredential;
  if (!gisInitialized) {
    gisInitialized = true;
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: (response) => latestOnCredential?.(response.credential),
      // Respects an explicit prior "Sign out" — without this, GIS can
      // silently re-sign a returning visitor back in via One Tap even after
      // they deliberately signed out, which would be a confusing surprise.
      auto_select: false,
    });
  }
  return true;
};

export const renderGoogleSignInButton = (el, options = {}) => {
  if (!el || !window.google?.accounts?.id) return;
  window.google.accounts.id.renderButton(el, {
    theme: 'outline',
    size: 'medium',
    type: 'standard',
    text: 'signin_with',
    shape: 'rectangular',
    ...options,
  });
};

// Only clears GIS's own "remember this account for One Tap" state — the
// actual server-side session is ended separately via logoutServer below;
// both are called together on "Sign out" (see App.jsx).
export const disableGoogleAutoSelect = () => {
  window.google?.accounts?.id?.disableAutoSelect();
};

// ---- server calls — all same-origin, `credentials: 'include'` so the
// HttpOnly session cookie set by api/auth-google.js is actually sent back
// on every subsequent request. ----

export const exchangeGoogleCredential = async (credential, localData) => {
  const res = await fetch('/api/auth-google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential, localData }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Google sign-in failed');
  }
  return res.json();
};

export const fetchGoogleSession = async () => {
  try {
    const res = await fetch('/api/auth-session', { credentials: 'include' });
    if (!res.ok) return { user: null };
    return await res.json();
  } catch {
    return { user: null };
  }
};

export const logoutGoogleServer = async () => {
  try {
    await fetch('/api/auth-logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* best-effort — the cookie may already be gone/expired anyway */
  }
};

// Returns whether the push actually reached the server — the caller
// decides what "failed to sync" should look like (silent retry-next-time
// is fine here, same as the existing calendar-feed resync's own philosophy).
export const pushAccountSync = async (data) => {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ data }),
    });
    return res.ok;
  } catch {
    return false;
  }
};
