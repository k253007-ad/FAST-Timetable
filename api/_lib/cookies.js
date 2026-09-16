// Minimal hand-rolled cookie parse/serialize — this project has no
// framework-level cookie support (plain Vercel Node functions), and the
// need here is small enough (one HttpOnly session cookie) that pulling in
// a dependency for it isn't worth it.

const SESSION_COOKIE_NAME = 'ftt_session';

export const readSessionCookie = (req) => {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
};

// `Secure` is always set — this app is only ever served over HTTPS in
// production and over plain HTTP on localhost during `npm run dev`, where
// browsers still accept a `Secure` cookie on `localhost` specifically as a
// long-standing exception (unlike any other non-HTTPS origin), so this
// doesn't need a separate dev-only code path.
export const setSessionCookie = (res, token, maxAgeSeconds) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
};

export const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
};
