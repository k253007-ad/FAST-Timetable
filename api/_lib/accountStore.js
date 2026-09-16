// Storage for Google-signed-in accounts and their sessions — added
// 2026-09-14 for cross-device sync ("Google login and accounts", on
// request). Same Vercel-KV-via-plain-fetch-with-in-memory-fallback pattern
// as subscriptionStore.js/calendarFeedStore.js — see that file's own doc
// comment for the full reasoning (no SDK dependency, but the in-memory path
// resets on every serverless cold start and MUST NOT be relied on in
// production; a real KV store needs to be created and linked before this
// feature can be trusted with real user data).
//
// Two record types share this one module since they're small and tightly
// coupled: `account:<googleId>` (the actual synced app data + profile
// info) and `session:<token>` (a thin pointer from a random session token,
// set as an HttpOnly cookie, back to the googleId it belongs to — this
// indirection means a session can be revoked/expired independently of the
// account it points to, and no session token is ever derivable from a
// googleId or vice versa).

import crypto from 'node:crypto';

const memoryAccounts = new Map();
const memorySessions = new Map();

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

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const getAccount = async (googleId) => {
  if (hasKv()) {
    const raw = await kvCommand('GET', `account:${googleId}`);
    return raw ? JSON.parse(raw) : null;
  }
  return memoryAccounts.get(googleId) || null;
};

export const saveAccount = async (googleId, record) => {
  if (hasKv()) {
    await kvCommand('SET', `account:${googleId}`, JSON.stringify(record));
    return;
  }
  memoryAccounts.set(googleId, record);
};

// Returns the new session token. `res` (the caller) is responsible for
// actually setting it as a cookie — this module only owns storage.
export const createSession = async (googleId) => {
  const token = crypto.randomBytes(32).toString('hex');
  if (hasKv()) {
    await kvCommand('SET', `session:${token}`, googleId, 'EX', SESSION_TTL_SECONDS);
  } else {
    memorySessions.set(token, googleId);
  }
  return token;
};

export const getSessionGoogleId = async (token) => {
  if (!token) return null;
  if (hasKv()) {
    return (await kvCommand('GET', `session:${token}`)) || null;
  }
  return memorySessions.get(token) || null;
};

export const deleteSession = async (token) => {
  if (!token) return;
  if (hasKv()) {
    await kvCommand('DEL', `session:${token}`);
    return;
  }
  memorySessions.delete(token);
};
