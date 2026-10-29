import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { listRoutes, startEngine, ticket } from '../testing/harness'

// Labels became writable in LAM-104. The engine is the one statuses use; what
// these pin down is where a label differs: no version, a name that is unique
// in the team, and a ticket that may be given a label the server has not heard
// of yet.

afterEach(() => {
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const BUG = { id: 'l-1', team_id: 'team-1', name: 'bug', color: '#ef4444', ...stamp }

async function started(extra: Parameters<typeof stubFetch>[0] = {}, tickets = [ticket({ id: 't-1', version: 1 })]) {
    stubFetch({ ...listRoutes(tickets, [], [], { labels: [BUG] }), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const names = async (db: Awaited<ReturnType<typeof startEngine>>['db']) =>
    (await db.snapshot()).labels.map((label) => label.name).toSorted()

describe('create', () => {
    it('shows the label at once, sends team, name and colour, then takes the server id', async () => {
        let sent: unknown
        const { engine, db } = await started({
            'POST /api/v1/labels': async (request) => {
                sent = await bodyOf(request)
                return ok({ id: 'l-new', team_id: 'team-1', name: 'feature', color: '#3b82f6', ...stamp })
            },
        })

        const row = await engine.createLabel({ team_id: 'team-1', name: 'feature', color: '#3b82f6' })
        expect(row.id.startsWith('tmp_')).toBe(true)
        expect(await names(db)).toEqual(['bug', 'feature'])
        await engine.idle()

        expect(sent).toEqual({ team_id: 'team-1', name: 'feature', color: '#3b82f6' })
        const snapshot = await db.snapshot()
        expect(snapshot.labels.map((label) => label.id).toSorted()).toEqual(['l-1', 'l-new'])
        expect(snapshot.outbox).toEqual([])
    })

    it('adopts the team\'s label of that name when the create meets its own earlier send (label_name_taken)', async () => {
        const { engine, db } = await started({
            'POST /api/v1/labels': () => problem(409, 'label_name_taken'),
        })
        await engine.createLabel({ team_id: 'team-1', name: 'bug', color: '#ef4444' })
        await engine.idle()

        const snapshot = await db.snapshot()
        expect(snapshot.labels.map((label) => label.id)).toEqual(['l-1'])
        expect(snapshot.outbox).toEqual([])
    })

    it('parks a create whose name is taken by another label, with the code', async () => {
        const { engine, db } = await started({
            'POST /api/v1/labels': () => problem(409, 'label_name_taken'),
        })
        await engine.createLabel({ team_id: 'team-1', name: 'other', color: '#ef4444' })
        await engine.idle()

        const [entry] = (await db.snapshot()).outbox
        expect(entry).toMatchObject({ state: 'failed', error: { code: 'label_name_taken' } })
    })
})

describe('rename and recolour', () => {
    it('sends the name and colour in one PUT with no If-Match', async () => {
        let body: unknown
        let ifMatch: string | null = 'unset'
        const { engine, db } = await started({
            'PUT /api/v1/labels/l-1': async (request) => {
                body = await bodyOf(request)
                ifMatch = request.headers.get('If-Match')
                return ok({ ...BUG, name: 'defect', color: '#8b5cf6' })
            },
        })

        expect(await engine.updateLabel('l-1', { name: 'defect', color: '#8b5cf6' })).toBe(true)
        expect(await names(db)).toEqual(['defect'])
        await engine.idle()

        expect(body).toEqual({ name: 'defect', color: '#8b5cf6' })
        expect(ifMatch).toBeNull()
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('delete', () => {
    it('hides the label at once and, once the server agrees, takes it off every ticket', async () => {
        const { engine, db } = await started(
            { 'DELETE /api/v1/labels/l-1': () => new Response(null, { status: 204 }) },
            [ticket({ id: 't-1', version: 1, label_ids: ['l-1', 'l-2'] })],
        )

        expect(await engine.deleteLabel('l-1')).toBe(true)
        expect(await names(db)).toEqual([])
        await engine.idle()

        const snapshot = await db.snapshot()
        expect(snapshot.tickets[0]).toMatchObject({ label_ids: ['l-2'], version: 1 })
        expect(snapshot.outbox).toEqual([])
    })
})

describe('a ticket given a label that is not on the server yet', () => {
    it('is sent after the label\'s create, and names the label by its real id', async () => {
        const calls: string[] = []
        let put: unknown
        const { engine, db, net } = await started({
            'POST /api/v1/labels': () => {
                calls.push('label')
                return ok({ id: 'l-new', team_id: 'team-1', name: 'feature', color: '#3b82f6', ...stamp })
            },
            'PUT /api/v1/tickets/t-1': async (request) => {
                calls.push('ticket')
                put = await bodyOf(request)
                return ok(ticket({ id: 't-1', version: 2, label_ids: ['l-new'] }))
            },
        })

        net.goOffline()
        const label = await engine.createLabel({ team_id: 'team-1', name: 'feature', color: '#3b82f6' })
        await engine.updateTicket('t-1', { label_ids: [label.id] })
        // Both are on the screen at once.
        expect((await db.snapshot()).tickets[0].label_ids).toEqual([label.id])

        net.goOnline()
        await engine.idle()

        expect(calls).toEqual(['label', 'ticket'])
        expect(put).toMatchObject({ label_ids: ['l-new'] })
        const snapshot = await db.snapshot()
        expect(snapshot.tickets[0]).toMatchObject({ label_ids: ['l-new'], version: 2 })
        expect(snapshot.outbox).toEqual([])
    })

    it('waits for a label whose create failed, and goes out without it once that create is discarded', async () => {
        let put: unknown
        const { engine, db } = await started({
            'POST /api/v1/labels': () => problem(422, 'validation_failed'),
            'PUT /api/v1/tickets/t-1': async (request) => {
                put = await bodyOf(request)
                return ok(ticket({ id: 't-1', version: 2 }))
            },
        })
        const label = await engine.createLabel({ team_id: 'team-1', name: 'feature', color: '#3b82f6' })
        await engine.updateTicket('t-1', { label_ids: [label.id] })
        await engine.idle()

        // The ticket's write is held, not sent with an id the server cannot know.
        expect(put).toBeUndefined()
        const [create, edit] = (await db.snapshot()).outbox
        expect(create).toMatchObject({ entity: 'label', state: 'failed' })
        expect(edit).toMatchObject({ entity: 'ticket', state: 'pending' })

        await engine.discard(create.id)
        await engine.idle()
        expect(put).toMatchObject({ label_ids: [] })
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('loses nothing when the label is deleted again before it was ever sent', async () => {
        const { engine, db, net } = await started()
        net.goOffline()
        const label = await engine.createLabel({ team_id: 'team-1', name: 'feature', color: '#3b82f6' })
        await engine.updateTicket('t-1', { label_ids: [label.id] })
        await engine.deleteLabel(label.id)

        const snapshot = await db.snapshot()
        expect(snapshot.tickets[0].label_ids).toEqual([])
        expect(snapshot.outbox.map((entry) => entry.entity)).toEqual(['ticket'])
        expect(snapshot.outbox[0]).toMatchObject({ payload: { label_ids: [] } })
    })
})

describe('the change feed', () => {
    it('upserts a label other people make or rename, and removes one they delete', async () => {
        const { engine, db } = await started()
        const frame = (type: string, body: typeof BUG) => ({ type, actor_id: 'acc-other', at: stamp.created_at, label: body, label_id: body.id })

        await engine.applyRemote(frame('label.created', { ...BUG, id: 'l-2', name: 'ui' }))
        await engine.applyRemote(frame('label.updated', { ...BUG, name: 'defect' }))
        expect(await names(db)).toEqual(['defect', 'ui'])

        await engine.applyRemote(frame('label.deleted', { ...BUG, id: 'l-2', name: 'ui' }))
        expect(await names(db)).toEqual(['defect'])
    })
})
