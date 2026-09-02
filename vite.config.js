import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { parse } from 'node:url'

// Vite only auto-exposes VITE_-prefixed vars to *client* code
// (import.meta.env) — it does NOT populate process.env for the config file
// or dev-server middleware. The API handlers below read plain
// process.env.VAPID_PRIVATE_KEY etc. (same as they will under Vercel in
// production), so .env.local's values need to be copied over by hand here
// for `npm run dev` to see them at all.
Object.assign(process.env, loadEnv('development', process.cwd(), ''))

const { getSheetData } = await import('./api/sheetConfig.js')
const { default: subscribeHandler } = await import('./api/subscribe.js')
const { default: notifyTickHandler } = await import('./api/notify-tick.js')

// Serves the same JSON as api/data.js so `npm run dev` doesn't need `vercel dev`.
const apiDataMiddleware = () => ({
  name: 'api-data-middleware',
  configureServer(server) {
    server.middlewares.use('/api/data', async (req, res) => {
      try {
        const data = await getSheetData()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(data))
      } catch (err) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }
})

// Vite's dev middleware gives plain Node req/res, not Vercel's enhanced
// versions (req.query, req.body, res.status()/res.json()) — this wrapper
// fakes just enough of that so the *same* handler functions used in
// production (api/subscribe.js, api/notify-tick.js) also run under
// `npm run dev`, instead of maintaining a second copy of their logic here.
const withVercelCompat = (handler) => async (req, res) => {
  const parsedUrl = parse(req.url, true)
  req.query = parsedUrl.query

  if (req.method === 'POST' || req.method === 'PUT') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    try {
      req.body = raw ? JSON.parse(raw) : {}
    } catch {
      req.body = raw
    }
  }

  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }

  try {
    await handler(req, res)
  } catch (err) {
    console.error('API handler error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    }
  }
}

// Push-notification endpoints (added 2026-09-02) — see
// fastTimetable/CLAUDE.md's push-notifications section for the full design.
const apiPushMiddleware = () => ({
  name: 'api-push-middleware',
  configureServer(server) {
    server.middlewares.use('/api/subscribe', withVercelCompat(subscribeHandler))
    server.middlewares.use('/api/notify-tick', withVercelCompat(notifyTickHandler))
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiDataMiddleware(), apiPushMiddleware()],
})
