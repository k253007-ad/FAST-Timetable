// The one endpoint an external scheduler (cron-job.org, a GitHub Actions
// cron workflow, etc. — see fastTimetable/CLAUDE.md's push-notifications
// section for why it's external rather than Vercel's own Cron) hits every
// 1-5 minutes to actually deliver push notifications while the app is
// fully closed. For every stored subscriber: rebuild their schedule from
// the live timetable, work out what (if anything) should notify them right
// now via computeNotifications, send it through Web Push, and save their
// updated dedup state back. A subscription the push service reports as
// gone (410/404 — the user uninstalled, cleared data, etc.) is deleted
// rather than retried forever.

import webpush from 'web-push';
import { getSheetData } from './sheetConfig.js';
import { buildTimetableFromMeta } from '../src/services/timetableSource.js';
import { deleteSubscriber, getAllSubscribers, saveSubscriber } from './_lib/subscriptionStore.js';
import { computeNotifications } from './_lib/notifyLogic.js';

const vapidReady = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export default async function handler(req, res) {
  const secret = req.query?.secret || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!vapidReady()) {
    res.status(500).json({ error: 'VAPID keys are not configured on the server.' });
    return;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  let data;
  try {
    const meta = await getSheetData();
    data = await buildTimetableFromMeta(meta);
  } catch (err) {
    res.status(502).json({ error: `Could not load timetable data: ${err.message}` });
    return;
  }

  const subscribers = await getAllSubscribers();
  const now = new Date();
  let sent = 0;
  let removed = 0;
  let errors = 0;

  await Promise.all(
    subscribers.map(async (subscriber) => {
      let result;
      try {
        result = computeNotifications(data, subscriber, subscriber.notifiedState, now);
      } catch (err) {
        console.error(`notify-tick: failed to compute notifications for ${subscriber.id}`, err);
        errors++;
        return;
      }

      const { notifications, nextState } = result;

      // TEMPORARY DEBUG (requested 2026-09-02) — confirms the whole
      // cron -> server -> push -> device pipeline is alive on every tick,
      // independent of whether a real class notification would otherwise
      // fire. Remove this block once push has been confirmed working
      // reliably on a real device: with a 1-5 minute cron schedule, leaving
      // it on means a notification every single tick, forever.
      notifications.push({
        title: 'Notification Working',
        body: `Tick at ${now.toLocaleTimeString('en-US', {
          timeZone: 'Asia/Karachi',
          hour: 'numeric',
          minute: 'numeric',
        })} (Karachi time)`,
        tag: 'debug-heartbeat',
      });

      for (const notification of notifications) {
        try {
          await webpush.sendNotification(subscriber.subscription, JSON.stringify(notification));
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await deleteSubscriber(subscriber.id);
            removed++;
            return; // subscription is gone, no point saving state for it
          }
          console.error(`notify-tick: push failed for ${subscriber.id}`, err.message);
          errors++;
        }
      }

      await saveSubscriber(subscriber.id, { ...subscriber, notifiedState: nextState });
    })
  );

  res.status(200).json({ ok: true, subscribers: subscribers.length, sent, removed, errors });
}
