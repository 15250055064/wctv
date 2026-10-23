import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development (`npm run dev`) the local server runs separately; WCT_API points at it.
const api = process.env.WCT_API || 'http://localhost:5174'
const proxy = {
  target: api,
  changeOrigin: true,
  // The local server only accepts requests from its own origin.
  configure: (p: { on(e: 'proxyReq', fn: (req: { removeHeader(n: string): void }) => void): void }) => p.on('proxyReq', (req) => req.removeHeader('origin')),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': proxy, '/files': proxy, '/models': proxy } },
})
