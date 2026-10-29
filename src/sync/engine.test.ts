import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import type { SyncChange } from './engine'
import { deferred, docBody, listRoutes, ME, page, startEngine, ticket } from './testing/harness'
import type { Ticket } from './types'

afterEach(() => {
    vi.unstubAllGlobals()
})

const FIELDS = { title: 'New', description: '', status_id: 's-todo', assignee_id: null }

function conflictBody(
    code: 'ticket_conflict' | 'ticket_archived',
    current: Ticket,
    changedBy: string | null,
) {
    return new Response(
        JSON.stringify({
            title: 'Conflict',
            status: 409,
            code,
            current,
            changed_by: changedBy ? { account_id: changedBy, display_name: 'Someone' } : null,
            changed_at: '2026-01-01T00:00:05Z',
        }),
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    )
}

// What the screen would show, and what is still waiting to go.
async function local(db: Awaited<ReturnType<typeof startEngine>>['db']) {
    const snapshot = await db.snapshot()
    return { tickets: snapshot.tickets, outbox: snapshot.outbox }
}

// LAM-169. A caller names a row by the id it last saw. An edit that was
// started under the temporary id can reach the engine after the create's
// answer was stored but before the caller has heard of the new id (the autosave
// resolves the id, then waits its turn on the database). It must still land on
// the row, under its real id, for every kind of row.
describe('an edit under the temporary id after the swap (LAM-169)', () => {
    const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
    const kinds = [
        {
            kind: 'document',
            route: 'documents',
            row: (id: string, extra: object = {}) => docBody({ id, title: '', ...extra }),
            create: (e: Awaited<ReturnType<typeof startEngine>>['engine']) =>
                e.createDocument({ title: '', type: 'normal', aspect_type_id: null, team_id: 'team-1', project_id: null, body: {} }),
            edit: (e: Awaited<ReturnType<typeof startEngine>>['engine'], id: string) =>
                e.updateDocument(id, { title: 'Typed meanwhile' }, { base: 0, was: { title: '' } }),
            field: 'title',
            snap: (s: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>['db']['snapshot']>>) => s.documents,
        },
        {
            kind: 'ticket',
            route: 'tickets',
            row: (id: string, extra: object = {}) => ticket({ id, title: 'New', ...extra }),
            create: (e: Awaited<ReturnType<typeof startEngine>>['engine']) => e.createTicket({ ...FIELDS, project_id: 'p-1' }),
            edit: (e: Awaited<ReturnType<typeof startEngine>>['engine'], id: string) =>
                e.updateTicket(id, { title: 'Typed meanwhile' }, { base: 0, was: { title: 'New' } }),
            field: 'title',
            snap: (s: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>['db']['snapshot']>>) => s.tickets,
        },
        {
            kind: 'epic',
            route: 'epics',
            row: (id: string, extra: object = {}) => ({ id, project_id: 'p-1', name: 'Search', description: '', ...stamp, ...extra }),
            create: (e: Awaited<ReturnType<typeof startEngine>>['engine']) => e.createEpic({ project_id: 'p-1', name: 'Search', description: '' }),
            edit: (e: Awaited<ReturnType<typeof startEngine>>['engine'], id: string) => e.updateEpic(id, { description: 'Typed meanwhile' }),
            field: 'description',
            snap: (s: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>['db']['snapshot']>>) => s.epics,
        },
        {
            kind: 'milestone',
            route: 'milestones',
            row: (id: string, extra: object = {}) => ({ id, project_id: 'p-1', name: 'v2', description: '', target_date: null, ...stamp, ...extra }),
            create: (e: Awaited<ReturnType<typeof startEngine>>['engine']) =>
                e.createMilestone({ project_id: 'p-1', name: 'v2', description: '', target_date: null }),
            edit: (e: Awaited<ReturnType<typeof startEngine>>['engine'], id: string) => e.updateMilestone(id, { description: 'Typed meanwhile' }),
            field: 'description',
            snap: (s: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>['db']['snapshot']>>) => s.milestones,
        },
    ]

    for (const k of kinds) {
        it(`goes to the ${k.kind} under its real id`, async () => {
            const answer = deferred()
            const puts: { path: string; value: unknown }[] = []
            stubFetch({
                ...listRoutes(),
                [`POST /api/v1/${k.route}`]: () => answer.promise,
                [`PUT /api/v1/${k.route}/x-9`]: async (request) => {
                    const sent = await bodyOf(request)
                    puts.push({ path: new URL(request.url).pathname, value: sent[k.field] })
                    return ok({ ...k.row('x-9', { version: 2 }), ...sent })
                },
            })
            const { engine, db } = await startEngine()
            let late: Promise<boolean> | undefined
            engine.subscribe((change) => {
                if (change.swap) late = k.edit(engine, change.swap.from)
            })
            await k.create(engine)
            answer.resolve(ok(k.row('x-9', { version: 1 }), 201))
            await engine.idle()
            expect(await late).toBe(true)
            await engine.idle()

            expect(puts).toEqual([{ path: `/api/v1/${k.route}/x-9`, value: 'Typed meanwhile' }])
            expect(k.snap(await db.snapshot()).find((r) => r.id === 'x-9')).toMatchObject({ [k.field]: 'Typed meanwhile' })
        })
    }
})

describe('create', () => {
    it('shows the ticket before the request resolves, then takes the server id and version', async () => {
        const answer = deferred()
        stubFetch({ ...listRoutes(), 'POST /api/v1/tickets': () => answer.promise })
        const { engine, db } = await startEngine()
        const changes: SyncChange[] = []
        engine.subscribe((change) => changes.push(change))

        const created = await engine.createTicket({ ...FIELDS, project_id: 'p-1' })

        // The request is on the wire and unanswered; the row is already there.
        expect(created).toMatchObject({ id: 'tmp_1', title: 'New', version: 0, updated_by: ME })
        expect((await local(db)).tickets).toEqual([created])
        expect((await local(db)).outbox).toMatchObject([{ kind: 'create', entity_id: 'tmp_1' }])

        answer.resolve(ok(ticket({ id: 't-9', title: 'New', version: 1, updated_by: ME })))
        await engine.idle()

        const after = await local(db)
        expect(after.tickets).toMatchObject([{ id: 't-9', title: 'New', version: 1 }])
        expect(after.outbox).toEqual([])
        expect(changes).toContainEqual({ swap: { from: 'tmp_1', to: 't-9' } })
    })

    it('sends status_id and assignee_id as keys even when they are null', async () => {
        const sent: unknown[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': async (request) => {
                sent.push(await bodyOf(request))
                return ok(ticket({ id: 't-9' }))
            },
        })
        const { engine } = await startEngine()

        await engine.createTicket({ ...FIELDS, status_id: null, project_id: 'p-1' })
        await engine.idle()

        expect(sent).toEqual([
            { project_id: 'p-1', title: 'New', description: '', status_id: null, assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] },
        ])
    })

    it('rewrites edits queued behind an in-flight create to the server id and version', async () => {
        const answer = deferred()
        const puts: { url: string; ifMatch: string | null; body: unknown }[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': () => answer.promise,
            'PUT /api/v1/tickets/t-9': async (request) => {
                puts.push({
                    url: new URL(request.url).pathname,
                    ifMatch: request.headers.get('If-Match'),
                    body: await bodyOf(request),
                })
                return ok(ticket({ id: 't-9', title: 'Renamed', version: 2 }))
            },
        })
        const { engine, db } = await startEngine()

        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        // The create is on the wire, so this cannot be folded into it.
        await engine.updateTicket('tmp_1', { title: 'Renamed' })
        expect((await local(db)).tickets).toMatchObject([{ id: 'tmp_1', title: 'Renamed' }])

        answer.resolve(ok(ticket({ id: 't-9', title: 'New', version: 1 })))
        await engine.idle()

        expect(puts).toEqual([
            {
                url: '/api/v1/tickets/t-9',
                ifMatch: '"1"',
                body: { title: 'Renamed', description: '', status_id: 's-todo', assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] },
            },
        ])
        const after = await local(db)
        expect(after.tickets).toMatchObject([{ id: 't-9', title: 'Renamed', version: 2 }])
        expect(after.outbox).toEqual([])
    })

    it('keeps the later edit on screen when the create is answered first', async () => {
        const createAnswer = deferred()
        const putAnswer = deferred()
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': () => createAnswer.promise,
            'PUT /api/v1/tickets/t-9': () => putAnswer.promise,
        })
        const { engine, db } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.updateTicket('tmp_1', { title: 'Renamed' })

        createAnswer.resolve(ok(ticket({ id: 't-9', title: 'New', version: 1 })))
        // The create's answer says "New"; the unsent rename must still win.
        await vi.waitFor(async () =>
            expect((await local(db)).tickets).toMatchObject([{ id: 't-9', title: 'Renamed' }]),
        )

        putAnswer.resolve(ok(ticket({ id: 't-9', title: 'Renamed', version: 2 })))
        await engine.idle()
    })

    it('folds an edit into a create that has not been sent, so one request goes out', async () => {
        const posts: unknown[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': async (request) => {
                posts.push(await bodyOf(request))
                return ok(ticket({ id: 't-9', title: 'Renamed' }))
            },
        })
        const { engine, db, net } = await startEngine()
        net.goOffline()

        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.updateTicket('tmp_1', { title: 'Renamed' })
        expect((await local(db)).outbox).toHaveLength(1)

        net.goOnline()
        await engine.idle()

        expect(posts).toMatchObject([{ title: 'Renamed', project_id: 'p-1' }])
    })
})

describe('update', () => {
    it('shows the edit immediately and reconciles to the server copy', async () => {
        const answer = deferred()
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return answer.promise
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Edited' })

        expect((await local(db)).tickets).toMatchObject([
            { id: 't-1', title: 'Edited', version: 3, updated_by: ME },
        ])
        expect(seen).toEqual(['"3"'])

        answer.resolve(
            ok(ticket({ title: 'Edited', version: 4, updated_at: '2026-01-01T00:00:01Z', updated_by: ME })),
        )
        await engine.idle()

        const after = await local(db)
        expect(after.tickets).toEqual([
            ticket({ title: 'Edited', version: 4, updated_at: '2026-01-01T00:00:01Z', updated_by: ME }),
        ])
        expect(after.outbox).toEqual([])
    })

    it('sends two queued updates in order, the second on the version the first returned', async () => {
        const first = deferred()
        const requests: { ifMatch: string | null; title: string }[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                requests.push({ ifMatch: request.headers.get('If-Match'), title: body.title })
                if (requests.length === 1) return first.promise
                return ok(ticket({ title: body.title, description: 'More', version: 5 }))
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'One' })
        // The first is on the wire, so this one queues behind it.
        await engine.updateTicket('t-1', { description: 'More' })
        expect((await local(db)).outbox).toMatchObject([
            { kind: 'update', base_version: 3 },
            { kind: 'update', base_version: null },
        ])
        expect(requests).toHaveLength(1)

        first.resolve(ok(ticket({ title: 'One', version: 4 })))
        await engine.idle()

        expect(requests).toEqual([
            { ifMatch: '"3"', title: 'One' },
            { ifMatch: '"4"', title: 'One' },
        ])
        expect((await local(db)).tickets).toMatchObject([
            { title: 'One', description: 'More', version: 5 },
        ])
    })

    it('folds consecutive unsent updates to one ticket into a single request', async () => {
        const bodies: unknown[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                bodies.push(await bodyOf(request))
                return ok(ticket({ title: 'Two', description: 'More', version: 4 }))
            },
        })
        const { engine, db, net } = await startEngine()
        net.goOffline()

        await engine.updateTicket('t-1', { title: 'One' })
        await engine.updateTicket('t-1', { title: 'Two' })
        await engine.updateTicket('t-1', { description: 'More' })
        expect((await local(db)).outbox).toMatchObject([{ kind: 'update', base_version: 3 }])

        net.goOnline()
        await engine.idle()

        expect(bodies).toEqual([
            { title: 'Two', description: 'More', status_id: 's-todo', assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] },
        ])
    })

    it('queues nothing for a patch that changes nothing', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()

        expect(await engine.updateTicket('t-1', { title: 'Write the outbox' })).toBe(true)
        expect(await engine.updateTicket('nope', { title: 'x' })).toBe(false)

        expect((await local(db)).outbox).toEqual([])
    })
})

describe('update from the version an edit began on (LAM-131)', () => {
    const sentAs = (seen: (string | null)[]) => (request: Request) => {
        seen.push(request.headers.get('If-Match'))
        return ok(ticket({ title: 'Mine', version: 4, updated_by: ME }))
    }

    it('sends the version the edit began on when someone else moved the row meanwhile, and parks the 409', async () => {
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 4 }), 'acc-other')
            },
        })
        const { engine, db } = await startEngine()
        // B's edit arrives live while A is typing.
        await engine.applyRemote(frame('ticket.updated', ticket({ title: 'Theirs', version: 4 })))

        await engine.updateTicket('t-1', { title: 'Mine' }, { base: 3, was: { title: 'Write the outbox' } })
        await engine.idle()

        expect(seen).toEqual(['"3"'])
        const after = await local(db)
        expect(after.outbox).toMatchObject([
            { state: 'conflict', payload: { title: 'Mine' }, conflict: { current: { title: 'Theirs', version: 4 } } },
        ])
        expect(after.tickets).toMatchObject([{ title: 'Mine' }])
    })

    it('a solo edit, with or without a base, goes on the current version', async () => {
        const seen: (string | null)[] = []
        stubFetch({ ...listRoutes([ticket({ version: 3 })]), 'PUT /api/v1/tickets/t-1': sentAs(seen) })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Mine' }, { base: 3 })
        await engine.idle()
        await engine.updateTicket('t-1', { description: 'more' })
        await engine.idle()

        expect(seen).toEqual(['"3"', '"4"'])
        expect((await local(db)).outbox).toEqual([])
    })

    it('after our own save was answered, an edit that began before it is made on the answer, not the old version', async () => {
        const seen: (string | null)[] = []
        let version = 3
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                version += 1
                return ok(ticket({ title: 'Mine ' + version, version, updated_by: ME }))
            },
        })
        const { engine, db } = await startEngine()

        // One editing session: began on 3, saved, typed on, saved again.
        await engine.updateTicket('t-1', { title: 'Mine 1' }, { base: 3 })
        await engine.idle()
        await engine.updateTicket('t-1', { title: 'Mine 2' }, { base: 3 })
        await engine.idle()
        await engine.updateTicket('t-1', { title: 'Mine 3' }, { base: 3 })
        await engine.idle()

        expect(seen).toEqual(['"3"', '"4"', '"5"'])
        expect((await local(db)).outbox).toEqual([])
    })

    it('an edit folded into a pending entry keeps the earliest base', async () => {
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 4 }), 'acc-other')
            },
        })
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.updateTicket('t-1', { title: 'Mine' }, { base: 3, was: { title: 'Write the outbox' } })
        await engine.applyRemote(frame('ticket.updated', ticket({ title: 'Theirs', version: 4 })))
        // Typed on after B's change arrived: the newer base and start value must not replace the first.
        await engine.updateTicket('t-1', { title: 'Mine, longer' }, { base: 4, was: { title: 'Theirs' } })
        expect((await local(db)).outbox).toMatchObject([
            { base_version: 3, was: { title: 'Write the outbox' }, payload: { title: 'Mine, longer' } },
        ])

        net.goOnline()
        await engine.idle()
        expect(seen).toEqual(['"3"'])
        expect((await local(db)).outbox).toMatchObject([{ state: 'conflict' }])
    })

    it('a retry of our own write that already landed is not a conflict', async () => {
        let calls = 0
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                calls += 1
                // First answer lost on the wire; the retry meets our own write.
                if (calls === 1) return Promise.reject(new TypeError('network'))
                return conflictBody('ticket_conflict', ticket({ title: 'Mine', version: 4, updated_by: ME }), ME)
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Mine' }, { base: 3 })
        await engine.idle()
        await engine.retryNow()
        await engine.idle()

        expect((await local(db)).outbox.filter((entry) => entry.state === 'conflict')).toEqual([])
    })

    it('a status change, which names no base, goes on the current version', async () => {
        const seen: (string | null)[] = []
        stubFetch({ ...listRoutes([ticket({ version: 3 })]), 'PUT /api/v1/tickets/t-1': sentAs(seen) })
        const { engine } = await startEngine()
        await engine.applyRemote(frame('ticket.updated', ticket({ title: 'Theirs', version: 4 })))

        await engine.updateTicket('t-1', { status_id: 's-done' })
        await engine.idle()

        expect(seen).toEqual(['"4"'])
    })
})

describe('archive', () => {
    it('removes the row at once and sends DELETE with If-Match', async () => {
        const answer = deferred()
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return answer.promise
            },
        })
        const { engine, db } = await startEngine()

        await engine.archiveTicket('t-1')
        expect((await local(db)).tickets).toEqual([])
        expect(seen).toEqual(['"2"'])

        answer.resolve(new Response(null, { status: 204, headers: { ETag: '"3"' } }))
        await engine.idle()
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
    })

    it('withdraws a create the server never saw instead of sending anything', async () => {
        const fetchMock = stubFetch(listRoutes())
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        const callsBefore = fetchMock.mock.calls.length

        await engine.archiveTicket('tmp_1')
        net.goOnline()
        await engine.idle()

        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
        // Coming back online re-checks nothing but the (empty) outbox.
        expect(fetchMock.mock.calls.length).toBe(callsBefore)
    })

    it('treats "already archived" as done, whoever archived it', async () => {
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () =>
                conflictBody('ticket_archived', ticket({ version: 3 }), 'acc-other'),
        })
        const { engine, db } = await startEngine()

        await engine.archiveTicket('t-1')
        await engine.idle()

        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
    })
})

describe('unarchive', () => {
    const noContent = (version: number) =>
        new Response(null, { status: 204, headers: { ETag: `"${version}"` } })

    it('after the archive was sent: the row comes back at once, and POST /unarchive carries the archived version', async () => {
        const answer = deferred()
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => noContent(3),
            'POST /api/v1/tickets/t-1/unarchive': (request) => {
                seen.push(request.headers.get('If-Match'))
                return answer.promise
            },
        })
        const { engine, db } = await startEngine()
        const before = ticket({ version: 2 })
        await engine.archiveTicket('t-1')
        await engine.idle()
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })

        expect(await engine.unarchiveTicket(before)).toBe('t-1')
        // Optimistic: back before the server has answered, with an unarchive waiting.
        expect((await local(db)).tickets).toMatchObject([{ id: 't-1', title: 'Write the outbox' }])
        expect((await local(db)).outbox).toMatchObject([{ kind: 'unarchive', entity_id: 't-1' }])
        await vi.waitFor(() => expect(seen).toEqual(['"3"']))

        answer.resolve(noContent(4))
        await engine.idle()
        const after = await local(db)
        expect(after.outbox).toEqual([])
        expect(after.tickets).toMatchObject([{ id: 't-1', version: 4 }])
    })

    it('before the archive was sent: withdraws it and sends nothing', async () => {
        const fetchMock = stubFetch(listRoutes([ticket({ version: 2 })]))
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.archiveTicket('t-1')
        expect((await local(db)).tickets).toEqual([])
        const callsBefore = fetchMock.mock.calls.length

        expect(await engine.unarchiveTicket(ticket({ version: 2 }))).toBe('t-1')
        net.goOnline()
        await engine.idle()

        expect((await local(db)).tickets).toMatchObject([{ id: 't-1' }])
        expect((await local(db)).outbox).toEqual([])
        expect(fetchMock.mock.calls.length).toBe(callsBefore)
    })

    it('while the archive is on the wire: queues behind it and names the archived version', async () => {
        const archiveAnswer = deferred()
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => archiveAnswer.promise,
            'POST /api/v1/tickets/t-1/unarchive': (request) => {
                seen.push(request.headers.get('If-Match'))
                return noContent(4)
            },
        })
        const { engine, db } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.unarchiveTicket(ticket({ version: 2 }))
        expect((await local(db)).outbox).toMatchObject([{ kind: 'archive' }, { kind: 'unarchive' }])
        expect((await local(db)).tickets).toMatchObject([{ id: 't-1' }])

        archiveAnswer.resolve(noContent(3))
        await engine.idle()

        expect(seen).toEqual(['"3"'])
        expect(await local(db)).toMatchObject({ outbox: [], tickets: [{ id: 't-1', version: 4 }] })
    })

    it('offline: the restore waits in the outbox and is sent when the network returns', async () => {
        const seen: string[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => noContent(3),
            'POST /api/v1/tickets/t-1/unarchive': () => {
                seen.push('unarchive')
                return noContent(4)
            },
        })
        const { engine, db, net } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()

        net.goOffline()
        await engine.unarchiveTicket(ticket({ version: 2 }))
        await engine.idle()
        expect(seen).toEqual([])
        expect((await local(db)).tickets).toMatchObject([{ id: 't-1' }])

        net.goOnline()
        await engine.idle()
        expect(seen).toEqual(['unarchive'])
        expect((await local(db)).outbox).toEqual([])
    })

    it('a ticket whose unsent create the archive withdrew is created again', async () => {
        stubFetch(listRoutes())
        const { engine, db, net } = await startEngine()
        net.goOffline()
        const created = await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.archiveTicket(created.id)
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })

        const id = await engine.unarchiveTicket(created)

        expect(id).toBe('tmp_2')
        expect(await local(db)).toMatchObject({
            tickets: [{ id: 'tmp_2', title: 'New' }],
            outbox: [{ kind: 'create', entity_id: 'tmp_2' }],
        })
    })

    it('does nothing for a ticket that is not archived', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()

        expect(await engine.unarchiveTicket(ticket())).toBeNull()
        expect((await local(db)).outbox).toEqual([])
    })

    it('adopts a 409 that is our own restore, whose answer was lost', async () => {
        let posts = 0
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => noContent(3),
            'POST /api/v1/tickets/t-1/unarchive': () => {
                posts += 1
                if (posts === 1) throw new TypeError('Failed to fetch')
                return conflictBody('ticket_conflict', ticket({ version: 4, updated_by: ME }), ME)
            },
        })
        const { engine, db, clock } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()
        await engine.unarchiveTicket(ticket({ version: 2 }))
        await engine.idle()
        clock.advance(5_000)
        await engine.idle()

        expect(posts).toBe(2)
        expect(await local(db)).toMatchObject({ outbox: [], tickets: [{ id: 't-1', version: 4 }] })
    })

    it("parks a restore that collided with someone else's change, and discarding it leaves the ticket archived", async () => {
        stubFetch({
            ...listRoutes([ticket({ version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => noContent(3),
            'POST /api/v1/tickets/t-1/unarchive': () =>
                conflictBody('ticket_conflict', ticket({ version: 5, title: 'Theirs' }), 'acc-other'),
        })
        const { engine, db } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()
        await engine.unarchiveTicket(ticket({ version: 2 }))
        await engine.idle()

        const parked = (await local(db)).outbox
        expect(parked).toMatchObject([{ kind: 'unarchive', state: 'conflict' }])
        expect((await local(db)).tickets).toMatchObject([{ id: 't-1', title: 'Write the outbox' }])

        await engine.discard(parked[0].id)
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
    })
})

describe('when a send fails', () => {
    it('keeps the entry and the local row on a network error, then succeeds on retry', async () => {
        let attempts = 0
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                attempts += 1
                if (attempts < 3) throw new TypeError('Failed to fetch')
                return ok(ticket({ title: 'Edited', version: 4 }))
            },
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Edited' })
        await engine.idle()

        let now = await local(db)
        expect(now.tickets).toMatchObject([{ title: 'Edited', version: 3 }])
        expect(now.outbox).toMatchObject([
            { state: 'pending', attempts: 1, error: { status: 0, code: 'network' } },
        ])
        expect(clock.nextDelay()).toBe(1_000)

        // Second failure: the wait doubles.
        clock.advance(1_000)
        await engine.idle()
        expect((await local(db)).outbox).toMatchObject([{ state: 'pending', attempts: 2 }])
        expect(clock.nextDelay()).toBe(2_000)

        clock.advance(2_000)
        await engine.idle()
        now = await local(db)
        expect(now.tickets).toMatchObject([{ title: 'Edited', version: 4 }])
        expect(now.outbox).toEqual([])
        expect(attempts).toBe(3)
    })

    it('caps the backoff', async () => {
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        const { engine, clock } = await startEngine({ backoff: { baseMs: 1_000, maxMs: 4_000 } })
        await engine.updateTicket('t-1', { title: 'Edited' })
        await engine.idle()

        const delays = []
        for (let i = 0; i < 5; i++) {
            const delay = clock.nextDelay()!
            delays.push(delay)
            clock.advance(delay)
            await engine.idle()
        }
        expect(delays).toEqual([1_000, 2_000, 4_000, 4_000, 4_000])
    })

    it('retries as soon as the network comes back, without waiting out the backoff', async () => {
        let attempts = 0
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                attempts += 1
                if (attempts === 1) throw new TypeError('Failed to fetch')
                return ok(ticket({ title: 'Edited', version: 4 }))
            },
        })
        const { engine, db, net } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Edited' })
        await engine.idle()

        net.goOnline()
        await engine.idle()

        expect((await local(db)).outbox).toEqual([])
    })

    it('retries a 5xx with backoff and does not hold up another ticket', async () => {
        let attempts = 0
        stubFetch({
            ...listRoutes([ticket({ id: 't-1' }), ticket({ id: 't-2' })]),
            'PUT /api/v1/tickets/t-1': () => {
                attempts += 1
                return attempts === 1 ? problem(503, 'unavailable') : ok(ticket({ title: 'A', version: 2 }))
            },
            'PUT /api/v1/tickets/t-2': () => ok(ticket({ id: 't-2', title: 'B', version: 2 })),
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'A' })
        await engine.updateTicket('t-2', { title: 'B' })
        await engine.idle()

        expect((await local(db)).outbox).toMatchObject([
            { entity_id: 't-1', state: 'pending', attempts: 1, error: { status: 503 } },
        ])

        clock.advance(1_000)
        await engine.idle()
        expect((await local(db)).outbox).toEqual([])
    })

    it('does not fold a new edit into an entry whose answer was lost', async () => {
        // The first PUT reached the server (v2) but its response did not come
        // back. The user then edits again. The retry of the first is refused -
        // by our own write - and must be recognised as such, so the second edit
        // still goes out, on top of it.
        const requests: { ifMatch: string | null; title: string }[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 1 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                requests.push({ ifMatch: request.headers.get('If-Match'), title: body.title })
                if (requests.length === 1) throw new TypeError('Failed to fetch')
                if (requests.length === 2) {
                    return conflictBody('ticket_conflict', ticket({ title: 'One', version: 2 }), ME)
                }
                return ok(ticket({ title: 'Two', version: 3 }))
            },
        })
        const { engine, db, clock } = await startEngine()
        await engine.updateTicket('t-1', { title: 'One' })
        await engine.idle()

        await engine.updateTicket('t-1', { title: 'Two' })
        expect((await local(db)).outbox).toHaveLength(2)

        clock.advance(1_000)
        await engine.idle()

        expect(requests).toEqual([
            { ifMatch: '"1"', title: 'One' },
            { ifMatch: '"1"', title: 'One' },
            { ifMatch: '"2"', title: 'Two' },
        ])
        expect(await local(db)).toMatchObject({ tickets: [{ title: 'Two', version: 3 }], outbox: [] })
    })
})

describe('401', () => {
    it('parks the entry, stops the whole drain, and carries on after resume()', async () => {
        let signedIn = false
        const sent: string[] = []
        const put = (id: string) => async (request: Request) => {
            sent.push(id)
            if (!signedIn) return problem(401, 'unauthorized')
            return ok(ticket({ id, title: (await bodyOf(request)).title, version: 2 }))
        }
        stubFetch({
            ...listRoutes([ticket({ id: 't-1' }), ticket({ id: 't-2' })]),
            'PUT /api/v1/tickets/t-1': put('t-1'),
            'PUT /api/v1/tickets/t-2': put('t-2'),
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'A' })
        await engine.updateTicket('t-2', { title: 'B' })
        await engine.idle()

        // One request, one 401, and nothing after it - not even for t-2.
        expect(sent).toEqual(['t-1'])
        expect(engine.status().paused).toBe(true)
        let now = await local(db)
        expect(now.outbox).toMatchObject([
            { entity_id: 't-1', state: 'unauthorized' },
            { entity_id: 't-2', state: 'pending' },
        ])
        expect(now.tickets.map((t) => t.title).sort()).toEqual(['A', 'B'])
        // No timer is waiting to try again behind the user's back.
        expect(clock.nextDelay()).toBeNull()

        signedIn = true
        await engine.resume()
        await engine.idle()

        expect(sent).toEqual(['t-1', 't-1', 't-2'])
        expect(engine.status().paused).toBe(false)
        now = await local(db)
        expect(now.outbox).toEqual([])
    })
})

describe('409', () => {
    function conflicted() {
        const theirs = ticket({ title: 'Theirs', version: 5, updated_by: 'acc-other' })
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 }), ticket({ id: 't-2' })]),
            'PUT /api/v1/tickets/t-1': () => conflictBody('ticket_conflict', theirs, 'acc-other'),
            'PUT /api/v1/tickets/t-2': () => ok(ticket({ id: 't-2', title: 'B', version: 2 })),
        })
        return theirs
    }

    it('parks with the server copy stored, keeps the local row, and does not block another ticket', async () => {
        const theirs = conflicted()
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.updateTicket('t-2', { title: 'B' })
        await engine.idle()

        const now = await local(db)
        expect(now.outbox).toMatchObject([
            {
                entity_id: 't-1',
                state: 'conflict',
                conflict: {
                    code: 'ticket_conflict',
                    current: theirs,
                    changed_by: { account_id: 'acc-other', display_name: 'Someone' },
                    changed_at: '2026-01-01T00:00:05Z',
                },
            },
        ])
        // Mine is still what the screen shows; t-2 went through regardless.
        expect(now.tickets).toMatchObject([
            { id: 't-1', title: 'Mine' },
            { id: 't-2', title: 'B', version: 2 },
        ])
        // And it is not retried.
        expect(clock.nextDelay()).toBeNull()
    })

    it('blocks later entries for the same ticket until it is resolved', async () => {
        conflicted()
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()

        // Folded into the parked entry: still one entry, still a conflict.
        await engine.updateTicket('t-1', { description: 'and more' })
        await engine.archiveTicket('t-1')
        await engine.idle()

        expect((await local(db)).outbox).toMatchObject([
            { kind: 'update', state: 'conflict', payload: { title: 'Mine', description: 'and more' } },
            { kind: 'archive', state: 'pending' },
        ])
    })

    it('discard() drops the entry and puts the row back to the server copy', async () => {
        const theirs = conflicted()
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()
        const [entry] = (await local(db)).outbox

        expect(await engine.discard(entry.id)).toBe(true)

        const now = await local(db)
        expect(now.outbox).toEqual([])
        expect(now.tickets.find((t) => t.id === 't-1')).toEqual(theirs)
    })

    it('retry() resends on the version the conflict showed ("mine wins")', async () => {
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return seen.length === 1
                    ? conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 5 }), 'acc-other')
                    : ok(ticket({ title: 'Mine', version: 6 }))
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()
        const [entry] = (await local(db)).outbox

        expect(await engine.retry(entry.id)).toBe(true)
        await engine.idle()

        expect(seen).toEqual(['"3"', '"5"'])
        expect(await local(db)).toMatchObject({ tickets: [{ title: 'Mine', version: 6 }], outbox: [] })
    })

    it('treats the echo of its own lost write as success and adopts the server copy', async () => {
        const echoed = ticket({ title: 'Mine', version: 4, updated_by: ME })
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => conflictBody('ticket_conflict', echoed, ME),
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()

        expect(await local(db)).toEqual({ tickets: [echoed], outbox: [] })
    })

    it('still parks when the newer copy is ours but is not what this entry sent', async () => {
        // Same account, another tab: a real conflict, not an echo.
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () =>
                conflictBody('ticket_conflict', ticket({ title: 'From my other tab', version: 4 }), ME),
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()

        expect(await local(db)).toMatchObject({
            tickets: [{ title: 'Mine' }],
            outbox: [{ state: 'conflict' }],
        })
    })

    it('parks an edit to a ticket archived underneath it; discarding removes the row', async () => {
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () =>
                conflictBody('ticket_archived', ticket({ version: 4 }), 'acc-other'),
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()

        let now = await local(db)
        expect(now.outbox).toMatchObject([{ state: 'conflict', conflict: { code: 'ticket_archived' } }])
        expect(now.tickets).toMatchObject([{ title: 'Mine' }])

        await engine.discard(now.outbox[0].id)
        now = await local(db)
        expect(now).toEqual({ tickets: [], outbox: [] })
    })
})

describe('422', () => {
    const errors = [{ location: 'body.title', message: 'must not be empty' }]

    it('parks as failed with the errors, keeps the row, and does not retry', async () => {
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => problem(422, 'validation_failed', errors),
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: '' })
        await engine.idle()

        const now = await local(db)
        expect(now.outbox).toMatchObject([
            { state: 'failed', error: { status: 422, code: 'validation_failed', errors } },
        ])
        expect(now.tickets).toMatchObject([{ title: '' }])
        expect(clock.nextDelay()).toBeNull()
    })

    it('sends again once the user has changed the refused edit', async () => {
        const titles: string[] = []
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const { title } = await bodyOf(request)
                titles.push(title)
                return title === ''
                    ? problem(422, 'validation_failed', errors)
                    : ok(ticket({ title, version: 2 }))
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: '' })
        await engine.idle()

        await engine.updateTicket('t-1', { title: 'Fixed' })
        await engine.idle()

        expect(titles).toEqual(['', 'Fixed'])
        expect(await local(db)).toMatchObject({ tickets: [{ title: 'Fixed', version: 2 }], outbox: [] })
    })

    it('discard() of a refused create removes the row', async () => {
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': () => problem(422, 'validation_failed', errors),
        })
        const { engine, db } = await startEngine()
        await engine.createTicket({ ...FIELDS, title: '', project_id: 'p-1' })
        await engine.idle()
        const [entry] = (await local(db)).outbox
        expect(entry.state).toBe('failed')

        await engine.discard(entry.id)

        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
    })
})

describe('hydration', () => {
    it('pages every list until has_more is false', async () => {
        const cursors: (string | undefined)[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets/list': async (request) => {
                const body = await bodyOf(request)
                cursors.push(body.cursor)
                expect(body.limit).toBe(200)
                if (body.cursor === undefined) return page([ticket({ id: 't-1' })], 'c1')
                if (body.cursor === 'c1') return page([ticket({ id: 't-2' })], 'c2')
                return page([ticket({ id: 't-3' })])
            },
        })
        const { engine, db } = await startEngine()

        expect(cursors).toEqual([undefined, 'c1', 'c2'])
        expect(engine.status()).toMatchObject({ hydration: 'done', hydrated: true })
        const snapshot = await db.snapshot()
        expect(snapshot.tickets.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3'])
        expect(snapshot.teams).toEqual([{ id: 'team-1', workspace_id: 'ws-1', name: 'Core' }])
        expect(snapshot.projects).toEqual([{ id: 'p-1', team_id: 'team-1', name: 'Launch' }])
        expect(snapshot.statuses.map((s) => [s.name, s.team_id, s.position])).toEqual([
            ['In Progress', 'team-1', 2],
            ['Done', 'team-1', 3],
            ['To Do', 'team-1', 1],
        ])
    })

    it('does not clobber a ticket with unsent changes', async () => {
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()

        // Someone else has moved it on in the meantime.
        stubFetch({
            ...listRoutes([ticket({ title: 'Theirs', version: 4 })]),
            'PUT /api/v1/tickets/t-1': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        expect(await engine.hydrate()).toBe(true)

        const now = await local(db)
        expect(now.tickets).toMatchObject([{ title: 'Mine' }])
        // The entry still names the version the edit was made on, so sending
        // it reports the conflict instead of overwriting their change.
        expect(now.outbox).toMatchObject([{ base_version: 3, state: 'pending' }])
    })

    it('removes a ticket the server no longer lists, unless it has unsent changes', async () => {
        stubFetch({
            ...listRoutes([ticket({ id: 't-1' }), ticket({ id: 't-2' })]),
            'PUT /api/v1/tickets/t-2': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-2', { title: 'Mine' })
        await engine.idle()

        stubFetch({
            ...listRoutes([]),
            'PUT /api/v1/tickets/t-2': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        await engine.hydrate()

        expect((await local(db)).tickets).toMatchObject([{ id: 't-2', title: 'Mine' }])
    })

    it('keeps a ticket created locally that the server has not seen yet', async () => {
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        const { engine, db } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()

        await engine.hydrate()

        expect((await local(db)).tickets).toMatchObject([{ id: 'tmp_1' }])
    })

    it('reports failure, changes nothing, and retries with backoff', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db, clock } = await startEngine()

        stubFetch({
            ...listRoutes([]),
            'POST /api/v1/tickets/list': () => problem(500, 'internal'),
        })
        expect(await engine.hydrate()).toBe(false)
        await engine.idle()
        expect(engine.status()).toMatchObject({ hydration: 'failed', hydrated: true })
        // Half a list is never applied: the ticket is still there.
        expect((await local(db)).tickets).toHaveLength(1)

        stubFetch(listRoutes([]))
        clock.advance(clock.nextDelay()!)
        await engine.idle()
        expect(engine.status().hydration).toBe('done')
        expect((await local(db)).tickets).toEqual([])
    })

    it('pauses on a 401 and hydrates again on resume()', async () => {
        stubFetch({ 'POST /api/v1/teams/list': () => problem(401, 'unauthorized') })
        const { engine, clock } = await startEngine()
        expect(engine.status()).toEqual({
            hydration: 'failed',
            hydrated: false,
            paused: true,
            hydrationFailure: null,
        })
        expect(clock.nextDelay()).toBeNull()

        stubFetch(listRoutes([ticket()]))
        await engine.resume()
        await engine.idle()

        expect(engine.status()).toEqual({
            hydration: 'done',
            hydrated: true,
            paused: false,
            hydrationFailure: null,
        })
    })
})

describe('stop', () => {
    it('abandons the request on the wire and writes nothing afterwards', async () => {
        const answer = deferred()
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => answer.promise,
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Edited' })

        await engine.stop()
        await db.clear()
        answer.resolve(ok(ticket({ title: 'Edited', version: 4 })))
        await new Promise((resolve) => setTimeout(resolve, 20))

        // The late answer did not put the last user's ticket back.
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
        await expect(engine.updateTicket('t-1', { title: 'x' })).rejects.toThrow()
    })
})

// One frame of the change feed, shaped like the server's.
function frame(type: string, row: Ticket) {
    return {
        type,
        ticket_id: row.id,
        version: row.version,
        actor_id: 'acc-other',
        at: row.updated_at,
        ticket: row,
    }
}

async function serverCopies(db: Awaited<ReturnType<typeof startEngine>>['db']) {
    let copies: Ticket[] = []
    await db.write(async (tx) => {
        copies = await tx.serverTickets.all()
    })
    return copies
}

describe('applyRemote', () => {
    it('stores a ticket created elsewhere, even in a project this store has never listed', async () => {
        stubFetch(listRoutes())
        const { engine, db } = await startEngine()
        const changes: SyncChange[] = []
        engine.subscribe((change) => changes.push(change))

        const created = ticket({ id: 't-new', project_id: 'p-elsewhere', version: 1 })
        expect(await engine.applyRemote(frame('ticket.created', created))).toBe(true)

        expect((await local(db)).tickets).toEqual([created])
        expect(await serverCopies(db)).toEqual([created])
        expect(changes).toHaveLength(1)
    })

    it('takes a newer version', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()

        const edited = ticket({ title: 'Edited elsewhere', version: 2 })
        expect(await engine.applyRemote(frame('ticket.updated', edited))).toBe(true)

        expect((await local(db)).tickets).toEqual([edited])
    })

    it('ignores the echo of our own write: same version, nothing changes, nobody is told', async () => {
        const answer = ok(ticket({ title: 'Mine', version: 2, updated_by: ME }))
        stubFetch({ ...listRoutes([ticket()]), 'PUT /api/v1/tickets/t-1': () => answer.clone() })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()
        const before = await local(db)
        const changes: SyncChange[] = []
        engine.subscribe((change) => changes.push(change))

        const echo = ticket({ title: 'Mine', version: 2, updated_by: ME })
        expect(await engine.applyRemote(frame('ticket.updated', echo))).toBe(false)

        expect(await local(db)).toEqual(before)
        expect(changes).toEqual([])
    })

    it('ignores a version older than the one it holds, however late it arrives', async () => {
        stubFetch(listRoutes([ticket({ version: 3, title: 'Third' })]))
        const { engine, db } = await startEngine()

        expect(await engine.applyRemote(frame('ticket.updated', ticket({ version: 2, title: 'Second' })))).toBe(
            false,
        )

        expect((await local(db)).tickets).toMatchObject([{ title: 'Third', version: 3 }])
    })

    it('applies frames in order of version, whatever order they arrive in', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()

        await Promise.all([
            engine.applyRemote(frame('ticket.updated', ticket({ version: 3, title: 'Third' }))),
            engine.applyRemote(frame('ticket.updated', ticket({ version: 2, title: 'Second' }))),
        ])

        expect((await local(db)).tickets).toMatchObject([{ title: 'Third', version: 3 }])
    })

    it('removes an archived ticket, and an older frame cannot bring it back', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()

        expect(await engine.applyRemote(frame('ticket.archived', ticket({ version: 3 })))).toBe(true)
        expect((await local(db)).tickets).toEqual([])
        expect(await serverCopies(db)).toEqual([])

        // Version 2 was written before the archive and merely arrived after it.
        expect(await engine.applyRemote(frame('ticket.updated', ticket({ version: 2 })))).toBe(false)
        expect((await local(db)).tickets).toEqual([])
    })

    it('brings a ticket back when it is unarchived at a higher version', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()
        await engine.applyRemote(frame('ticket.archived', ticket({ version: 3 })))

        expect(await engine.applyRemote(frame('ticket.unarchived', ticket({ version: 4 })))).toBe(true)

        expect((await local(db)).tickets).toMatchObject([{ id: 't-1', version: 4 }])
    })

    it('ends up with the ticket present at 4 whichever way round the archive and restore arrive', async () => {
        stubFetch(listRoutes([ticket({ version: 2 })]))
        const { engine, db } = await startEngine()

        await engine.applyRemote(frame('ticket.unarchived', ticket({ version: 4 })))
        await engine.applyRemote(frame('ticket.archived', ticket({ version: 3 })))

        expect((await local(db)).tickets).toMatchObject([{ id: 't-1', version: 4 }])
    })

    it('treats our own archive as buried too, so a late echo of an earlier write does not undo it', async () => {
        stubFetch({
            ...listRoutes([ticket()]),
            'DELETE /api/v1/tickets/t-1': () => new Response(null, { status: 204 }),
        })
        const { engine, db } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()
        expect((await local(db)).tickets).toEqual([])

        expect(await engine.applyRemote(frame('ticket.updated', ticket({ version: 1 })))).toBe(false)
        expect((await local(db)).tickets).toEqual([])
    })

    describe('a ticket with unsent changes', () => {
        it('keeps the row the user sees while its server copy moves on, and a discard goes to the new copy', async () => {
            stubFetch({
                ...listRoutes([ticket()]),
                'PUT /api/v1/tickets/t-1': () =>
                    problem(422, 'validation_failed', [{ location: 'body.title', message: 'no' }]),
            })
            const { engine, db } = await startEngine()
            await engine.updateTicket('t-1', { title: 'Mine' })
            await engine.idle()
            const parked = (await local(db)).outbox[0]
            expect(parked.state).toBe('failed')

            const theirs = ticket({ title: 'Theirs', description: 'new words', version: 3 })
            expect(await engine.applyRemote(frame('ticket.updated', theirs))).toBe(true)

            // What the user sees is still theirs...
            expect((await local(db)).tickets).toMatchObject([{ title: 'Mine', version: 1 }])
            // ...the server's copy is not.
            expect(await serverCopies(db)).toEqual([theirs])
            // And the entry still names the version it was made on.
            expect((await local(db)).outbox).toEqual([parked])

            await engine.discard(parked.id)
            expect((await local(db)).tickets).toEqual([theirs])
        })

        it('still sends the stale base version, so the server can refuse it', async () => {
            const sent: (string | null)[] = []
            stubFetch({
                ...listRoutes([ticket()]),
                'PUT /api/v1/tickets/t-1': (request) => {
                    sent.push(request.headers.get('If-Match'))
                    return conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 3 }), 'acc-other')
                },
            })
            const { engine, db, net } = await startEngine()
            net.goOffline()
            await engine.updateTicket('t-1', { title: 'Mine' })

            await engine.applyRemote(frame('ticket.updated', ticket({ title: 'Theirs', version: 3 })))
            expect((await local(db)).outbox).toMatchObject([{ base_version: 1 }])

            net.goOnline()
            await engine.idle()

            expect(sent).toEqual(['"1"'])
            expect((await local(db)).outbox).toMatchObject([{ state: 'conflict' }])
        })

        it('keeps the row when the ticket is archived elsewhere, and the send reports it', async () => {
            stubFetch({
                ...listRoutes([ticket()]),
                'PUT /api/v1/tickets/t-1': () => conflictBody('ticket_archived', ticket({ version: 3 }), 'acc-other'),
            })
            const { engine, db, net } = await startEngine()
            net.goOffline()
            await engine.updateTicket('t-1', { title: 'Mine' })

            await engine.applyRemote(frame('ticket.archived', ticket({ version: 3 })))
            expect((await local(db)).tickets).toMatchObject([{ title: 'Mine' }])
            expect(await serverCopies(db)).toEqual([])

            net.goOnline()
            await engine.idle()
            expect((await local(db)).outbox).toMatchObject([{ state: 'conflict', conflict: { code: 'ticket_archived' } }])
        })
    })

    it('ignores frames that are malformed or of a type it does not know, without throwing', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()
        const before = await local(db)
        const good = frame('ticket.updated', ticket({ version: 2 }))

        const junk: unknown[] = [
            null,
            undefined,
            42,
            'ticket.updated',
            [],
            {},
            { type: 'hello' },
            frame('ticket.exploded', ticket({ version: 2 })),
            { ...good, ticket: null },
            { ...good, ticket: { ...good.ticket, title: 7 } },
            { ...good, ticket: { ...good.ticket, version: '2' } },
            { ...good, ticket: { ...good.ticket, version: 0 } },
            { ...good, ticket: { ...good.ticket, status_id: undefined } },
            { ...good, ticket_id: 'someone-else' },
            { ...good, version: 9 },
        ]
        for (const item of junk) expect(await engine.applyRemote(item)).toBe(false)

        expect(await local(db)).toEqual(before)
        // And the engine is still fine afterwards.
        expect(await engine.applyRemote(good)).toBe(true)
    })

    it('waits for a list that is on the wire, then applies on top of it', async () => {
        stubFetch(listRoutes([ticket()]))
        const { engine, db } = await startEngine()
        const tickets = deferred()
        stubFetch({ ...listRoutes(), 'POST /api/v1/tickets/list': () => tickets.promise })

        const hydrating = engine.hydrate()
        await vi.waitFor(() => expect(engine.status().hydration).toBe('running'))
        const updated = engine.applyRemote(frame('ticket.updated', ticket({ title: 'Newer', version: 2 })))
        const created = engine.applyRemote(frame('ticket.created', ticket({ id: 't-2', version: 1 })))

        // The list was read before either happened, so it knows neither.
        tickets.resolve(page([ticket()]))
        expect(await hydrating).toBe(true)
        expect(await updated).toBe(true)
        expect(await created).toBe(true)

        // The new ticket is not removed as "missing from the list", and the
        // list did not put version 1 back over version 2.
        const rows = (await local(db)).tickets
        expect(rows.toSorted((a, b) => a.id.localeCompare(b.id))).toMatchObject([
            { id: 't-1', title: 'Newer', version: 2 },
            { id: 't-2', version: 1 },
        ])
    })

    it('waits for a create on the wire, so its echo does not make a second row', async () => {
        const answer = deferred()
        stubFetch({ ...listRoutes(), 'POST /api/v1/tickets': () => answer.promise })
        const { engine, db } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })

        const own = ticket({ id: 't-9', title: 'New', version: 1, updated_by: ME })
        const echo = engine.applyRemote(frame('ticket.created', own))
        // Not applied yet: it would find no ticket by that id.
        expect((await local(db)).tickets).toMatchObject([{ id: 'tmp_1' }])

        answer.resolve(ok(own))
        expect(await echo).toBe(false)
        expect((await local(db)).tickets).toMatchObject([{ id: 't-9', version: 1 }])
    })

    it('applies frames while the browser is offline, and says no once stopped', async () => {
        stubFetch(listRoutes())
        const { engine, db, net } = await startEngine()
        net.goOffline()

        expect(await engine.applyRemote(frame('ticket.created', ticket()))).toBe(true)
        expect((await local(db)).tickets).toHaveLength(1)

        await engine.stop()
        expect(await engine.applyRemote(frame('ticket.updated', ticket({ version: 2 })))).toBe(false)
    })
})

// LAM-70: what each kind of answer does to an entry, now that the classifier
// decides it.
describe('failures, by kind', () => {
    it.each([
        [403, 'forbidden'],
        [404, 'ticket_not_found'],
        [422, 'validation_failed'],
        [405, 'method_not_allowed'],
    ])('parks a %i as failed and does not retry it', async (status, code) => {
        let sends = 0
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                sends += 1
                return problem(status, code)
            },
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'A' })
        await engine.idle()

        expect((await local(db)).outbox).toMatchObject([
            { state: 'failed', attempts: 0, error: { status, code } },
        ])
        expect(clock.nextDelay()).toBeNull()
        expect(sends).toBe(1)
    })

    it('treats 429 like a 5xx: the entry stays pending and is retried', async () => {
        let attempts = 0
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                attempts += 1
                return attempts === 1 ? problem(429, 'too_many_requests') : ok(ticket({ title: 'A', version: 2 }))
            },
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateTicket('t-1', { title: 'A' })
        await engine.idle()
        expect((await local(db)).outbox).toMatchObject([{ state: 'pending', attempts: 1 }])

        clock.advance(1_000)
        await engine.idle()
        expect((await local(db)).outbox).toEqual([])
    })

    it('retryNow() tries a waiting entry at once instead of when the backoff ends', async () => {
        let attempts = 0
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                attempts += 1
                return attempts === 1 ? problem(503, 'unavailable') : ok(ticket({ title: 'A', version: 2 }))
            },
        })
        const { engine, db, clock } = await startEngine()
        await engine.updateTicket('t-1', { title: 'A' })
        await engine.idle()
        expect(attempts).toBe(1)
        expect(clock.nextDelay()).toBe(1_000)

        engine.retryNow()
        await engine.idle()

        expect(attempts).toBe(2)
        expect((await local(db)).outbox).toEqual([])
    })

    it('retryNow() does nothing while paused for a 401', async () => {
        let sends = 0
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                sends += 1
                return problem(401, 'unauthorized')
            },
        })
        const { engine } = await startEngine()
        await engine.updateTicket('t-1', { title: 'A' })
        await engine.idle()

        engine.retryNow()
        await engine.idle()

        expect(sends).toBe(1)
    })

    it('reports why a list failed, and forgets it once a list lands', async () => {
        let down = true
        stubFetch({
            ...listRoutes([ticket()]),
            'POST /api/v1/teams/list': () => (down ? problem(502, 'bad_gateway') : listRoutes()['POST /api/v1/teams/list']()),
        })
        const { engine, clock } = await startEngine()
        expect(engine.status()).toMatchObject({ hydration: 'failed', hydrationFailure: 'server', paused: false })

        down = false
        clock.advance(1_000)
        await engine.idle()
        expect(engine.status()).toMatchObject({ hydration: 'done', hydrationFailure: null })
    })

    it('sends what an earlier run parked for a 401, once a new engine starts', async () => {
        let signedIn = false
        const sent: string[] = []
        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                sent.push((await bodyOf(request)).title)
                return signedIn ? ok(ticket({ title: 'A', version: 2 })) : problem(401, 'unauthorized')
            },
        })
        const first = await startEngine()
        await first.engine.updateTicket('t-1', { title: 'A' })
        await first.engine.idle()
        expect((await local(first.db)).outbox).toMatchObject([{ state: 'unauthorized' }])
        await first.engine.stop()

        // The page was reloaded and the user signed in again: a new engine,
        // the same database.
        signedIn = true
        const second = await startEngine({ db: first.db })
        await second.engine.idle()

        expect(sent).toEqual(['A', 'A'])
        expect((await local(second.db)).outbox).toEqual([])
    })
})

// LAM-71: deciding what happens to a change that lost to someone else's.
describe('resolving a conflict', () => {
    const theirs = () => ticket({ title: 'Theirs', description: 'Their words', version: 5, updated_by: 'acc-other' })

    // t-1 is edited by the user and refused with `code`.
    function edited(code: 'ticket_conflict' | 'ticket_archived' = 'ticket_conflict') {
        const puts: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                puts.push(request.headers.get('If-Match'))
                return conflictBody(code, theirs(), 'acc-other')
            },
            'POST /api/v1/tickets': async (request) => {
                const body = await bodyOf(request)
                return ok(ticket({ ...body, id: 't-new', version: 1, updated_by: ME }))
            },
        })
        return puts
    }

    async function park(code: 'ticket_conflict' | 'ticket_archived' = 'ticket_conflict') {
        const puts = edited(code)
        const started = await startEngine()
        await started.engine.updateTicket('t-1', { title: 'Mine', description: 'My words' })
        await started.engine.idle()
        const [entry] = (await local(started.db)).outbox
        return { ...started, puts, entry }
    }

    describe.each(['ticket_conflict', 'ticket_archived'] as const)('keepAsNew on %s', (code) => {
        it('makes a queued create from the user\'s version in the same project, then resolves the original', async () => {
            const { engine, db, entry } = await park(code)
            expect(entry.state).toBe('conflict')

            const id = await engine.keepAsNew(entry.id)

            expect(id).toBe('tmp_1')
            const now = await local(db)
            // The copy: the title exactly as it was typed, no "(copy)".
            expect(now.tickets.find((t) => t.id === id)).toMatchObject({
                id: 'tmp_1',
                project_id: 'p-1',
                title: 'Mine',
                description: 'My words',
                status_id: 's-todo',
                version: 0,
            })
            expect(now.outbox).toMatchObject([
                { kind: 'create', entity_id: 'tmp_1', state: 'pending', payload: { title: 'Mine', project_id: 'p-1' } },
            ])
            // The original is resolved as discard would: back to theirs, or gone.
            if (code === 'ticket_conflict') {
                expect(now.tickets.find((t) => t.id === 't-1')).toEqual(theirs())
            } else {
                expect(now.tickets.find((t) => t.id === 't-1')).toBeUndefined()
            }
        })

        it('sends the create and the copy takes its server id', async () => {
            const { engine, db, entry } = await park(code)
            await engine.keepAsNew(entry.id)
            await engine.idle()

            const now = await local(db)
            expect(now.outbox).toEqual([])
            expect(now.tickets.map((t) => t.id).sort()).toEqual(
                code === 'ticket_conflict' ? ['t-1', 't-new'] : ['t-new'],
            )
        })
    })

    it('keeps the edits queued behind the conflict in the copy, and drops them from the original', async () => {
        const first = deferred()
        const started = deferred<void>()
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                started.resolve()
                return first.promise
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await started.promise
        // The first edit is on the wire, so this one queues behind it.
        await engine.updateTicket('t-1', { description: 'Written later', assignee_id: ME })
        first.resolve(conflictBody('ticket_conflict', theirs(), 'acc-other'))
        await engine.idle()

        const before = await local(db)
        expect(before.outbox).toMatchObject([{ state: 'conflict' }, { state: 'pending' }])

        const id = await engine.keepAsNew(before.outbox[0].id)

        const now = await local(db)
        expect(now.tickets.find((t) => t.id === id)).toMatchObject({
            title: 'Mine',
            description: 'Written later',
            assignee_id: ME,
        })
        expect(now.outbox).toMatchObject([{ kind: 'create', entity_id: id }])
        expect(now.tickets.find((t) => t.id === 't-1')).toEqual(theirs())
    })

    it('does nothing for an archive, a refused edit, or an entry that is not there', async () => {
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'DELETE /api/v1/tickets/t-1': () => conflictBody('ticket_conflict', theirs(), 'acc-other'),
        })
        const { engine, db } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()
        const [archive] = (await local(db)).outbox
        const snapshot = await local(db)

        expect(archive).toMatchObject({ kind: 'archive', state: 'conflict' })
        expect(await engine.keepAsNew(archive.id)).toBeNull()
        expect(await engine.keepAsNew(999)).toBeNull()
        expect(await local(db)).toEqual(snapshot)
    })

    it('discard() and retry() on an archived conflict: the first removes the row, the second asks again', async () => {
        const { engine, db, entry, puts } = await park('ticket_archived')

        expect(await engine.retry(entry.id)).toBe(true)
        await engine.idle()
        // Resent on the version the conflict showed, and it collided again.
        expect(puts).toEqual(['"3"', '"5"'])
        expect((await local(db)).outbox).toMatchObject([{ state: 'conflict' }])

        await engine.discard((await local(db)).outbox[0].id)
        expect(await local(db)).toEqual({ tickets: [], outbox: [] })
    })

    it('a "use mine" that collides again parks with the newer conflict', async () => {
        const answers = [
            conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 5 }), 'acc-other'),
            conflictBody('ticket_conflict', ticket({ title: 'Theirs again', version: 6 }), 'acc-third'),
        ]
        const ifMatch: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'PUT /api/v1/tickets/t-1': (request) => {
                ifMatch.push(request.headers.get('If-Match'))
                return answers.shift()!
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await engine.idle()
        await engine.retry((await local(db)).outbox[0].id)
        await engine.idle()

        expect(ifMatch).toEqual(['"3"', '"5"'])
        expect((await local(db)).outbox).toMatchObject([
            {
                state: 'conflict',
                payload: { title: 'Mine' },
                conflict: { current: { title: 'Theirs again', version: 6 }, changed_by: { account_id: 'acc-third' } },
            },
        ])
    })

    it('a conflicted entry is still there, still parked and not resent, when the engine starts again', async () => {
        const { engine, db, entry, puts } = await park()
        await engine.stop()

        const again = await startEngine({ db })
        await again.engine.idle()

        const now = await local(db)
        expect(now.outbox).toMatchObject([{ id: entry.id, state: 'conflict', conflict: { code: 'ticket_conflict' } }])
        expect(now.tickets.find((t) => t.id === 't-1')).toMatchObject({ title: 'Mine' })
        expect(puts).toHaveLength(1)
    })
})

// The gap LAM-70 flagged: an archive that did not go through used to take the
// row with it, and with the row the page that says so.
describe('an archive that is parked', () => {
    it('keeps the ticket reachable when the server refuses it, and puts it back on discard', async () => {
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'DELETE /api/v1/tickets/t-1': () => problem(403, 'forbidden'),
        })
        const { engine, db } = await startEngine()

        await engine.archiveTicket('t-1')
        // Pending: hidden, as it always was.
        expect((await local(db)).tickets).toEqual([])
        await engine.idle()

        const now = await local(db)
        expect(now.outbox).toMatchObject([{ kind: 'archive', state: 'failed' }])
        expect(now.tickets).toMatchObject([{ id: 't-1', title: 'Write the outbox' }])

        await engine.discard(now.outbox[0].id)
        expect(await local(db)).toMatchObject({ tickets: [{ id: 't-1' }], outbox: [] })
    })

    it('shows the server\'s newer copy when the archive collided, and hides it again while it is resent', async () => {
        const answers = [
            () => conflictBody('ticket_conflict', ticket({ title: 'Edited meanwhile', version: 5 }), 'acc-other'),
            () => new Response(null, { status: 204, headers: { ETag: '"6"' } }),
        ]
        const ifMatch: (string | null)[] = []
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'DELETE /api/v1/tickets/t-1': (request) => {
                ifMatch.push(request.headers.get('If-Match'))
                return answers.shift()!()
            },
        })
        const { engine, db } = await startEngine()
        await engine.archiveTicket('t-1')
        await engine.idle()

        let now = await local(db)
        expect(now.outbox).toMatchObject([{ kind: 'archive', state: 'conflict' }])
        expect(now.tickets).toMatchObject([{ title: 'Edited meanwhile', version: 5 }])

        // Nothing more can be queued on a ticket whose archive is waiting.
        expect(await engine.updateTicket('t-1', { title: 'Too late' })).toBe(false)
        expect(await engine.archiveTicket('t-1')).toBe(false)
        expect((await local(db)).outbox).toHaveLength(1)

        await engine.retry(now.outbox[0].id)
        expect((await local(db)).tickets).toEqual([])
        await engine.idle()

        expect(ifMatch).toEqual(['"3"', '"5"'])
        now = await local(db)
        expect(now).toEqual({ tickets: [], outbox: [] })
    })

    it('keeps the ticket reachable when an edit before the archive is the one waiting', async () => {
        const first = deferred()
        const started = deferred<void>()
        stubFetch({
            ...listRoutes([ticket({ id: 't-1', version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                started.resolve()
                return first.promise
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Mine' })
        await started.promise
        await engine.archiveTicket('t-1')
        first.resolve(conflictBody('ticket_conflict', ticket({ title: 'Theirs', version: 5 }), 'acc-other'))
        await engine.idle()

        const now = await local(db)
        expect(now.outbox).toMatchObject([{ kind: 'update', state: 'conflict' }, { kind: 'archive' }])
        expect(now.tickets).toMatchObject([{ id: 't-1', title: 'Mine' }])
    })
})

describe('an idempotent create (LAM-76)', () => {
    // Every create carries a key made when it was queued. The server answers a
    // second request with the same key from the same account with the ticket the
    // first made - so a response that never arrived cannot make a second ticket.
    function creating(answers: ((request: Request) => Response | Promise<Response>)[]) {
        const keys: (string | null)[] = []
        let call = 0
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': (request) => {
                keys.push(request.headers.get('Idempotency-Key'))
                const answer = answers[Math.min(call, answers.length - 1)]
                call += 1
                return answer(request)
            },
            'PUT /api/v1/tickets/t-9': async (request) =>
                ok(ticket({ id: 't-9', ...(await bodyOf(request)), version: 6 })),
        })
        return keys
    }

    const lost = () => {
        throw new TypeError('Failed to fetch')
    }

    it('sends the key it stored on the entry, a UUID, as the Idempotency-Key header', async () => {
        const keys = creating([() => ok(ticket({ id: 't-9', version: 1 }))])
        const { engine, db } = await startEngine({ newKey: () => 'key-1' })
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()

        expect(keys).toEqual(['key-1'])
        expect((await local(db)).outbox).toEqual([])
    })

    it('makes a UUID by default, and a different one for every create', async () => {
        const keys = creating([() => ok(ticket({ id: 't-9', version: 1 }))])
        const { engine } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()

        expect(keys).toHaveLength(2)
        for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(keys[0]).not.toBe(keys[1])
    })

    it('sends the same key on the attempt after one that got no response', async () => {
        const keys = creating([lost, lost, () => ok(ticket({ id: 't-9', version: 1 }))])
        const { engine, db, clock } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()
        expect((await local(db)).outbox).toMatchObject([{ attempts: 1, idempotency_key: keys[0] }])

        clock.advance(1_000)
        await engine.idle()
        clock.advance(2_000)
        await engine.idle()

        expect(keys).toHaveLength(3)
        expect(new Set(keys).size).toBe(1)
        expect(keys[0]).toBeTruthy()
        expect((await local(db)).outbox).toEqual([])
    })

    it('sends the same key after a 5xx too', async () => {
        const keys = creating([() => problem(503, 'unavailable'), () => ok(ticket({ id: 't-9', version: 1 }))])
        const { engine, clock } = await startEngine()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()
        clock.advance(1_000)
        await engine.idle()

        expect(keys).toHaveLength(2)
        expect(keys[0]).toBe(keys[1])
    })

    it('keeps the key when an edit is folded into a create that has not been sent', async () => {
        const keys = creating([() => ok(ticket({ id: 't-9', version: 1 }))])
        const { engine, db, net } = await startEngine({ newKey: () => 'key-1' })
        net.goOffline()
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.updateTicket('tmp_1', { title: 'Edited before sending' })

        expect((await local(db)).outbox).toMatchObject([
            { kind: 'create', idempotency_key: 'key-1', payload: { title: 'Edited before sending' } },
        ])
        net.goOnline()
        await engine.idle()

        expect(keys).toEqual(['key-1'])
    })

    it('keeps the key when a refused create is corrected and sent again', async () => {
        const keys = creating([
            () => problem(422, 'unprocessable_entity', [{ location: 'body.title', message: 'expected length <= 200' }]),
            () => ok(ticket({ id: 't-9', version: 1 })),
        ])
        const { engine } = await startEngine({ newKey: () => 'key-1' })
        await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await engine.idle()
        await engine.updateTicket('tmp_1', { title: 'Shorter' })
        await engine.idle()

        expect(keys).toEqual(['key-1', 'key-1'])
    })

    it('keeps the key across a restart of the engine on the same database', async () => {
        const keys = creating([lost, () => ok(ticket({ id: 't-9', version: 1 }))])
        const first = await startEngine()
        await first.engine.createTicket({ ...FIELDS, project_id: 'p-1' })
        await first.engine.idle()
        await first.engine.stop()

        const second = await startEngine({ db: first.db })
        await second.engine.idle()
        second.clock.advance(1_000)
        await second.engine.idle()

        expect(keys).toHaveLength(2)
        expect(keys[0]).toBe(keys[1])
    })

    describe('a replay', () => {
        it('reconciles like a fresh create, from the response, even when it carries other people\'s edits', async () => {
            // Attempt 1 landed (version 1) and its response was lost. Somebody
            // then edited the ticket to version 4. The retry answers with that.
            creating([lost, () => ok(ticket({ id: 't-9', title: 'Edited by Grace', version: 4, updated_by: 'acc-other' }))])
            const { engine, db, clock } = await startEngine()
            const changes: SyncChange[] = []
            engine.subscribe((change) => changes.push(change))

            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            clock.advance(1_000)
            await engine.idle()

            const now = await local(db)
            expect(now.tickets).toMatchObject([{ id: 't-9', title: 'Edited by Grace', version: 4 }])
            expect(now.outbox).toEqual([])
            expect(changes).toContainEqual({ swap: { from: 'tmp_1', to: 't-9' } })
        })

        it('lets an edit queued behind the create go out on the version the replay returned', async () => {
            const puts: { ifMatch: string | null; title: string }[] = []
            stubFetch({
                ...listRoutes(),
                'POST /api/v1/tickets': (() => {
                    let calls = 0
                    return () => {
                        calls += 1
                        if (calls === 1) throw new TypeError('Failed to fetch')
                        return ok(ticket({ id: 't-9', title: 'Theirs', version: 4, updated_by: 'acc-other' }))
                    }
                })(),
                'PUT /api/v1/tickets/t-9': async (request) => {
                    const body = await bodyOf(request)
                    puts.push({ ifMatch: request.headers.get('If-Match'), title: body.title })
                    return ok(ticket({ id: 't-9', ...body, version: 5 }))
                },
            })
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            // Not folded: the first attempt may have landed.
            await engine.updateTicket('tmp_1', { title: 'Mine' })
            expect((await local(db)).outbox).toHaveLength(2)

            clock.advance(1_000)
            await engine.idle()

            expect(puts).toEqual([{ ifMatch: '"4"', title: 'Mine' }])
            expect(await local(db)).toMatchObject({ tickets: [{ id: 't-9', title: 'Mine', version: 5 }], outbox: [] })
        })
    })

    describe('a replay answered ticket_archived', () => {
        // The create landed; then someone archived the ticket; then the retry came.
        const archivedTicket = () => ticket({ id: 't-9', title: 'New', version: 3, updated_by: 'acc-other' })
        const archived = () => conflictBody('ticket_archived', archivedTicket(), 'acc-other')

        it('is "created, then archived": the entry and the row go, and nothing is parked', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            clock.advance(1_000)
            await engine.idle()

            expect(await local(db)).toEqual({ tickets: [], outbox: [] })
            expect(await db.write((tx) => tx.serverTickets.all())).toEqual([])
            // Nothing for anyone to puzzle over, and nothing retried.
            expect(clock.nextDelay()).toBeNull()
        })

        it('does not let a late frame for the ticket bring it back', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            clock.advance(1_000)
            await engine.idle()

            const late = await engine.applyRemote({
                type: 'ticket.updated',
                ticket_id: 't-9',
                version: 2,
                ticket: ticket({ id: 't-9', version: 2 }),
            })

            expect(late).toBe(false)
            expect((await local(db)).tickets).toEqual([])
        })

        it('drops a row the feed had already shown under the real id', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            // The first attempt's own broadcast, before the retry.
            await engine.applyRemote({
                type: 'ticket.created',
                ticket_id: 't-9',
                version: 1,
                ticket: ticket({ id: 't-9', title: 'New', version: 1 }),
            })
            expect((await local(db)).tickets.map((t) => t.id).sort()).toEqual(['t-9', 'tmp_1'])

            clock.advance(1_000)
            await engine.idle()

            expect(await local(db)).toEqual({ tickets: [], outbox: [] })
        })

        it('is the same when the user had archived it too', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            await engine.archiveTicket('tmp_1')
            expect((await local(db)).outbox).toHaveLength(2)
            clock.advance(1_000)
            await engine.idle()

            expect(await local(db)).toEqual({ tickets: [], outbox: [] })
        })

        it('parks edits queued behind it as the ticket_archived conflict on the real ticket', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            const changes: SyncChange[] = []
            engine.subscribe((change) => changes.push(change))
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            await engine.updateTicket('tmp_1', { title: 'Mine' })
            clock.advance(1_000)
            await engine.idle()

            const now = await local(db)
            expect(now.outbox).toMatchObject([
                {
                    kind: 'update',
                    entity_id: 't-9',
                    state: 'conflict',
                    base_version: 3,
                    conflict: { code: 'ticket_archived', current: { id: 't-9', version: 3 } },
                },
            ])
            // Still on screen under its real id, with the user's words, so the
            // panel can be shown on it.
            expect(now.tickets).toMatchObject([{ id: 't-9', title: 'Mine' }])
            expect(changes).toContainEqual({ swap: { from: 'tmp_1', to: 't-9' } })
        })

        it('offers "keep mine as a new ticket", and that ticket gets a new key', async () => {
            const keys = creating([lost, archived, () => ok(ticket({ id: 't-new', title: 'Mine', version: 1 }))])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            await engine.updateTicket('tmp_1', { title: 'Mine' })
            clock.advance(1_000)
            await engine.idle()
            const [parked] = (await local(db)).outbox

            const copy = await engine.keepAsNew(parked.id)
            await engine.idle()

            expect(copy).toBe('tmp_2')
            expect(keys).toHaveLength(3)
            expect(keys[2]).not.toBe(keys[0])
            expect(await local(db)).toMatchObject({ tickets: [{ id: 't-new', title: 'Mine' }], outbox: [] })
        })

        it('discarding it leaves nothing behind', async () => {
            creating([lost, archived])
            const { engine, db, clock } = await startEngine()
            await engine.createTicket({ ...FIELDS, project_id: 'p-1' })
            await engine.idle()
            await engine.updateTicket('tmp_1', { title: 'Mine' })
            clock.advance(1_000)
            await engine.idle()

            await engine.discard((await local(db)).outbox[0].id)

            expect(await local(db)).toEqual({ tickets: [], outbox: [] })
        })
    })
})

describe('while the browser says it is offline (LAM-76)', () => {
    it('sends nothing, and sends at once on online without waiting for a timer', async () => {
        const puts: string[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                puts.push((await bodyOf(request)).title)
                return ok(ticket({ title: 'Edited', version: 4 }))
            },
        })
        const { engine, db, net, clock } = await startEngine()
        net.goOffline()

        await engine.updateTicket('t-1', { title: 'Edited' })
        await engine.idle()
        expect(puts).toEqual([])
        expect(clock.nextDelay()).toBeNull()

        net.goOnline()
        await engine.idle()
        expect(puts).toEqual(['Edited'])
        expect((await local(db)).outbox).toEqual([])
    })

    it('does not grow a backoff from a request that failed because the network went', async () => {
        const answer = deferred()
        const reached = deferred<void>()
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => {
                reached.resolve()
                return answer.promise
            },
        })
        const { engine, db, net, clock } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Edited' })
        // On the wire when the browser reports the network gone.
        await reached.promise
        net.goOffline()
        answer.reject(new TypeError('Failed to fetch'))
        await engine.idle()

        // The entry stays (it may have landed), and no timer is counting down.
        expect((await local(db)).outbox).toMatchObject([{ state: 'pending', attempts: 1 }])
        expect(clock.nextDelay()).toBeNull()
    })
})

// LAM-107: a drop on the board is one write that sets the status and the
// position, sent as a move.
describe('move', () => {
    it('shows the card in its new place at once and sends ONE move, on the version it was made on', async () => {
        const answer = deferred()
        const sent: { ifMatch: string | null; body: unknown }[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3, position: 1024 }), ticket({ id: 't-2', position: 2048 })]),
            'POST /api/v1/tickets/t-1/move': async (request) => {
                sent.push({ ifMatch: request.headers.get('If-Match'), body: await bodyOf(request) })
                return answer.promise
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateTicket('t-1', { status_id: 's-doing', position: 3072 })
        expect((await local(db)).tickets.find((t) => t.id === 't-1')).toMatchObject({ status_id: 's-doing', position: 3072 })

        answer.resolve(ok(ticket({ version: 4, status_id: 's-doing', position: 3072, updated_by: ME })))
        await engine.idle()

        expect(sent).toEqual([{ ifMatch: '"3"', body: { status_id: 's-doing', position: 3072 } }])
        expect((await local(db)).outbox).toEqual([])
        expect((await local(db)).tickets.find((t) => t.id === 't-1')).toMatchObject({ version: 4, position: 3072 })
    })

    it('folds several drops of one card before it is sent into one move', async () => {
        const moves: unknown[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'POST /api/v1/tickets/t-1/move': async (request) => {
                moves.push(await bodyOf(request))
                return ok(ticket({ version: 4, status_id: 's-done', position: 5000 }))
            },
        })
        const { engine, net } = await startEngine()
        net.goOffline()

        await engine.updateTicket('t-1', { status_id: 's-doing', position: 3072 })
        await engine.updateTicket('t-1', { status_id: 's-done', position: 5000 })
        net.goOnline()
        await engine.idle()

        expect(moves).toEqual([{ status_id: 's-done', position: 5000 }])
    })

    it('sends an edit made together with the move as a PUT on the version the move returned, without a position', async () => {
        const calls: string[] = []
        let put: unknown
        stubFetch({
            ...listRoutes([ticket({ version: 3 })]),
            'POST /api/v1/tickets/t-1/move': () => {
                calls.push('move')
                return ok(ticket({ version: 4, status_id: 's-doing', position: 3072 }))
            },
            'PUT /api/v1/tickets/t-1': async (request) => {
                calls.push(`put ${request.headers.get('If-Match')}`)
                put = await bodyOf(request)
                return ok(ticket({ version: 5, title: 'Renamed', status_id: 's-doing', position: 3072 }))
            },
        })
        const { engine, net } = await startEngine()
        net.goOffline()
        await engine.updateTicket('t-1', { status_id: 's-doing', position: 3072 })
        await engine.updateTicket('t-1', { title: 'Renamed' })
        net.goOnline()
        await engine.idle()

        expect(calls).toEqual(['move', 'put "4"'])
        expect(put).toEqual({ title: 'Renamed', description: '', status_id: 's-doing', assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] })
    })

    it('leaves position out of an ordinary edit, which stays a PUT', async () => {
        let put: unknown
        stubFetch({
            ...listRoutes([ticket({ version: 3, position: 1024 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                put = await bodyOf(request)
                return ok(ticket({ version: 4, title: 'Edited' }))
            },
        })
        const { engine } = await startEngine()
        await engine.updateTicket('t-1', { title: 'Edited' })
        await engine.idle()
        expect(put).toEqual({ title: 'Edited', description: '', status_id: 's-todo', assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] })
    })

    it('takes the renumbered neighbours and the mover from the feed in whatever order, by version', async () => {
        stubFetch(listRoutes([ticket({ version: 1, position: 1024 }), ticket({ id: 't-2', position: 1025, version: 1 })]))
        const { engine, db } = await startEngine()
        await engine.idle()
        const frame = (row: Ticket) => ({ type: 'ticket.updated', ticket_id: row.id, version: row.version, actor_id: 'acc-other', at: row.updated_at, ticket: row })

        // docs/realtime.md: the renumbered ticket's event comes before the mover's.
        await engine.applyRemote(frame(ticket({ id: 't-2', position: 2048, version: 2 })))
        await engine.applyRemote(frame(ticket({ id: 't-1', position: 1536, version: 2, status_id: 's-doing' })))
        // And a late echo of the older version changes nothing.
        await engine.applyRemote(frame(ticket({ id: 't-2', position: 1025, version: 1 })))

        expect((await local(db)).tickets.map((t) => [t.id, t.position, t.version])).toEqual([
            ['t-1', 1536, 2],
            ['t-2', 2048, 2],
        ])
    })
})
