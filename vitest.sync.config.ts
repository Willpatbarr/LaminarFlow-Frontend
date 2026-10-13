import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `npm run test:sync` (LAM-72): the real sync engine, database and socket
// against a real backend over real HTTP and a real WebSocket. Deliberately its
// own config, so `npm test` - which has to stay fast and runnable with nothing
// else installed - never picks these up: they live under tests/, outside the
// glob in vite.config.ts, and need a stack that scripts/test-stack.sh brings up.
//
// No Solid plugin and no jsdom: the engine has neither a UI nor a DOM, and
// leaving them out is part of what this proves. IndexedDB is fake-indexeddb
// (tests/sync/setup.ts); everything else is the real thing.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  test: {
    environment: 'node',
    include: ['tests/sync/**/*.sync.test.ts'],
    globalSetup: ['./tests/sync/globalSetup.ts'],
    setupFiles: ['./tests/sync/setup.ts'],
    // Every test registers its own accounts and builds its own project, but
    // they all share one server and one workspace. One file at a time keeps a
    // failure readable and the server's log in order.
    fileParallelism: false,
    // Real round trips, a real socket, and a few deliberate backoff waits.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
