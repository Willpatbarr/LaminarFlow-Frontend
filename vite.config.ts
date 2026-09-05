import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The deployed app is same-origin: the Go backend serves this bundle and the
// API from one port (LAM-28). `npm run dev` is the one place that is not true -
// Vite serves the app on 5173 while the backend listens on 8080 - so proxy the
// backend's paths across and let application code use relative URLs everywhere.
//
// Without this, dev would need absolute API URLs and CORS headers, which is the
// split-origin setup the same-origin decision exists to remove. Worse, it would
// be a difference between dev and production in exactly the layer - cookies on
// cross-site requests - that the decision was made to protect.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      // Health endpoints sit at the root rather than under /api, where probes
      // expect them, so they need their own entry to be reachable in dev.
      '/healthz': { target: apiTarget, changeOrigin: true },
    },
  },
})
