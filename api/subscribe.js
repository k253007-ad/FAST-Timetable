// Saves (or updates, or removes) one browser's push subscription + its
// current Main-profile schedule — called from the client whenever the user
// turns on push notifications, and again whenever their Main-profile
// selection/overrides/extras/activities change, so the server's copy never
// goes stale. See api/_lib/subscriptionStore.js for where this actually
// lives, and api/notify-tick.js for what reads it back.
//
// Also handles subscription MIGRATION (added 2026-09-02): browsers
// occasionally rotate a device's push subscription entirely (a new
// endpoint replaces the old one) — Chrome does this periodically for
// security, and it can happen at any time, including while the app is
// fully closed. The service worker's `pushsubscriptionchange` handler
// (public/sw.js) reacts to this by calling here with `{ subscription:
// <new>, oldEndpoint: <old endpoint string> }` and nothing else, since a
// service worker has no access to the page's localStorage to resend the
// actual schedule. When `oldEndpoint` is present, this endpoint carries the
// old record's schedule + notifiedState over to the new one and deletes the
// stale entry — without this, a rotated subscription would silently stop
// receiving anything until the user happened to reopen the app.

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

  const { subscription, unsubscribe, oldEndpoint } = body || {};
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

  const oldId = oldEndpoint ? subscriberId(oldEndpoint) : null;
  const oldRecord = oldId ? await getSubscriber(oldId) : null;

  const {
    selectedClasses = oldRecord?.selectedClasses ?? [],
    overrides = oldRecord?.overrides ?? [],
    extraClasses = oldRecord?.extraClasses ?? [],
    activities = oldRecord?.activities ?? [],
  } = body;

  // Preserve the existing notifiedState (dedup bookkeeping) across a
  // schedule update — a course being added/removed shouldn't reset which
  // checkpoints have already fired for sessions that are still current.
  // A migration (oldRecord present) carries its notifiedState over too, for
  // the same reason.
  const existing = await getSubscriber(id);

  await saveSubscriber(id, {
    subscription,
    selectedClasses,
    overrides,
    extraClasses,
    activities,
    notifiedState: existing?.notifiedState ?? oldRecord?.notifiedState ?? null,
  });

  if (oldId && oldId !== id) {
    await deleteSubscriber(oldId);
  }

  res.status(200).json({ ok: true });
}
