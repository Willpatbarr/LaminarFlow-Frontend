import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, stubFetch } from '@/testing/fetch'

import { listRoutes, ME, page, startEngine, ticket } from './testing/harness'

afterEach(() => {
    vi.unstubAllGlobals()
})

const EPIC = { id: 'e-1', project_id: 'p-1', name: 'Checkout', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const SPRINT = { id: 'sp-1', project_id: 'p-1', name: 'Sprint 1', start_date: null, end_date: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const MILESTONE = { id: 'm-1', project_id: 'p-1', name: 'v1', description: '', target_date: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const LABEL = { id: 'l-1', team_id: 'team-1', name: 'bug', color: '#f00', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const feed = (type: string, name: string, body: { id: string }) => ({
    type,
    actor_id: 'acc-other',
    at: '2026-01-02T00:00:00Z',
    [name]: body,
    [`${name}_id`]: body.id,
})

async function server(db: Awaited<ReturnType<typeof startEngine>>['db']) {
    return db.write(async (tx) => tx.serverTickets.all())
}

describe('hydration (LAM-103)', () => {
    it('lists epics, sprints, milestones and labels, and reads each ticket\'s sprints through the sprint filter', async () => {
        const filters: unknown[] = []
        stubFetch({
            ...listRoutes([ticket({ id: 't-1' }), ticket({ id: 't-2' })], [], [], {
                epics: [EPIC],
                sprints: [SPRINT],
                milestones: [MILESTONE],
                labels: [LABEL],
            }),
            'POST /api/v1/tickets/list': async (request) => {
                const body = await bodyOf(request)
                if (body.filter) {
                    filters.push(body.filter)
                    return page([{ ...ticket({ id: 't-2' }) }])
                }
                return page([
                    { ...ticket({ id: 't-1' }), epic_id: 'e-1', label_ids: ['l-1'], milestone_id: 'm-1' },
                    ticket({ id: 't-2' }),
                ])
            },
        })
        const { db } = await startEngine()
        const snapshot = await db.snapshot()

        expect(snapshot.epics.map((e) => e.name)).toEqual(['Checkout'])
        expect(snapshot.sprints.map((s) => s.name)).toEqual(['Sprint 1'])
        expect(snapshot.milestones.map((m) => m.name)).toEqual(['v1'])
        expect(snapshot.labels.map((l) => l.name)).toEqual(['bug'])
        expect(filters).toEqual([{ op: 'and', conditions: [{ field: 'sprint', op: 'eq', value: 'sp-1' }] }])
        const byId = Object.fromEntries(snapshot.tickets.map((t) => [t.id, t]))
        expect(byId['t-1']).toMatchObject({ epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1'], sprint_ids: [] })
        expect(byId['t-2']).toMatchObject({ epic_id: null, milestone_id: null, label_ids: [], sprint_ids: ['sp-1'] })
    })
})

describe('writing a ticket\'s epic, milestone, labels and sprint (LAM-103)', () => {
    it('sends them in the PUT, then moves the sprint with its own calls, and adopts the version the ticket ends on', async () => {
        const calls: string[] = []
        let put: unknown
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 1, sprint_ids: ['sp-old'] } as never)], [], [], { sprints: [SPRINT] }),
            'PUT /api/v1/tickets/t-1': async (request) => {
                calls.push('PUT')
                put = await bodyOf(request)
                return ok({ ...ticket({ id: 't-1', version: 2 }), ...(put as object) })
            },
            'POST /api/v1/sprints/sp-1/tickets': async (request) => {
                calls.push(`POST sp-1 ${JSON.stringify(await bodyOf(request))}`)
                return new Response(null, { status: 204 })
            },
            'DELETE /api/v1/sprints/sp-old/tickets/t-1': () => {
                calls.push('DELETE sp-old')
                return new Response(null, { status: 204 })
            },
            'GET /api/v1/tickets/t-1': () => {
                calls.push('GET')
                return ok({ ...ticket({ id: 't-1', version: 4 }), epic_id: 'e-1', label_ids: ['l-1'], milestone_id: 'm-1' })
            },
        })
        const { engine, db } = await startEngine()
        // The server's copy has the old sprint (hydration cannot see it: its stub has no such sprint).
        await db.write(async (tx) => {
            const row = (await tx.serverTickets.get('t-1'))!
            await tx.serverTickets.put({ ...row, sprint_ids: ['sp-old'] })
            await tx.tickets.put({ ...row, sprint_ids: ['sp-old'] })
        })

        await engine.updateTicket('t-1', { epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1'], sprint_ids: ['sp-1'] })
        // The screen shows it before anything is sent.
        await engine.idle()

        expect(put).toEqual({
            title: 'Write the outbox',
            description: '',
            status_id: 's-todo',
            assignee_id: null,
            epic_id: 'e-1',
            milestone_id: 'm-1',
            label_ids: ['l-1'],
        })
        expect(calls).toEqual(['PUT', 'DELETE sp-old', 'POST sp-1 {"ticket_id":"t-1"}', 'GET'])
        const after = (await db.snapshot()).tickets[0]
        expect(after).toMatchObject({ version: 4, epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1'], sprint_ids: ['sp-1'] })
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('puts the epic on the screen at once, before the server answers', async () => {
        stubFetch({ ...listRoutes([ticket({ id: 't-1' })]), 'PUT /api/v1/tickets/t-1': () => new Promise<Response>(() => {}) })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { epic_id: 'e-1' })
        expect((await db.snapshot()).tickets[0]).toMatchObject({ epic_id: 'e-1' })
    })
})

describe('the change feed (LAM-103)', () => {
    it('keeps a ticket\'s sprints when its frame, which has none, moves the version', async () => {
        stubFetch(listRoutes([ticket({ id: 't-1', version: 1 })]))
        const { engine, db } = await startEngine()
        await db.write(async (tx) => {
            const row = (await tx.serverTickets.get('t-1'))!
            await tx.serverTickets.put({ ...row, sprint_ids: ['sp-1'] })
            await tx.tickets.put({ ...row, sprint_ids: ['sp-1'] })
        })
        const next = { ...ticket({ id: 't-1', version: 2, title: 'Moved' }), sprint_ids: undefined }
        await engine.applyRemote({ type: 'ticket.updated', ticket_id: 't-1', version: 2, actor_id: 'x', at: 'n', ticket: next })
        expect((await db.snapshot()).tickets[0]).toMatchObject({ title: 'Moved', version: 2, sprint_ids: ['sp-1'] })
    })

    it('stores and removes epics, sprints, milestones and labels as their frames arrive', async () => {
        stubFetch(listRoutes())
        const { engine, db } = await startEngine()
        expect(await engine.applyRemote(feed('epic.created', 'epic', EPIC))).toBe(true)
        expect(await engine.applyRemote(feed('sprint.created', 'sprint', SPRINT))).toBe(true)
        expect(await engine.applyRemote(feed('milestone.created', 'milestone', MILESTONE))).toBe(true)
        expect(await engine.applyRemote(feed('label.created', 'label', LABEL))).toBe(true)
        expect(await engine.applyRemote(feed('epic.updated', 'epic', { ...EPIC, name: 'Renamed' } as typeof EPIC))).toBe(true)
        let snapshot = await db.snapshot()
        expect(snapshot.epics.map((e) => e.name)).toEqual(['Renamed'])
        expect([snapshot.sprints.length, snapshot.milestones.length, snapshot.labels.length]).toEqual([1, 1, 1])

        await engine.applyRemote(feed('sprint.deleted', 'sprint', SPRINT))
        await engine.applyRemote(feed('label.deleted', 'label', LABEL))
        snapshot = await db.snapshot()
        expect([snapshot.sprints.length, snapshot.labels.length]).toEqual([0, 0])
    })

    it('ignores a frame that is missing its member or whose id disagrees', async () => {
        stubFetch(listRoutes())
        const { engine, db } = await startEngine()
        expect(await engine.applyRemote({ ...feed('epic.created', 'epic', EPIC), epic_id: 'other' })).toBe(false)
        expect(await engine.applyRemote({ type: 'label.created', label: { id: 'l-1' }, label_id: 'l-1' })).toBe(false)
        expect((await db.snapshot()).epics).toEqual([])
    })

    it.each([
        ['epic.deleted', 'epic', EPIC, { epic_id: 'e-1' }, { epic_id: null }],
        ['milestone.deleted', 'milestone', MILESTONE, { milestone_id: 'm-1' }, { milestone_id: null }],
        ['label.deleted', 'label', LABEL, { label_ids: ['l-0', 'l-1'] }, { label_ids: ['l-0'] }],
    ] as [string, string, { id: string }, Record<string, unknown>, Record<string, unknown>][])('%s clears the reference on the tickets it holds, and their version does not move', async (type, name, body, before, after) => {
        stubFetch({ ...listRoutes([ticket({ id: 't-1', version: 7 }), ticket({ id: 't-2', version: 3 })]) })
        const { engine, db } = await startEngine()
        await db.write(async (tx) => {
            const row = (await tx.serverTickets.get('t-1'))!
            await tx.serverTickets.put({ ...row, ...before })
            await tx.tickets.put({ ...row, ...before })
        })

        await engine.applyRemote(feed(type, name, body))

        const snapshot = await db.snapshot()
        expect(snapshot.tickets.find((t) => t.id === 't-1')).toMatchObject({ ...after, version: 7 })
        expect((await server(db)).find((t) => t.id === 't-1')).toMatchObject({ ...after, version: 7 })
        expect(snapshot.tickets.find((t) => t.id === 't-2')).toMatchObject({ version: 3 })
    })

    it('clears it from a ticket with unsent edits, and from the edit, so the send never names a deleted epic', async () => {
        let put: unknown
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 1 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                put = await bodyOf(request)
                return ok(ticket({ id: 't-1', version: 2 }))
            },
        })
        // Offline: nothing is sent until the test lets it.
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.updateTicket('t-1', { epic_id: 'e-1', title: 'Edited' })
        await engine.applyRemote(feed('epic.deleted', 'epic', EPIC))

        expect((await db.snapshot()).tickets[0]).toMatchObject({ epic_id: null, title: 'Edited' })
        expect((await db.snapshot()).outbox[0]).toMatchObject({ payload: { epic_id: null, title: 'Edited' } })

        net.goOnline()
        await engine.idle()
        expect(put).toMatchObject({ epic_id: null, title: 'Edited' })
    })

    it('clears it even when the epic itself was never held on this device', async () => {
        stubFetch(listRoutes([ticket({ id: 't-1', version: 1 })]))
        const { engine, db } = await startEngine()
        await db.write(async (tx) => {
            const row = (await tx.serverTickets.get('t-1'))!
            await tx.serverTickets.put({ ...row, epic_id: 'e-1' })
            await tx.tickets.put({ ...row, epic_id: 'e-1' })
        })
        await engine.applyRemote(feed('epic.deleted', 'epic', EPIC))
        expect((await db.snapshot()).tickets[0].epic_id).toBeNull()
    })
})

describe('a sprint call that fails after the PUT landed (LAM-103)', () => {
    it('is retried without a conflict: the 409 against our own PUT counts as applied, and the sprint call goes through', async () => {
        const calls: string[] = []
        let postFails = true
        const body = { ...ticket({ id: 't-1', version: 2 }), epic_id: 'e-1' }
        stubFetch({
            ...listRoutes([], [], [], { sprints: [SPRINT] }),
            // In no sprint yet: the sprint filter answers with nothing.
            'POST /api/v1/tickets/list': async (request) =>
                page((await bodyOf(request)).filter ? [] : [ticket({ id: 't-1', version: 1 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                calls.push(`PUT ${request.headers.get('If-Match')}`)
                // The first lands; the retry is on the old version, so it is refused.
                if (calls.length === 1) return ok(body)
                return new Response(
                    JSON.stringify({ title: 'Conflict', status: 409, code: 'ticket_conflict', current: { ...body, version: 3 }, changed_by: { account_id: ME, display_name: 'Me' }, changed_at: '2026-01-01T00:00:05Z' }),
                    { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
                )
            },
            'POST /api/v1/sprints/sp-1/tickets': () => {
                calls.push('POST')
                if (postFails) return new Response('bad gateway', { status: 502 })
                return new Response(null, { status: 204 })
            },
            'GET /api/v1/tickets/t-1': () => ok({ ...body, version: 4 }),
        })
        const { engine, db, clock } = await startEngine()
        await engine.updateTicket('t-1', { epic_id: 'e-1', sprint_ids: ['sp-1'] })
        await engine.idle()
        expect((await db.snapshot()).outbox[0]).toMatchObject({ state: 'pending', attempts: 1 })

        postFails = false
        clock.advance(60_000)
        await engine.idle()

        expect(calls).toEqual(['PUT "1"', 'POST', 'PUT "1"', 'POST'])
        const snapshot = await db.snapshot()
        expect(snapshot.outbox).toEqual([])
        expect(snapshot.tickets[0]).toMatchObject({ version: 4, epic_id: 'e-1', sprint_ids: ['sp-1'] })
    })
})
