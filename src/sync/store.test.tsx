import { render, screen } from '@solidjs/testing-library'
import { For } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { logout, refresh, session } from '@/features/auth'
import { ok, problem, stubFetch } from '@/testing/fetch'

import { openSyncDb } from './db'
import { connectSyncToSession } from './session'
import {
    archiveDocument,
    createDocument,
    createEpic,
    epicById,
    resolveId,
    createTicket,
    discard,
    documentById,
    documentSyncState,
    updateDocument,
    isLoading,
    needsSetup,
    parkedEntries,
    startSync,
    stopSync,
    sync,
    ticketById,
    ticketSyncState,
    updateTicket,
    wipeLocalData,
} from './store'
import { deferred, doc, docBody, listRoutes, manualConnectivity, ME, ticket } from './testing/harness'

let names = 0
const freshName = () => `store-test-${++names}-${Math.random().toString(36).slice(2)}`

afterEach(async () => {
    await stopSync()
    vi.unstubAllGlobals()
})

// The reads the engine does on its own (hydration, the drain) are not awaited
// by startSync, so tests wait for what they are about to assert on.
const settled = (check: () => void) => vi.waitFor(check)

describe('the reactive store', () => {
    it('is loading until the first hydration lands, then holds what the server sent', async () => {
        const tickets = deferred()
        stubFetch({ ...listRoutes(), 'POST /api/v1/tickets/list': () => tickets.promise })

        await startSync(ME, { dbName: freshName() })
        expect(isLoading()).toBe(true)

        tickets.resolve(ok({ items: [ticket()], next_cursor: null, has_more: false }))
        await settled(() => expect(isLoading()).toBe(false))

        expect(sync.tickets).toEqual([ticket()])
        expect(sync.projects).toEqual([{ id: 'p-1', team_id: 'team-1', name: 'Launch' }])
        expect(needsSetup()).toBe(false)
        expect(ticketSyncState('t-1')).toBe('synced')
    })

    it('shows what is on disk straight away on the next start, before the server answers', async () => {
        const dbName = freshName()
        stubFetch(listRoutes([ticket()]))
        await startSync(ME, { dbName })
        await settled(() => expect(sync.hydrated).toBe(true))
        await stopSync()
        expect(sync.tickets).toEqual([])

        stubFetch({ 'POST /api/v1/teams/list': () => new Promise<Response>(() => {}) })
        await startSync(ME, { dbName })

        expect(isLoading()).toBe(false)
        expect(sync.tickets).toEqual([ticket()])
    })

    it('asks for setup when the server has no project', async () => {
        stubFetch({
            'POST /api/v1/teams/list': () => ok({ items: [], next_cursor: null, has_more: false }),
            'POST /api/v1/projects/list': () => ok({ items: null, next_cursor: null, has_more: false }),
            'POST /api/v1/tickets/list': () => ok({ items: [], next_cursor: null, has_more: false }),
            'POST /api/v1/documents/list': () => ok({ items: [], next_cursor: null, has_more: false }),
            'POST /api/v1/comments/list': () => ok({ items: [], next_cursor: null, has_more: false }),
        })
        await startSync(ME, { dbName: freshName() })
        await settled(() => expect(needsSetup()).toBe(true))
        expect(isLoading()).toBe(false)
    })

    it('shows a write and its unsynced state as soon as the write resolves', async () => {
        const answer = deferred()
        stubFetch({ ...listRoutes([ticket()]), 'PUT /api/v1/tickets/t-1': () => answer.promise })
        await startSync(ME, { dbName: freshName() })
        await settled(() => expect(sync.hydrated).toBe(true))

        await updateTicket('t-1', { title: 'Edited' })

        expect(ticketById('t-1')?.title).toBe('Edited')
        expect(ticketSyncState('t-1')).toBe('pending')

        answer.resolve(ok(ticket({ title: 'Edited', version: 2 })))
        await settled(() => expect(ticketSyncState('t-1')).toBe('synced'))
        expect(ticketById('t-1')?.version).toBe(2)
    })

    it('keeps the same row, and the same DOM node, when a temporary id becomes the real one', async () => {
        const answer = deferred()
        stubFetch({ ...listRoutes(), 'POST /api/v1/tickets': () => answer.promise })
        await startSync(ME, { dbName: freshName() })
        await settled(() => expect(sync.hydrated).toBe(true))
        render(() => (
            <ul>
                <For each={sync.tickets}>{(row) => <li data-id={row.id}>{row.title}</li>}</For>
            </ul>
        ))

        const created = await createTicket({
            project_id: 'p-1',
            title: 'Offline idea',
            description: '',
            status_id: null,
            assignee_id: null,
        })
        const before = screen.getByText('Offline idea')
        expect(before).toHaveAttribute('data-id', created.id)

        answer.resolve(ok(ticket({ id: 't-9', title: 'Offline idea' })))
        await settled(() => expect(sync.outbox).toEqual([]))

        // Not a new <li>: the one that was there, with its id updated.
        expect(screen.getByText('Offline idea')).toBe(before)
        expect(before).toHaveAttribute('data-id', 't-9')
        // And the old id still finds it, for a URL or selection that held it.
        expect(ticketById(created.id)?.id).toBe('t-9')
        expect(ticketSyncState(created.id)).toBe('synced')
    })

    it('remembers a temporary id -> real id across a restart, for any kind of row (LAM-133)', async () => {
        const dbName = freshName()
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/epics': () =>
                ok({ id: 'e-9', project_id: 'p-1', name: 'Checkout', description: '', version: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
        })
        await startSync(ME, { dbName })
        await settled(() => expect(sync.hydrated).toBe(true))
        const created = await createEpic({ project_id: 'p-1', name: 'Checkout', description: '' })
        await settled(() => expect(sync.outbox).toEqual([]))
        expect(resolveId(created.id)).toBe('e-9')
        await stopSync()

        stubFetch({ 'POST /api/v1/teams/list': () => new Promise<Response>(() => {}) })
        await startSync(ME, { dbName })
        expect(resolveId(created.id)).toBe('e-9')
        expect(epicById(created.id)?.id).toBe('e-9')
    })

    it('lists parked entries, and discard() puts the row back', async () => {
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () =>
                problem(422, 'validation_failed', [{ location: 'body.title', message: 'no' }]),
        })
        await startSync(ME, { dbName: freshName() })
        await settled(() => expect(sync.hydrated).toBe(true))

        await updateTicket('t-1', { title: '' })
        await settled(() => expect(ticketSyncState('t-1')).toBe('failed'))
        expect(parkedEntries()).toMatchObject([
            { entity_id: 't-1', state: 'failed', error: { status: 422 } },
        ])

        await discard(parkedEntries()[0].id)

        expect(parkedEntries()).toEqual([])
        expect(ticketById('t-1')?.title).toBe('Write the outbox')
    })

    it('carries documents through the same store: mirrored, edited, synced, archived', async () => {
        const answer = deferred()
        stubFetch({
            ...listRoutes([ticket()], [doc()]),
            'POST /api/v1/documents': () => answer.promise,
            'PUT /api/v1/documents/d-1': () => ok(docBody({ title: 'Renamed', version: 2 })),
            'DELETE /api/v1/documents/d-1': () => new Response(null, { status: 204, headers: { ETag: '"3"' } }),
        })
        await startSync(ME, { dbName: freshName() })
        await settled(() => expect(sync.documents).toEqual([doc()]))

        await updateDocument('d-1', { title: 'Renamed' })
        expect(documentById('d-1')?.title).toBe('Renamed')
        await settled(() => expect(documentSyncState('d-1')).toBe('synced'))
        expect(documentById('d-1')).toMatchObject({ title: 'Renamed', version: 2 })

        const created = await createDocument({
            title: 'Fresh',
            type: 'normal',
            aspect_type_id: null,
            body: {},
            team_id: null,
            project_id: 'p-1',
        })
        expect(documentSyncState(created.id)).toBe('pending')
        answer.resolve(ok(docBody({ id: 'd-9', title: 'Fresh', version: 1 })))
        await settled(() => expect(sync.outbox).toEqual([]))
        // The temporary id still finds it, and the ticket list is untouched.
        expect(documentById(created.id)?.id).toBe('d-9')
        expect(sync.tickets).toEqual([ticket()])

        expect(await archiveDocument('d-1')).toBe(true)
        await settled(() => expect(sync.outbox).toEqual([]))
        expect(sync.documents.map((d) => d.id)).toEqual(['d-9'])
    })

    it('retries when the browser comes back online', async () => {
        const net = manualConnectivity(false)
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => ok(ticket({ title: 'Edited', version: 2 })),
        })
        await startSync(ME, { dbName: freshName(), connectivity: net.connectivity })
        await settled(() => expect(sync.hydrated).toBe(true))
        await updateTicket('t-1', { title: 'Edited' })
        expect(ticketSyncState('t-1')).toBe('pending')

        net.goOnline()

        await settled(() => expect(ticketSyncState('t-1')).toBe('synced'))
    })
})

describe('data is per account', () => {
    const me = (accountId: string) => ({
        account_id: accountId,
        via: 'session',
        email: 'ada@example.com',
        display_name: 'Ada Lovelace',
        workspace_id: 'ws-1',
        permissions: [],
    })

    it('empties a database left by a different account before using it', async () => {
        const dbName = freshName()
        stubFetch(listRoutes([ticket()]))
        await startSync('acc-first', { dbName })
        await settled(() => expect(sync.hydrated).toBe(true))
        await stopSync()

        stubFetch({ 'POST /api/v1/teams/list': () => new Promise<Response>(() => {}) })
        await startSync('acc-second', { dbName })

        expect(sync.loaded).toBe(true)
        expect(sync.tickets).toEqual([])
        expect(sync.projects).toEqual([])
    })

    it('starts when the session becomes authenticated and wipes the database on logout', async () => {
        const disconnect = connectSyncToSession()
        try {
            stubFetch({ 'GET /api/v1/auth/me': () => ok(me(ME)), ...listRoutes([ticket()]) })
            await refresh()
            await settled(() => expect(sync.tickets).toHaveLength(1))

            stubFetch({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) })
            await logout()

            expect(session.status).toBe('anonymous')
            expect(sync.active).toBe(false)
            expect(sync.tickets).toEqual([])
            const db = await openSyncDb()
            expect(await db.snapshot()).toEqual({
                teams: [],
                projects: [],
                statuses: [],
                tickets: [],
                documents: [],
                boards: [],
                epics: [],
                sprints: [],
                milestones: [],
                labels: [],
                savedViews: [],
                comments: [],
                outbox: [],
            })
            expect(await db.getMeta('account_id')).toBeUndefined()
            db.close()
        } finally {
            disconnect()
        }
    })

    it('stops, but keeps the data, when the session just expires', async () => {
        const disconnect = connectSyncToSession()
        try {
            stubFetch({ 'GET /api/v1/auth/me': () => ok(me(ME)), ...listRoutes([ticket()]) })
            await refresh()
            await settled(() => expect(sync.tickets).toHaveLength(1))

            stubFetch({ 'GET /api/v1/auth/me': () => problem(401, 'unauthorized') })
            await refresh()
            await settled(() => expect(sync.active).toBe(false))
            expect(sync.tickets).toEqual([])

            const db = await openSyncDb()
            expect((await db.snapshot()).tickets).toHaveLength(1)
            db.close()
        } finally {
            disconnect()
            await wipeLocalData()
        }
    })
})
