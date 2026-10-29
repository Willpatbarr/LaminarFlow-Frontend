import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { deferred, listRoutes, page, startEngine, ticket } from '../testing/harness'

// Epics, sprints and milestones became writable in LAM-105. Like labels they
// are unversioned (no If-Match, no 409); what these pin down is the call each
// edit becomes, and a ticket that names one the server has not heard of yet.

afterEach(() => {
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const EPIC = { id: 'e-1', project_id: 'p-1', name: 'Checkout', description: '', ...stamp }
const SPRINT = { id: 'sp-1', project_id: 'p-1', name: 'Sprint 1', start_date: '2026-03-01', end_date: '2026-03-14', ...stamp }
const MILESTONE = { id: 'm-1', project_id: 'p-1', name: 'v1', description: '', target_date: null, ...stamp }

type Db = Awaited<ReturnType<typeof startEngine>>['db']

async function started(extra: Parameters<typeof stubFetch>[0] = {}, tickets = [ticket({ id: 't-1', version: 1 })]) {
    stubFetch({
        ...listRoutes(tickets, [], [], { epics: [EPIC], sprints: [SPRINT], milestones: [MILESTONE] }),
        ...extra,
    })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const snapshot = (db: Db) => db.snapshot()

describe('epics', () => {
    it('creates with project, name and description, then takes the server id', async () => {
        let sent: unknown
        const { engine, db } = await started({
            'POST /api/v1/epics': async (request) => {
                sent = await bodyOf(request)
                return ok({ id: 'e-new', project_id: 'p-1', name: 'Search', description: 'Find things', ...stamp })
            },
        })
        const row = await engine.createEpic({ project_id: 'p-1', name: 'Search', description: 'Find things' })
        expect(row.id.startsWith('tmp_')).toBe(true)
        expect((await snapshot(db)).epics.map((e) => e.name).toSorted()).toEqual(['Checkout', 'Search'])
        await engine.idle()

        expect(sent).toEqual({ project_id: 'p-1', name: 'Search', description: 'Find things' })
        const after = await snapshot(db)
        expect(after.epics.map((e) => e.id).toSorted()).toEqual(['e-1', 'e-new'])
        expect(after.outbox).toEqual([])
    })

    it('renames with a PUT carrying name and description, and no If-Match', async () => {
        let body: unknown
        let ifMatch: string | null = 'unset'
        const { engine, db } = await started({
            'PUT /api/v1/epics/e-1': async (request) => {
                body = await bodyOf(request)
                ifMatch = request.headers.get('If-Match')
                return ok({ ...EPIC, name: 'Payments' })
            },
        })
        expect(await engine.updateEpic('e-1', { name: 'Payments' })).toBe(true)
        expect((await snapshot(db)).epics[0].name).toBe('Payments')
        await engine.idle()
        expect(body).toEqual({ name: 'Payments', description: '' })
        expect(ifMatch).toBeNull()
    })

    it('deleting one clears it from the tickets that had it', async () => {
        let deleted = false
        const { engine, db } = await started(
            {
                'DELETE /api/v1/epics/e-1': () => {
                    deleted = true
                    return new Response(null, { status: 204 })
                },
            },
            [ticket({ id: 't-1', version: 1, epic_id: 'e-1' })],
        )
        await engine.deleteEpic('e-1')
        expect((await snapshot(db)).epics).toEqual([])
        await engine.idle()
        expect(deleted).toBe(true)
        expect((await snapshot(db)).tickets[0].epic_id).toBeNull()
    })

    it('parks a refusal with its reason', async () => {
        const { engine, db } = await started({
            'PUT /api/v1/epics/e-1': () => problem(422, 'validation', [{ location: 'body.name', message: 'too long' }]),
        })
        await engine.updateEpic('e-1', { name: 'x' })
        await engine.idle()
        expect((await snapshot(db)).outbox).toMatchObject([{ entity: 'epic', state: 'failed' }])
    })
})

describe('sprints', () => {
    it('creates with the dates that were given, and leaves out the ones that were not', async () => {
        const bodies: unknown[] = []
        const { engine } = await started({
            'POST /api/v1/sprints': async (request) => {
                const body = await bodyOf(request)
                bodies.push(body)
                return ok({ id: `sp-${bodies.length + 1}`, project_id: 'p-1', start_date: null, end_date: null, ...body, ...stamp })
            },
        })
        await engine.createSprint({ project_id: 'p-1', name: 'A', start_date: '2026-04-01', end_date: '2026-04-14' })
        await engine.createSprint({ project_id: 'p-1', name: 'B', start_date: null, end_date: null })
        await engine.idle()
        expect(bodies).toEqual([
            { project_id: 'p-1', name: 'A', start_date: '2026-04-01', end_date: '2026-04-14' },
            { project_id: 'p-1', name: 'B' },
        ])
    })

    it('clears a date with null', async () => {
        let body: unknown
        const { engine } = await started({
            'PUT /api/v1/sprints/sp-1': async (request) => {
                body = await bodyOf(request)
                return ok({ ...SPRINT, end_date: null })
            },
        })
        await engine.updateSprint('sp-1', { end_date: null })
        await engine.idle()
        expect(body).toEqual({ name: 'Sprint 1', start_date: '2026-03-01', end_date: null })
    })
})

describe('milestones', () => {
    it('creates with a target date and edits it', async () => {
        const bodies: unknown[] = []
        const { engine } = await started({
            'POST /api/v1/milestones': async (request) => {
                bodies.push(await bodyOf(request))
                return ok({ id: 'm-2', project_id: 'p-1', name: 'v2', description: '', target_date: '2026-06-01', ...stamp })
            },
            'PUT /api/v1/milestones/m-2': async (request) => {
                bodies.push(await bodyOf(request))
                return ok({ id: 'm-2', project_id: 'p-1', name: 'v2', description: '', target_date: null, ...stamp })
            },
        })
        const row = await engine.createMilestone({ project_id: 'p-1', name: 'v2', description: '', target_date: '2026-06-01' })
        await engine.updateMilestone(row.id, { target_date: null })
        await engine.idle()
        expect(bodies).toEqual([
            { project_id: 'p-1', name: 'v2', description: '', target_date: '2026-06-01' },
            { name: 'v2', description: '', target_date: null },
        ])
    })
})

describe('a ticket filed under something the server has not heard of', () => {
    it('waits for the create, then names the real id', async () => {
        const order: string[] = []
        const puts: Record<string, unknown>[] = []
        const answer = deferred()
        const { engine, db } = await started({
            'POST /api/v1/epics': async () => {
                order.push('epic')
                return answer.promise
            },
            'PUT /api/v1/tickets/t-1': async (request) => {
                order.push('ticket')
                const body = await bodyOf(request)
                puts.push(body)
                return ok(ticket({ ...body, id: 't-1', version: 2 }))
            },
        })
        const epic = await engine.createEpic({ project_id: 'p-1', name: 'Fresh', description: '' })
        await engine.updateTicket('t-1', { epic_id: epic.id })
        expect((await snapshot(db)).tickets[0].epic_id).toBe(epic.id)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(order).toEqual(['epic'])

        answer.resolve(ok({ id: 'e-new', project_id: 'p-1', name: 'Fresh', description: '', ...stamp }))
        await engine.idle()

        expect(order).toEqual(['epic', 'ticket'])
        expect(puts[0]).toMatchObject({ epic_id: 'e-new' })
        expect((await snapshot(db)).tickets[0].epic_id).toBe('e-new')
    })

    it('does the same for a sprint, through the sprint calls', async () => {
        const calls: string[] = []
        const answer = deferred()
        const { engine, db } = await started({
            // Nothing is in any sprint yet.
            'POST /api/v1/tickets/list': async (request) =>
                (await bodyOf(request)).filter ? page([]) : page([ticket({ id: 't-1', version: 1 })]),
            'POST /api/v1/sprints': () => {
                calls.push('create sprint')
                return answer.promise
            },
            'PUT /api/v1/tickets/t-1': async (request) => ok(ticket({ ...(await bodyOf(request)), id: 't-1', version: 2 })),
            'POST /api/v1/sprints/sp-new/tickets': async (request) => {
                calls.push(`add ${(await bodyOf(request)).ticket_id}`)
                return new Response(null, { status: 204 })
            },
            'GET /api/v1/tickets/t-1': () => ok(ticket({ id: 't-1', version: 3 })),
        })
        const sprint = await engine.createSprint({ project_id: 'p-1', name: 'Next', start_date: null, end_date: null })
        await engine.updateTicket('t-1', { sprint_ids: [sprint.id] })
        answer.resolve(ok({ id: 'sp-new', project_id: 'p-1', name: 'Next', start_date: null, end_date: null, ...stamp }))
        await engine.idle()
        

        expect(calls).toEqual(['create sprint', 'add t-1'])
        expect((await snapshot(db)).tickets[0].sprint_ids).toEqual(['sp-new'])
    })
})
