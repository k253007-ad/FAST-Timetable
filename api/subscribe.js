// Saves (or updates, or removes) one browser's push subscription + its
// current Main-profile schedule — called from the client whenever the user
// turns on push notifications, and again whenever their Main-profile
// selection/overrides/extras/activities change, so the server's copy never
// goes stale. See api/_lib/subscriptionStore.js for where this actually
// lives, and api/notify-tick.js for what reads it back.

import { deleteSubscriber, getSubscriber, saveSubscriber, subscriberId } from './_lib/subscriptionStore.js';

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

  const { subscription, unsubscribe } = body || {};
  if (!subscription?.endpoint) {
    res.status(400).json({ error: 'Missing subscription.endpoint' });
    return;
  }

  const id = subscriberId(subscription.endpoint);

  if (unsubscribe) {
    await deleteSubscriber(id);
    res.status(200).json({ ok: true, unsubscribed: true });
    return;
  }

  const { selectedClasses = [], overrides = [], extraClasses = [], activities = [] } = body;

  // Preserve the existing notifiedState (dedup bookkeeping) across a
  // schedule update — a course being added/removed shouldn't reset which
  // checkpoints have already fired for sessions that are still current.
  const existing = await getSubscriber(id);

  await saveSubscriber(id, {
    subscription,
    selectedClasses,
    overrides,
    extraClasses,
    activities,
    notifiedState: existing?.notifiedState ?? null,
  });

  res.status(200).json({ ok: true });
}
