import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sheetData } from './api/sheetConfig.js'

// Serves the same JSON as api/data.js so `npm run dev` doesn't need `vercel dev`.
const apiDataMiddleware = () => ({
  name: 'api-data-middleware',
  configureServer(server) {
    server.middlewares.use('/api/data', (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(sheetData))
    })
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiDataMiddleware()],
})
