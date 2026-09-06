import { defineConfig, devices } from '@playwright/test'

// Thin on purpose (Testing Strategy §4): the plumbing exists so a feature can
// add a browser test beside itself, not because broad coverage is wanted now.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})