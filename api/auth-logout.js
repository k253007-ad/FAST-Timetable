// POST -- ends the current session (deletes the server-side session
// record and clears the cookie). Does NOT delete the account or its
// synced data -- signing back in later resumes exactly where it left off.

import { deleteSession } from './_lib/accountStore.js';
import { readSessionCookie, clearSessionCookie } from './_lib/cookies.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = readSessionCookie(req);
  await deleteSession(token);
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
