import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Server-only development setting; never expose database environment values.
const apiTarget = process.env.SHERPA_DEV_API_TARGET ?? 'http://127.0.0.1:8000'
const target = new URL(apiTarget)
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.username || target.password || target.search || target.hash || target.pathname !== '/') {
  throw new Error('The development API target must be a loopback HTTP origin.')
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
    },
  },
})
