// Storage for "Sync to Google Calendar" live feed subscriptions — one record
// per browser, `{ selectedClasses, overrides }`, keyed by a random id the
// client generates once and keeps in localStorage (`calendarFeedId`, see
// src/utils/calendarExport.js). Deliberately separate from
// subscriptionStore.js (push notifications) — a student can use this feature
// without ever granting notification permission or having a push
// subscription at all.
//
// Same Vercel KV REST API / in-memory-Map-fallback pattern as
// subscriptionStore.js (kept as its own small copy rather than a shared
// import, matching this project's one-store-per-file convention) — see that
// file for the production caveat: the in-memory fallback only survives a
// single serverless invocation, so a real KV store must be provisioned
// before this is relied on in production.

const memoryStore = new Map();

const hasKv = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function kvCommand(...args) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (data.error) throw new Error(`KV command failed: ${data.error}`);
  return data.result;
}

export const getCalendarFeed = async (id) => {
  if (hasKv()) {
    const raw = await kvCommand('GET', `calfeed:${id}`);
    return raw ? JSON.parse(raw) : null;
  }
  return memoryStore.get(id) || null;
};

export const saveCalendarFeed = async (id, record) => {
  if (hasKv()) {
    await kvCommand('SET', `calfeed:${id}`, JSON.stringify(record));
    return;
  }
  memoryStore.set(id, record);
};
