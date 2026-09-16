// POST { credential, localData? } -- the client's Google Identity Services
// sign-in callback hands us a signed ID token JWT ("credential"); this
// verifies it really came from Google and matches our own OAuth client,
// then creates or resolves the account and starts a session.
//
// Verification uses Google's own tokeninfo endpoint
// (https://oauth2.googleapis.com/tokeninfo?id_token=...) rather than a JWT
// library + JWKS fetch/cache — this project already avoids adding
// dependencies where a plain `fetch` will do (see subscriptionStore.js's
// KV-via-REST-API pattern for the same philosophy), and tokeninfo is
// Google's own documented method for exactly this. It decodes and verifies
// the token's SIGNATURE and expiry for us, but does NOT check the
// audience — that's the caller's job below (`aud !== GOOGLE_CLIENT_ID` is
// checked explicitly), since skipping it would let a valid ID token issued
// to some OTHER app impersonate a user here.
//
// Account data model: one record per Google account (keyed by the token's
// stable `sub` claim, never the email — Google explicitly documents email
// as not guaranteed stable/unique long-term, sub is), holding a full
// mirror of everything this device would otherwise keep in localStorage —
// see accountStore.js's own doc comment and the "Google accounts" section
// of the workspace-root CLAUDE.md for the exact shape and why.

import { getAccount, saveAccount, createSession } from './_lib/accountStore.js';
import { setSessionCookie } from './_lib/cookies.js';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches accountStore's session TTL

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { credential, localData } = req.body || {};
  if (typeof credential !== 'string' || !credential) {
    res.status(400).json({ error: 'Missing credential' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('auth-google: GOOGLE_CLIENT_ID is not configured');
    res.status(500).json({ error: 'Google sign-in is not configured on the server yet' });
    return;
  }

  let claims;
  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!verifyRes.ok) {
      res.status(401).json({ error: 'Invalid or expired Google credential' });
      return;
    }
    claims = await verifyRes.json();
  } catch (err) {
    console.error('auth-google: token verification request failed', err);
    res.status(502).json({ error: 'Could not verify Google credential right now' });
    return;
  }

  if (claims.aud !== clientId) {
    // Either a token minted for a different app entirely, or GOOGLE_CLIENT_ID
    // and VITE_GOOGLE_CLIENT_ID have drifted out of sync (they must be the
    // exact same value — see .env.example).
    console.error('auth-google: audience mismatch', { expected: clientId, got: claims.aud });
    res.status(401).json({ error: 'Credential was not issued for this app' });
    return;
  }
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    res.status(401).json({ error: 'Google account email is not verified' });
    return;
  }

  const googleId = claims.sub;
  const profile = {
    email: claims.email,
    name: claims.name || claims.email,
    picture: claims.picture || null,
  };

  let account = await getAccount(googleId);
  let isNewAccount = false;

  if (!account) {
    // First sign-in for this Google account anywhere — migrate whatever
    // this device currently has locally into the new account, exactly as
    // requested ("migrate it to your account"). `localData` is trusted only
    // as the STARTING point for a brand-new account, never used to
    // overwrite an account that already exists (see the branch below) --
    // that's what makes signing in on a SECOND device correctly pull down
    // the account's real data instead of clobbering it with that device's
    // own, separate local state.
    isNewAccount = true;
    account = { profile, data: localData || null, updatedAt: Date.now() };
  } else {
    // Returning sign-in (possibly on a new device) -- refresh the cached
    // profile fields (name/picture can change on Google's side) but the
    // synced `data` is left untouched here; the client applies it after
    // this response, it does not need re-saving right back.
    account = { ...account, profile };
  }

  await saveAccount(googleId, account);
  const token = await createSession(googleId);
  setSessionCookie(res, token, SESSION_MAX_AGE_SECONDS);

  res.status(200).json({ user: profile, data: account.data, isNewAccount });
}
