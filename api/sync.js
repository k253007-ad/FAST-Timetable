// POST { data } -- overwrites the signed-in account's synced app data.
// Authenticated purely via the session cookie (no request body identifies
// who's writing) so one device can never overwrite another account's data
// by mistake. Last-write-wins: whichever device's sync call reaches the
// server last is authoritative, the same conflict-handling philosophy
// already used elsewhere in this app (e.g. "keep synced" roll no/section
// resolution) rather than a more complex merge -- reasonable for a single
// student's own personal timetable, which is never really edited from two
// devices in the same instant.

import { getSessionGoogleId, getAccount, saveAccount } from './_lib/accountStore.js';
import { readSessionCookie } from './_lib/cookies.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = readSessionCookie(req);
  const googleId = await getSessionGoogleId(token);
  if (!googleId) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const { data } = req.body || {};
  if (data === undefined) {
    res.status(400).json({ error: 'Missing data' });
    return;
  }

  const account = await getAccount(googleId);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await saveAccount(googleId, { ...account, data, updatedAt: Date.now() });
  res.status(200).json({ ok: true });
}
