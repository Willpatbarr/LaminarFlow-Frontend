import { fileURLToPath } from 'node:url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
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
  plugins: [
    // Must precede react(): the plugin generates the route modules that
    // @vitejs/plugin-react then transforms.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  server: {
    proxy: {
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
