// Storage for push subscribers — `{ subscription, selectedClasses,
// overrides, extraClasses, activities, notifiedState }` keyed by a hash of
// the subscription's own endpoint (stable per browser+device+origin, so
// re-subscribing the same device overwrites rather than duplicates).
//
// Backed by Vercel KV (Upstash Redis's REST API — a plain `fetch`, no SDK
// dependency needed) when KV_REST_API_URL/KV_REST_API_TOKEN are set;
// otherwise falls back to an in-memory Map. The in-memory path is fine for
// local `npm run dev` testing but MUST NOT be relied on in production — a
// serverless function's memory doesn't persist between invocations (each
// cold start gets a fresh, empty Map), so subscribers would silently
// vanish. Set up a real KV store before deploying this for real.

import crypto from 'node:crypto';

const memoryStore = new Map();

const hasKv = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// Upstash's REST API accepts any Redis command as a JSON array POSTed to
// the base URL — one small helper covers GET/SET/DEL/SADD/SREM/SMEMBERS.
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

export const subscriberId = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');

export const getSubscriber = async (id) => {
  if (hasKv()) {
    const raw = await kvCommand('GET', `subscriber:${id}`);
    return raw ? JSON.parse(raw) : null;
  }
  return memoryStore.get(id) || null;
};

export const saveSubscriber = async (id, record) => {
  if (hasKv()) {
    await kvCommand('SET', `subscriber:${id}`, JSON.stringify(record));
    await kvCommand('SADD', 'subscribers', id);
    return;
  }
  memoryStore.set(id, record);
};

export const deleteSubscriber = async (id) => {
  if (hasKv()) {
    await kvCommand('DEL', `subscriber:${id}`);
    await kvCommand('SREM', 'subscribers', id);
    return;
  }
  memoryStore.delete(id);
};

export const getAllSubscribers = async () => {
  if (hasKv()) {
    const ids = (await kvCommand('SMEMBERS', 'subscribers')) || [];
    if (ids.length === 0) return [];
    const records = await Promise.all(
      ids.map(async (id) => {
        const raw = await kvCommand('GET', `subscriber:${id}`);
        return raw ? { id, ...JSON.parse(raw) } : null;
      })
    );
    return records.filter(Boolean);
  }
  return [...memoryStore.entries()].map(([id, record]) => ({ id, ...record }));
};
