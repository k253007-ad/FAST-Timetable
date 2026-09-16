// GET -- reads the session cookie (if any) and returns the signed-in
// user's profile + synced account data, or `{ user: null }` if there's no
// valid session. Called once on app mount to restore a signed-in state
// without the student having to click "Sign in with Google" again on a
// returning visit.

import { getSessionGoogleId, getAccount } from './_lib/accountStore.js';
import { readSessionCookie } from './_lib/cookies.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = readSessionCookie(req);
  const googleId = await getSessionGoogleId(token);
  if (!googleId) {
    res.status(200).json({ user: null });
    return;
  }

  const account = await getAccount(googleId);
  if (!account) {
    // Session outlived the account somehow (shouldn't normally happen) --
    // treat as signed out rather than erroring.
    res.status(200).json({ user: null });
    return;
  }

  res.status(200).json({ user: account.profile, data: account.data });
}
