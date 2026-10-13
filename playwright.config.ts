import { defineConfig, devices } from '@playwright/test'

// Browser tests against the REAL stack (LAM-73): the Go backend serving this
// repo's built bundle same-origin, on a disposable Postgres - the way
// production serves it, so a cookie, a WebSocket upgrade and a redirect behave
// as they will for a user. `scripts/test-stack.sh` brings that up; there is no
// Vite dev server here and nothing is mocked.
//
//   npm run test:e2e:stack                  fresh stack, run, always tear down
//   scripts/test-stack.sh up                leave one running, then
//   SYNC_BASE_URL=http://127.0.0.1:18180 npm run test:e2e
//
// The address is E2E_BASE_URL, or SYNC_BASE_URL (what the stack script exports).
// Without either, globalSetup fails the run and says what to do; a suite that
// skipped itself when the server was missing would be green while testing
// nothing.
const baseURL = process.env.E2E_BASE_URL ?? process.env.SYNC_BASE_URL

// The server-side helpers shared with the sync suite (tests/sync/support/stack)
// read their address from this name.
if (baseURL) process.env.SYNC_BASE_URL = baseURL

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/support/globalSetup.ts',

    // One worker, one spec at a time. Specs are isolated from each other's
    // DATA (each has its own accounts and its own project), but they share one
    // server, one workspace and one machine, and the point of this suite is a
    // failure that can be read, not the fastest run. Revisit if it gets slow.
    fullyParallel: false,
    workers: 1,
    // A spec that passes on the second try is a flaky spec, and a retry would
    // hide it. Failures are fixed, not rerun.
    retries: 0,
    forbidOnly: !!process.env.CI,

    // Real round trips and a few deliberate backoffs (the socket reconnects after
    // a second). `expect` is what every "wait on visible state" waits on.
    timeout: 45_000,
    expect: { timeout: 10_000 },

    reporter: [['list'], ['html', { open: 'never' }]],

    use: {
        baseURL,
        // Kept only for a failed spec: open it with `npx playwright show-trace`.
        trace: 'retain-on-failure',
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
