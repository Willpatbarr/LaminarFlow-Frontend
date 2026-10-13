import { describe, expect, it } from 'vitest'

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
