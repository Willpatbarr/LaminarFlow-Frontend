import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { openSyncDb } from './db'
import { freshDb, ticket } from './testing/harness'
import type { NewOutboxEntry } from './types'

const entry = (ticketId: string): NewOutboxEntry => ({
    kind: 'archive',
    ticket_id: ticketId,
    payload: null,
    base_version: 1,
    state: 'pending',
    attempts: 0,
    error: null,
    conflict: null,
    created_at: '2026-01-01T00:00:00Z',
})

describe('the sync database', () => {
    it('numbers outbox entries in the order they were added', async () => {
        const db = await freshDb()

        const added = await db.write(async (tx) => [
            await tx.outbox.add(entry('t-2')),
            await tx.outbox.add(entry('t-1')),
            await tx.outbox.add(entry('t-2')),
        ])

        expect(added.map((e) => e.id)).toEqual([1, 2, 3])
        expect((await db.snapshot()).outbox.map((e) => e.ticket_id)).toEqual(['t-2', 't-1', 't-2'])
        const forTicket = await db.write((tx) => tx.outbox.forTicket('t-2'))
        expect(forTicket.map((e) => e.id)).toEqual([1, 3])
    })

    it('commits a write transaction as a whole, or not at all', async () => {
        const db = await freshDb()
        await db.write((tx) => tx.tickets.put(ticket({ id: 't-1' })))

        await expect(
            db.write(async (tx) => {
                await tx.tickets.put(ticket({ id: 't-2' }))
                await tx.outbox.add(entry('t-2'))
                throw new Error('changed my mind')
            }),
        ).rejects.toThrow('changed my mind')

        const snapshot = await db.snapshot()
        expect(snapshot.tickets.map((t) => t.id)).toEqual(['t-1'])
        expect(snapshot.outbox).toEqual([])
    })

    it('keeps the server copy apart from the row on screen', async () => {
        const db = await freshDb()
        await db.write(async (tx) => {
            await tx.serverTickets.put(ticket({ title: 'Server' }))
            await tx.tickets.put(ticket({ title: 'Local' }))
        })

        expect((await db.snapshot()).tickets).toMatchObject([{ title: 'Local' }])
        expect(await db.write((tx) => tx.serverTickets.get('t-1'))).toMatchObject({ title: 'Server' })
    })

    it('clear() empties every table and the meta', async () => {
        const db = await freshDb()
        await db.setMeta('account_id', 'acc-1')
        await db.write(async (tx) => {
            await tx.tickets.put(ticket())
            await tx.serverTickets.put(ticket())
            await tx.outbox.add(entry('t-1'))
            await tx.teams.put({ id: 'team-1', workspace_id: 'ws-1', name: 'Core' })
        })

        await db.clear()

        expect(await db.snapshot()).toEqual({
            teams: [],
            projects: [],
            statuses: [],
            tickets: [],
            outbox: [],
        })
        expect(await db.getMeta('account_id')).toBeUndefined()
        expect(await db.write((tx) => tx.serverTickets.all())).toEqual([])
    })
})

describe('the upgrade from version 1 (LAM-76)', () => {
    // A database exactly as the previous release left it: version 1, creates
    // without a key.
    async function version1(name: string) {
        const old = await openDB(name, 1, {
            upgrade(db) {
                db.createObjectStore('meta')
                for (const store of ['teams', 'projects', 'statuses', 'tickets', 'server_tickets']) {
                    db.createObjectStore(store, { keyPath: 'id' })
                }
                db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }).createIndex(
                    'ticket_id',
                    'ticket_id',
                )
            },
        })
        const common = { base_version: null, state: 'pending', attempts: 0, error: null, conflict: null, created_at: '2026-01-01T00:00:00Z' }
        await old.put('meta', 'acc-me', 'account_id')
        await old.put('tickets', ticket({ id: 'tmp_a', version: 0 }))
        await old.add('outbox', { ...common, kind: 'create', ticket_id: 'tmp_a', payload: { title: 'A', project_id: 'p-1' } })
        await old.add('outbox', { ...common, kind: 'update', ticket_id: 't-1', base_version: 3, payload: { title: 'U' } })
        await old.add('outbox', { ...common, kind: 'create', ticket_id: 'tmp_b', attempts: 2, payload: { title: 'B', project_id: 'p-1' } })
        await old.add('outbox', { ...common, kind: 'archive', ticket_id: 't-2', base_version: 1, payload: null })
        old.close()
    }

    it('gives every create that has no key one, and touches nothing else', async () => {
        const name = `upgrade-${Math.random().toString(36).slice(2)}`
        await version1(name)
        let made = 0

        const db = await openSyncDb(name, { newKey: () => `made-${++made}` })

        const { outbox, tickets } = await db.snapshot()
        expect(outbox.map((entry) => [entry.id, entry.kind, 'idempotency_key' in entry ? entry.idempotency_key : undefined])).toEqual([
            [1, 'create', 'made-1'],
            [2, 'update', undefined],
            [3, 'create', 'made-2'],
            [4, 'archive', undefined],
        ])
        // Everything else, as it was.
        expect(outbox[2]).toMatchObject({ ticket_id: 'tmp_b', attempts: 2, payload: { title: 'B' } })
        expect(tickets).toMatchObject([{ id: 'tmp_a' }])
        expect(await db.getMeta('account_id')).toBe('acc-me')
        db.close()
    })

    it('does not run again: the keys it made are the keys there are on the next open', async () => {
        const name = `upgrade-${Math.random().toString(36).slice(2)}`
        await version1(name)
        const first = await openSyncDb(name, { newKey: () => 'once' })
        first.close()

        const again = await openSyncDb(name, { newKey: () => 'twice' })

        const keys = (await again.snapshot()).outbox.flatMap((entry) => (entry.kind === 'create' ? [entry.idempotency_key] : []))
        expect(keys).toEqual(['once', 'once'])
        again.close()
    })

    it('opens a database that never had a version as a new one, with every store', async () => {
        const db = await openSyncDb(`fresh-${Math.random().toString(36).slice(2)}`)
        await db.write(async (tx) => {
            await tx.outbox.add({
                kind: 'create',
                ticket_id: 'tmp_1',
                payload: { title: 'A', description: '', status_id: null, assignee_id: null, project_id: 'p-1' },
                idempotency_key: 'k',
                base_version: null,
                state: 'pending',
                attempts: 0,
                error: null,
                conflict: null,
                created_at: '2026-01-01T00:00:00Z',
            })
        })
        expect((await db.snapshot()).outbox).toMatchObject([{ idempotency_key: 'k' }])
        db.close()
    })
})
