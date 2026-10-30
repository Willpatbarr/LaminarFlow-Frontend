import { cleanup, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, wipeLocalData } from '@/sync'
import { deferred, docBody, listRoutes } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'

let disconnect = () => {}
beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})
afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

describe('typing through the id swap (LAM-169)', () => {
    it('a new document keeps what was typed into its title while the create is answered', async () => {
        const gate = deferred<void>()
        const puts: Record<string, unknown>[] = []
        const history = await openApp('/documents', {
            ...listRoutes([], []),
            'POST /api/v1/documents': async (request) => {
                const sent = await bodyOf(request)
                await gate.promise
                return ok(docBody({ id: 'd-new', version: 1, ...sent }), 201)
            },
            'PUT /api/v1/documents/d-new': async (request) => {
                const sent = await bodyOf(request)
                puts.push(sent)
                return ok(docBody({ id: 'd-new', version: 2 + puts.length, ...sent }))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('option', { name: 'Launch' })
        await user.click(screen.getByRole('button', { name: 'New document' }))
        const title = await screen.findByLabelText('Document title')
        await user.type(title, 'Quar')
        await new Promise((r) => setTimeout(r, 1000))
        await user.type(title, 'terly')
        await new Promise((r) => setTimeout(r, 1000))
        await user.type(title, '!')
        gate.resolve()
        await waitFor(() => expect(history.get()).toBe('/documents/d-new'))
        await user.type(screen.getByLabelText('Document title'), ' plan')
        await user.tab()
        expect(screen.getByLabelText('Document title')).toHaveValue('Quarterly! plan')
        await waitFor(() => expect(sync.documents.find((d) => d.id === 'd-new')?.title).toBe('Quarterly! plan'), { timeout: 5000 })
        await waitFor(() => expect(sync.outbox).toEqual([]), { timeout: 5000 })
        expect(screen.getByLabelText('Document title')).toHaveValue('Quarterly! plan')
        cleanup()
    })
})
