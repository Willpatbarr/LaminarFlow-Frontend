import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { listRoutes, startEngine, TEAM } from '../testing/harness'

// Statuses are the third entity (LAM-95). The engine is the same one tickets and
// documents use; what these pin down is where a status differs: no version,
// a delete that names where the tickets go, a reorder that is one call for the
// whole team, and a change feed applied by upsert.

afterEach(() => {
    vi.unstubAllGlobals()
})

const BASE = '/api/v1/teams/team-1/statuses'
const [TODO, DOING, DONE] = TEAM.statuses

async function started(extra: Parameters<typeof stubFetch>[0] = {}) {
    stubFetch({ ...listRoutes(), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const names = async (db: Awaited<ReturnType<typeof startEngine>>['db']) =>
    (await db.snapshot()).statuses.toSorted((a, b) => a.position - b.position).map((status) => status.name)

describe('hydration', () => {
    it('lists the team\'s statuses as rows with a constant version', async () => {
        const { db } = await started()
        expect((await db.snapshot()).statuses.toSorted((a, b) => a.position - b.position)).toMatchObject([
            { id: 's-todo', team_id: 'team-1', version: 1 },
            { id: 's-doing', version: 1 },
            { id: 's-done', version: 1 },
        ])
    })
})

describe('create', () => {
    it('shows the status at once and sends it with its position, then takes the server id', async () => {
        let sent: unknown
        const { engine, db } = await started({
            [`POST ${BASE}`]: async (request) => {
                sent = await bodyOf(request)
                return ok({ id: 's-new', name: 'Review', color: '#8b5cf6', position: 4, category: 'in_progress' })
            },
        })

        const created = await engine.createStatus({
            team_id: 'team-1',
            name: 'Review',
            color: '#8b5cf6',
            category: 'in_progress',
            position: 4,
        })
        expect(created.id).toMatch(/^tmp_/)
        expect(await names(db)).toEqual(['To Do', 'In Progress', 'Done', 'Review'])

        await engine.idle()
        expect(sent).toEqual({ name: 'Review', color: '#8b5cf6', category: 'in_progress', position: 4 })
        expect((await db.snapshot()).statuses.map((status) => status.id)).toContain('s-new')
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('rename', () => {
    it('sends only the editable fields and no reorder when the position did not change', async () => {
        const calls: string[] = []
        let body: unknown
        const { engine, db } = await started({
            [`PUT ${BASE}/s-todo`]: async (request) => {
                calls.push('PUT')
                body = await bodyOf(request)
                return ok({ ...TODO, name: 'Backlog' })
            },
            [`POST ${BASE}/reorder`]: () => {
                calls.push('reorder')
                return problem(500, 'internal')
            },
        })

        expect(await engine.updateStatus('s-todo', { name: 'Backlog' })).toBe(true)
        expect(await names(db)).toEqual(['Backlog', 'In Progress', 'Done'])
        await engine.idle()

        expect(calls).toEqual(['PUT'])
        expect(body).toEqual({ name: 'Backlog', color: TODO.color, category: TODO.category })
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('reorder', () => {
    it('sends one reorder with the whole team in the new order, however many statuses moved', async () => {
        const orders: unknown[] = []
        const { engine, db } = await started({
            [`POST ${BASE}/reorder`]: async (request) => {
                const { status_ids } = (await bodyOf(request)) as { status_ids: string[] }
                orders.push(status_ids)
                const byId = new Map(TEAM.statuses.map((status) => [status.id, status]))
                return ok({
                    ...TEAM,
                    statuses: status_ids.map((id, index) => ({ ...byId.get(id)!, position: index + 1 })),
                })
            },
        })

        // Drag "Done" to the top: Done 1, To Do 2, In Progress 3.
        await engine.updateStatus('s-done', { position: 1 })
        await engine.updateStatus('s-todo', { position: 2 })
        await engine.updateStatus('s-doing', { position: 3 })
        expect(await names(db)).toEqual(['Done', 'To Do', 'In Progress'])
        await engine.idle()

        expect(orders[0]).toEqual(['s-done', 's-todo', 's-doing'])
        expect(await names(db)).toEqual(['Done', 'To Do', 'In Progress'])
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('delete', () => {
    it('hides the status at once and sends move_to', async () => {
        let query = ''
        const { engine, db } = await started({
            [`DELETE ${BASE}/s-doing`]: (request) => {
                query = new URL(request.url).search
                return new Response(null, { status: 204 })
            },
        })

        expect(await engine.deleteStatus('s-doing', 's-todo')).toBe(true)
        expect(await names(db)).toEqual(['To Do', 'Done'])
        await engine.idle()

        expect(query).toBe('?move_to=s-todo')
        expect((await db.snapshot()).outbox).toEqual([])
        expect(await names(db)).toEqual(['To Do', 'Done'])
    })

    it('keeps a refused delete on screen, with the reason, until it is discarded', async () => {
        const { engine, db } = await started({
            [`DELETE ${BASE}/s-doing`]: () =>
                problem(422, 'status_in_use', [{ location: 'query.move_to', message: '3 tickets use this status; pass move_to' }]),
        })

        await engine.deleteStatus('s-doing', null)
        await engine.idle()

        const { statuses, outbox } = await db.snapshot()
        expect(statuses.map((status) => status.id)).toContain('s-doing')
        expect(outbox).toMatchObject([{ kind: 'archive', state: 'failed', payload: { move_to: null } }])

        await engine.discard(outbox[0].id)
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('the change feed', () => {
    const frame = (type: string, status: object, extra = {}) => ({
        type,
        actor_id: 'acc-other',
        at: '2026-01-01T00:00:01Z',
        team_id: 'team-1',
        status_id: (status as { id: string }).id,
        status,
        ...extra,
    })

    it('upserts on created and updated, whatever order they arrive in, and removes on deleted', async () => {
        const { engine, db } = await started()

        expect(await engine.applyRemote(frame('status.created', { id: 's-x', name: 'Extra', color: '#000', position: 4, category: 'done' }))).toBe(true)
        expect(await names(db)).toEqual(['To Do', 'In Progress', 'Done', 'Extra'])

        expect(await engine.applyRemote(frame('status.updated', { ...DOING, name: 'Doing' }))).toBe(true)
        expect(await names(db)).toEqual(['To Do', 'Doing', 'Done', 'Extra'])

        expect(await engine.applyRemote(frame('status.deleted', { id: 's-x', name: 'Extra', color: '#000', position: 4, category: 'done' }))).toBe(true)
        expect(await names(db)).toEqual(['To Do', 'Doing', 'Done'])

        // A late frame for the deleted one does not bring it back.
        expect(await engine.applyRemote(frame('status.updated', { id: 's-x', name: 'Extra', color: '#000', position: 4, category: 'done' }))).toBe(false)
        expect(await names(db)).toEqual(['To Do', 'Doing', 'Done'])
    })

    it('ignores a frame whose status is not the one it names', async () => {
        const { engine } = await started()
        expect(await engine.applyRemote(frame('status.updated', { ...DONE }, { status_id: 's-other' }))).toBe(false)
    })

    it('leaves a status with unsent changes as the user has it', async () => {
        // Refused, so the change stays queued (a change on the wire would hold
        // the feed back until it is answered).
        const { engine, db } = await started({
            [`PUT ${BASE}/s-todo`]: () => problem(422, 'validation', [{ location: 'body.name', message: 'no' }]),
        })
        await engine.updateStatus('s-todo', { name: 'Mine' })
        await engine.idle()

        await engine.applyRemote(frame('status.updated', { ...TODO, name: 'Theirs' }))

        expect(await names(db)).toEqual(['Mine', 'In Progress', 'Done'])
    })
})
