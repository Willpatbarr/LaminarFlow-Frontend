import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import type { SyncChange } from './engine'
import { deferred, listRoutes, ME, page, startEngine, ticket } from './testing/harness'
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
        expect((await local(db)).outbox).toMatchObject([{ kind: 'create', ticket_id: 'tmp_1' }])

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
            { project_id: 'p-1', title: 'New', description: '', status_id: null, assignee_id: null },
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
                body: { title: 'Renamed', description: '', status_id: 's-todo', assignee_id: null },
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
            { title: 'Two', description: 'More', status_id: 's-todo', assignee_id: null },
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
            { ticket_id: 't-1', state: 'pending', attempts: 1, error: { status: 503 } },
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
            { ticket_id: 't-1', state: 'unauthorized' },
            { ticket_id: 't-2', state: 'pending' },
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
                ticket_id: 't-1',
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
        expect(engine.status()).toEqual({ hydration: 'failed', hydrated: false, paused: true })
        expect(clock.nextDelay()).toBeNull()

        stubFetch(listRoutes([ticket()]))
        await engine.resume()
        await engine.idle()

        expect(engine.status()).toEqual({ hydration: 'done', hydrated: true, paused: false })
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
