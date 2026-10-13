import { fileURLToPath } from 'node:url'
import solid from '@solidjs/vite-plugin'
import { defineConfig } from 'vitest/config'

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
  plugins: [solid()],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  server: {
    proxy: {
      // The change feed (LAM-68) is a WebSocket upgrade, which the proxy only
      // forwards when told to. It also needs its own entry, ahead of /api,
      // because the backend refuses an upgrade whose Origin host differs from
      // its Host header: `changeOrigin` would rewrite Host to :8080 while the
      // browser's Origin stays :5173, and every dev connection would be a 403.
      // Leaving Host alone keeps the two equal. Production is same-origin, so
      // none of this exists there.
      '/api/v1/ws': { target: apiTarget, ws: true },
      '/api': { target: apiTarget, changeOrigin: true },
      // Health endpoints sit at the root rather than under /api, where probes
      // expect them, so they need their own entry to be reachable in dev.
      '/healthz': { target: apiTarget, changeOrigin: true },
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
      // Vitest's default glob also matches e2e/*.spec.ts. Without this it tries
      // to run the Playwright specs under jsdom, where `page` does not exist.
      include: ['src/**/*.test.{ts,tsx}'],
  },
})
