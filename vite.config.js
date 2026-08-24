import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { getSheetData } from './api/sheetConfig.js'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiDataMiddleware()],
})
