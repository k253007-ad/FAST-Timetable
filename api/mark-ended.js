// Lets the "End Class" action on a push notification (public/sw.js) tell the
// server to stop reminding about that session immediately, instead of
// waiting for its real scheduled end — the server-side twin of the client
// hook's manualEndedKeyRef. Called from the service worker itself (no page
// needs to be open), which identifies the subscriber by its own push
// subscription endpoint rather than any app-level user id.

import { getSubscriber, saveSubscriber, subscriberId } from './_lib/subscriptionStore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const { endpoint, key } = body || {};
  if (!endpoint || !key) {
    res.status(400).json({ error: 'Missing endpoint or key' });
    return;
  }

  const id = subscriberId(endpoint);
  const subscriber = await getSubscriber(id);
  if (!subscriber) {
    res.status(404).json({ error: 'Unknown subscriber' });
    return;
  }

  const notifiedState = { ...(subscriber.notifiedState || {}), manualEndedKey: key };
  await saveSubscriber(id, { ...subscriber, notifiedState });

  res.status(200).json({ ok: true });
}
