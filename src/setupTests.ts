// Runs before every test file: registers the DOM matchers and guarantees each
// test starts against an empty document.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@solidjs/testing-library'
import { afterEach, beforeEach, expect } from 'vitest'

import { FakeWebSocket } from '@/sync/testing/fakeSocket'

// Testing Library only registers its own cleanup when Vitest globals are on.
// They are off here, so unmounting is manual - without this, the second render
// in a file finds two copies of the component and every query throws.
afterEach(cleanup)

// jsdom does not implement scrolling, and the router asks for it on every
// navigation; without this each one prints a "not implemented" warning.
window.scrollTo = () => {}

// jsdom ships a real WebSocket, and the sync store opens one the moment a test
// signs in. Left alone it would dial localhost for real; this one never
// connects, which is what every test that does not care about the feed wants.
// The sync tests that do care pass their own through `startSync`.
beforeEach(() => {
    FakeWebSocket.reset()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
})

// Solid's dev build warns when a reactive value is read where it will never
// update (an effect's apply half, a component body). The app still "works", so
// nothing else would catch it; here it fails the test that caused it. An
// intended one-off read is spelled `untrack(() => ...)`.
// Wrapped once rather than spied per test, so a test's own
// `vi.restoreAllMocks()` cannot take it off.
let strictReads: string[] = []
const warn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('[STRICT_READ_UNTRACKED]')) strictReads.push(String(args[0]))
    else warn(...args)
}
afterEach(() => {
    const seen = strictReads
    strictReads = []
    expect(seen, 'untracked reactive reads').toEqual([])
})
