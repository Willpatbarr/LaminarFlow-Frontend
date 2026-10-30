import { cleanup, screen, waitFor } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, page, ticket } from '@/sync/testing/harness'
import { openApp, type Routes } from '@/testing/app'

// What the ticket page asks the server for (LAM-164): every list endpoint once
// per load, however many entities read it.

let disconnect: () => void
beforeEach(() => {
    disconnect = connectSyncToSession()
})
afterEach(async () => {
    cleanup()
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

// Every request so far, by "METHOD /path": `fetch` is the stub openApp installed.
// A route nobody stubbed answers an empty page.
function withDefaults(known: Routes): Routes {
    return new Proxy(known, { get: (target, key: string) => target[key] ?? (() => page([])) })
}
function requests() {
    const calls = (globalThis.fetch as unknown as { mock: { calls: [Request][] } }).mock.calls
    return calls.map(([request]) => `${request.method} ${new URL(request.url).pathname}`)
}

const lists = (seen: string[]) => seen.filter((key) => key.endsWith('/list'))
const counts = (seen: string[]) => {
    const result: Record<string, number> = {}
    for (const key of lists(seen)) result[key] = (result[key] ?? 0) + 1
    return result
}

describe('ticket page requests', () => {
    it('asks each list endpoint once on a cold load', async () => {
        await openApp('/tickets/t-1', withDefaults(listRoutes([ticket()])))
        await screen.findByLabelText('Title')
        await new Promise((r) => setTimeout(r, 300))
        for (const [key, count] of Object.entries(counts(requests()))) expect(`${key} x${count}`).toBe(`${key} x1`)
    })

    it('asks each list endpoint at most once moving from one ticket to the next', async () => {
        const history = await openApp(
            '/tickets/t-1',
            withDefaults(listRoutes([ticket(), ticket({ id: 't-2', title: 'Second ticket' })])),
        )
        await screen.findByLabelText('Title')
        await new Promise((r) => setTimeout(r, 300))
        const before = requests().length

        history.set({ value: '/tickets/t-2' })
        await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Second ticket'))
        await new Promise((r) => setTimeout(r, 300))
        const after = requests().slice(before)
        for (const [key, count] of Object.entries(counts(after))) expect(`${key} x${count}`).toBe(`${key} x1`)
        // The lists a ticket reads for itself are asked again, for the new ticket.
        expect(counts(after)['POST /api/v1/activity/list']).toBe(1)
    })
})
