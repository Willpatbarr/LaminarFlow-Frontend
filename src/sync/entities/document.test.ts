import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { deferred, doc, docBody, listRoutes, page, startEngine, ticket } from '../testing/harness'
import { isTempId, type Doc } from '../types'

// Documents are the second entity (LAM-125). These tests are the proof that the
// engine is not ticket-shaped: every behaviour a ticket has under test in
// engine.test.ts is asserted here for a document, against the same engine, and
// the places the two differ (one conflict code, no author on
// a conflict) are pinned down.

afterEach(() => {
    vi.unstubAllGlobals()
})

const FIELDS = { title: 'Notes', type: 'normal' as const, aspect_type_id: null, body: { content: 'Hello' } }
const NEW = { ...FIELDS, team_id: null, project_id: 'p-1' }

const noContent = (version: number) => new Response(null, { status: 204, headers: { ETag: `"${version}"` } })

function conflict(current: Doc, archivedAt: string | null = null) {
    return new Response(
        JSON.stringify({
            title: 'Conflict',
            status: 409,
            code: 'document_conflict',
            current: docBody({ ...current, archived_at: archivedAt }),
            changed_at: '2026-01-01T00:00:05Z',
        }),
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    )
}

async function snapshot(db: Awaited<ReturnType<typeof startEngine>>['db']) {
    const { documents, tickets, outbox } = await db.snapshot()
    return { documents, tickets, outbox }
}

describe('create', () => {
    it('shows the document before the request resolves, then takes the server id and version', async () => {
        const answer = deferred()
        let sent: Request | undefined
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/documents': (request) => {
                sent = request
                return answer.promise
            },
        })
        const { engine, db } = await startEngine()
        const swaps: unknown[] = []
        engine.subscribe((change) => change.swap && swaps.push(change.swap))

        const created = await engine.createDocument(NEW)

        expect(created).toMatchObject({ id: 'tmp_1', title: 'Notes', version: 0, body: { content: 'Hello' } })
        expect(isTempId(created.id)).toBe(true)
        expect((await snapshot(db)).documents).toEqual([created])
        expect((await snapshot(db)).outbox).toMatchObject([{ entity: 'document', kind: 'create', entity_id: 'tmp_1' }])

        answer.resolve(ok(docBody({ id: 'd-9', title: 'Notes', version: 1 })))
        await engine.idle()

        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-9', version: 1 }])
        expect((await snapshot(db)).outbox).toEqual([])
        expect(swaps).toEqual([{ from: 'tmp_1', to: 'd-9' }])
        // What the server was sent: the create, as the endpoint takes it.
        expect(await bodyOf(sent!)).toEqual(NEW)
    })

    it('uses the entity\'s own temporary id prefix when none is injected', async () => {
        stubFetch({ ...listRoutes(), 'POST /api/v1/documents': () => new Promise<Response>(() => {}) })
        const { engine } = await startEngine({ newId: undefined })
        const created = await engine.createDocument(NEW)
        expect(created.id).toMatch(/^tmp_doc_/)
        expect(isTempId(created.id)).toBe(true)
    })

    it('sends the Idempotency-Key the entry carries (LAM-126)', async () => {
        let header: string | null = null
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/documents': (request) => {
                header = request.headers.get('Idempotency-Key')
                return ok(docBody({ id: 'd-9', version: 1 }))
            },
        })
        const { engine, db } = await startEngine()

        await engine.createDocument(NEW)
        const entry = (await snapshot(db)).outbox[0]
        if (entry.kind !== 'create') throw new Error('expected a create')
        const key = entry.idempotency_key
        expect(key).toEqual(expect.any(String))
        await engine.idle()

        expect(header).toBe(key)
    })

    it('survives going offline: nothing is lost, and it is sent when the network is back', async () => {
        const sent: unknown[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/documents': async (request) => {
                sent.push(await bodyOf(request))
                return ok(docBody({ id: 'd-9', version: 1 }))
            },
        })
        const { engine, db, net } = await startEngine()
        net.goOffline()

        await engine.createDocument(NEW)
        await engine.updateDocument('tmp_1', { body: { content: 'Edited offline' } })
        await engine.idle()

        // Offline: still local, still one create (the edit folded into it).
        expect(sent).toEqual([])
        expect((await snapshot(db)).outbox).toMatchObject([
            { kind: 'create', payload: { body: { content: 'Edited offline' } } },
        ])
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'tmp_1', body: { content: 'Edited offline' } }])

        net.goOnline()
        await engine.idle()

        expect(sent).toEqual([{ ...NEW, body: { content: 'Edited offline' } }])
        expect(await snapshot(db)).toMatchObject({ documents: [{ id: 'd-9', version: 1 }], outbox: [] })
    })
})

describe('update', () => {
    it('sends all four fields with the version it was made on', async () => {
        const seen: { ifMatch: string | null; body: unknown }[] = []
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'PUT /api/v1/documents/d-1': async (request) => {
                seen.push({ ifMatch: request.headers.get('If-Match'), body: await bodyOf(request) })
                return ok(docBody({ version: 3, title: 'Renamed' }))
            },
        })
        const { engine, db } = await startEngine()

        expect(await engine.updateDocument('d-1', { title: 'Renamed' })).toBe(true)
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-1', title: 'Renamed' }])
        await engine.idle()

        expect(seen).toEqual([
            {
                ifMatch: '"2"',
                body: { title: 'Renamed', type: 'normal', aspect_type_id: null, body: { content: 'Hello' } },
            },
        ])
        expect(await snapshot(db)).toMatchObject({ documents: [{ title: 'Renamed', version: 3 }], outbox: [] })
    })

    it('queues nothing for a patch that changes nothing, comparing bodies by value', async () => {
        stubFetch(listRoutes([], [doc()]))
        const { engine, db } = await startEngine()

        expect(await engine.updateDocument('d-1', { body: { content: 'Hello' }, title: 'Design notes' })).toBe(true)

        expect((await snapshot(db)).outbox).toEqual([])
    })

    it('is false for a document it does not have', async () => {
        stubFetch(listRoutes())
        const { engine } = await startEngine()
        expect(await engine.updateDocument('nope', { title: 'x' })).toBe(false)
    })

    it('turns a normal document into an aspect one with a type and the same body', async () => {
        const seen: unknown[] = []
        stubFetch({
            ...listRoutes([], [doc()]),
            'PUT /api/v1/documents/d-1': async (request) => {
                seen.push(await bodyOf(request))
                return ok(docBody({ version: 2, type: 'aspect', aspect_type_id: 'at-1', body: { f1: 'Hello' } }))
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { type: 'aspect', aspect_type_id: 'at-1' })
        await engine.idle()

        expect(seen).toEqual([
            { title: 'Design notes', type: 'aspect', aspect_type_id: 'at-1', body: { content: 'Hello' } },
        ])
        // The server's copy (the text moved into the type's first field) replaces ours.
        expect((await snapshot(db)).documents).toMatchObject([{ type: 'aspect', body: { f1: 'Hello' } }])
    })
})

describe('archive and unarchive', () => {
    it('hides the document at once, DELETEs with the version, and forgets it', async () => {
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'DELETE /api/v1/documents/d-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return noContent(3)
            },
        })
        const { engine, db } = await startEngine()

        expect(await engine.archiveDocument('d-1')).toBe(true)
        expect((await snapshot(db)).documents).toEqual([])
        await engine.idle()

        expect(seen).toEqual(['"2"'])
        expect(await snapshot(db)).toMatchObject({ documents: [], outbox: [] })
    })

    it('withdraws a create that was never sent', async () => {
        stubFetch(listRoutes())
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.createDocument(NEW)

        await engine.archiveDocument('tmp_1')

        expect(await snapshot(db)).toMatchObject({ documents: [], outbox: [] })
    })

    it('brings it back with POST /unarchive at the archived version', async () => {
        const seen: (string | null)[] = []
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'DELETE /api/v1/documents/d-1': () => noContent(3),
            'POST /api/v1/documents/d-1/unarchive': (request) => {
                seen.push(request.headers.get('If-Match'))
                return noContent(4)
            },
        })
        const { engine, db } = await startEngine()
        await engine.archiveDocument('d-1')
        await engine.idle()

        expect(await engine.unarchiveDocument(doc({ version: 2 }))).toBe('d-1')
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-1' }])
        await engine.idle()

        expect(seen).toEqual(['"3"'])
        expect(await snapshot(db)).toMatchObject({ documents: [{ id: 'd-1', version: 4 }], outbox: [] })
    })
})

describe('409', () => {
    it('parks an edit that lost, keeps the server copy for a discard, and keeps the user\'s words on screen', async () => {
        const theirs = doc({ title: 'Theirs', version: 3 })
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'PUT /api/v1/documents/d-1': () => conflict(theirs),
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()

        const now = await db.snapshot()
        expect(now.outbox).toMatchObject([
            { entity: 'document', state: 'conflict', conflict: { code: 'document_conflict', archived: false, current: { title: 'Theirs', version: 3 } } },
        ])
        expect(now.documents).toMatchObject([{ title: 'Mine' }])

        // Discarding goes back to the newest server copy, not the one we had.
        await engine.discard(now.outbox[0].id)
        expect((await snapshot(db)).documents).toMatchObject([{ title: 'Theirs', version: 3 }])
    })

    it('"mine wins" resends against the version the conflict showed', async () => {
        const seen: (string | null)[] = []
        let first = true
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'PUT /api/v1/documents/d-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                if (first) {
                    first = false
                    return conflict(doc({ title: 'Theirs', version: 3 }))
                }
                return ok(docBody({ title: 'Mine', version: 4 }))
            },
        })
        const { engine, db } = await startEngine()
        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()

        await engine.retry((await db.snapshot()).outbox[0].id)
        await engine.idle()

        expect(seen).toEqual(['"2"', '"3"'])
        expect(await snapshot(db)).toMatchObject({ documents: [{ title: 'Mine', version: 4 }], outbox: [] })
    })

    it('treats an update whose copy is identical to what was sent as done: the answer was lost', async () => {
        const sent = { title: 'Mine', type: 'normal' as const, aspect_type_id: null, body: { content: 'Hello' } }
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            // No author on a document conflict: an identical copy is taken as ours.
            'PUT /api/v1/documents/d-1': () => conflict(doc({ ...sent, version: 3 })),
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()

        expect(await snapshot(db)).toMatchObject({ documents: [{ title: 'Mine', version: 3 }], outbox: [] })
    })

    it('a different copy is a real conflict even though it is the same document', async () => {
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'PUT /api/v1/documents/d-1': () => conflict(doc({ title: 'Mine', body: { content: 'Other words' }, version: 3 })),
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()

        expect((await snapshot(db)).outbox).toMatchObject([{ state: 'conflict' }])
    })

    it('treats "already archived" as done on an archive', async () => {
        stubFetch({
            ...listRoutes([], [doc({ version: 2 })]),
            'DELETE /api/v1/documents/d-1': () => conflict(doc({ version: 3 }), '2026-01-01T00:00:04Z'),
        })
        const { engine, db } = await startEngine()

        await engine.archiveDocument('d-1')
        await engine.idle()

        expect(await snapshot(db)).toMatchObject({ documents: [], outbox: [] })
    })

    it('reads an archived copy in a 409 on an edit as an archive, and keepAsNew copies the document with its filing', async () => {
        stubFetch({
            ...listRoutes([], [doc({ version: 2, team_id: null, project_id: 'p-1' })]),
            'PUT /api/v1/documents/d-1': () => conflict(doc({ version: 3 }), '2026-01-01T00:00:04Z'),
            'POST /api/v1/documents': () => new Promise<Response>(() => {}),
        })
        const { engine, db } = await startEngine()
        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()
        const parked = (await db.snapshot()).outbox[0]
        expect(parked).toMatchObject({ state: 'conflict', conflict: { archived: true } })

        const id = await engine.keepAsNew(parked.id)

        expect(id).toBe('tmp_1')
        const now = await db.snapshot()
        expect(now.documents).toMatchObject([{ id: 'tmp_1', title: 'Mine', project_id: 'p-1', team_id: null }])
        expect(now.outbox).toMatchObject([
            { entity: 'document', kind: 'create', entity_id: 'tmp_1', payload: { title: 'Mine', project_id: 'p-1' } },
        ])
    })
})

describe('failures', () => {
    it('parks a 422 as failed and shows the server\'s words', async () => {
        stubFetch({
            ...listRoutes([], [doc()]),
            'PUT /api/v1/documents/d-1': () =>
                problem(422, 'document_field_unknown', [{ location: 'body.body.zzz', message: 'unknown field' }]),
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { body: { zzz: 'x' } })
        await engine.idle()

        expect((await snapshot(db)).outbox).toMatchObject([
            { state: 'failed', error: { status: 422, code: 'document_field_unknown' } },
        ])
    })

    it('retries a 503 with backoff, like any other entity', async () => {
        let calls = 0
        stubFetch({
            ...listRoutes([], [doc()]),
            'PUT /api/v1/documents/d-1': () => (++calls === 1 ? problem(503, 'unavailable') : ok(docBody({ title: 'Renamed', version: 2 }))),
        })
        const { engine, db, clock } = await startEngine()

        await engine.updateDocument('d-1', { title: 'Renamed' })
        await engine.idle()
        expect((await snapshot(db)).outbox).toMatchObject([{ state: 'pending', attempts: 1 }])

        clock.advance(1_000)
        await engine.idle()

        expect(await snapshot(db)).toMatchObject({ documents: [{ version: 2 }], outbox: [] })
    })
})

describe('one outbox for every entity', () => {
    it('keeps each entity\'s order apart: a parked document does not hold up a ticket', async () => {
        const sent: string[] = []
        stubFetch({
            ...listRoutes([ticket({ version: 1 })], [doc({ version: 2 })]),
            'PUT /api/v1/documents/d-1': () => problem(422, 'document_field_unknown'),
            'PUT /api/v1/tickets/t-1': () => {
                sent.push('ticket')
                return ok(ticket({ title: 'Renamed', version: 2 }))
            },
        })
        const { engine, db } = await startEngine()

        await engine.updateDocument('d-1', { title: 'Mine' })
        await engine.idle()
        await engine.updateTicket('t-1', { title: 'Renamed' })
        await engine.idle()

        expect(sent).toEqual(['ticket'])
        expect((await snapshot(db)).outbox).toMatchObject([{ entity: 'document', state: 'failed' }])
        expect((await snapshot(db)).tickets).toMatchObject([{ id: 't-1', title: 'Renamed', version: 2 }])
    })

    it('sends a ticket and a document created in the same moment, each to its own endpoint, in the order they were made', async () => {
        const order: string[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/tickets': () => {
                order.push('ticket')
                return ok(ticket({ id: 't-9', version: 1 }))
            },
            'POST /api/v1/documents': () => {
                order.push('document')
                return ok(docBody({ id: 'd-9', version: 1 }))
            },
        })
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.createDocument(NEW)
        await engine.createTicket({ title: 'T', description: '', status_id: null, assignee_id: null, project_id: 'p-1' })
        net.goOnline()
        await engine.idle()

        expect(order).toEqual(['document', 'ticket'])
        expect(await snapshot(db)).toMatchObject({ documents: [{ id: 'd-9' }], tickets: [{ id: 't-9' }], outbox: [] })
    })

    it('paginates and pages the document list like the others', async () => {
        const cursors: unknown[] = []
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/documents/list': async (request) => {
                const { cursor } = (await bodyOf(request)) as { cursor?: string }
                cursors.push(cursor ?? null)
                return cursor
                    ? page([docBody({ id: 'd-2' })])
                    : page([docBody({ id: 'd-1' })], 'next')
            },
        })
        const { db } = await startEngine()

        expect(cursors).toEqual([null, 'next'])
        expect((await snapshot(db)).documents.map((d) => d.id).sort()).toEqual(['d-1', 'd-2'])
    })
})

describe('hydration', () => {
    it('lists documents, keeps a document with unsent changes as the user left it, and removes one gone from a complete list', async () => {
        let listed = [doc({ id: 'd-1', version: 1 }), doc({ id: 'd-2', version: 1 })]
        stubFetch({
            ...listRoutes(),
            'POST /api/v1/documents/list': () => page(listed.map((d) => docBody(d))),
        })
        const { engine, db, net } = await startEngine()
        expect((await snapshot(db)).documents.map((d) => d.id)).toEqual(['d-1', 'd-2'])

        // Offline, so the edit stays unsent; a list is still attempted.
        net.goOffline()
        await engine.updateDocument('d-1', { title: 'Mine' })
        listed = [doc({ id: 'd-1', title: 'Server', version: 2 })]
        await engine.hydrate()

        // d-2 was archived elsewhere; d-1 is the user's until its edit is resolved.
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-1', title: 'Mine' }])
        const copies = await db.write((tx) => tx.serverDocuments.all())
        expect(copies).toMatchObject([{ id: 'd-1', title: 'Server', version: 2 }])
    })

    it('fails the whole hydration if the document list fails, so half a state is never applied', async () => {
        stubFetch({
            ...listRoutes([ticket()]),
            'POST /api/v1/documents/list': () => problem(502, 'bad_gateway'),
        })
        const { engine, db } = await startEngine()

        expect(engine.status()).toMatchObject({ hydration: 'failed', hydrated: false, hydrationFailure: 'server' })
        expect((await snapshot(db)).tickets).toEqual([])
    })
})

describe('applyRemote', () => {
    const event = (type: string, row: Doc & { archived_at?: string | null }) => ({
        type,
        document_id: row.id,
        version: row.version,
        actor_id: 'acc-other',
        at: row.updated_at,
        document: docBody(row),
    })

    it('upserts a document by version and ignores a stale or equal one (your own echo)', async () => {
        stubFetch(listRoutes([], [doc({ version: 1 })]))
        const { engine, db } = await startEngine()

        expect(await engine.applyRemote(event('document.updated', doc({ title: 'Elsewhere', version: 2 })))).toBe(true)
        expect((await snapshot(db)).documents).toMatchObject([{ title: 'Elsewhere', version: 2 }])

        expect(await engine.applyRemote(event('document.updated', doc({ title: 'Old', version: 1 })))).toBe(false)
        expect(await engine.applyRemote(event('document.updated', doc({ title: 'Echo', version: 2 })))).toBe(false)
        expect((await snapshot(db)).documents).toMatchObject([{ title: 'Elsewhere' }])
    })

    it('stores a document created elsewhere, and removes it when archived, and an older frame cannot bring it back', async () => {
        stubFetch(listRoutes())
        const { engine, db } = await startEngine()

        expect(await engine.applyRemote(event('document.created', doc({ id: 'd-5', version: 1 })))).toBe(true)
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-5' }])

        const archivedAt = '2026-01-01T00:00:00Z'
        expect(await engine.applyRemote(event('document.archived', { ...doc({ id: 'd-5', version: 3 }), archived_at: archivedAt }))).toBe(true)
        expect((await snapshot(db)).documents).toEqual([])

        expect(await engine.applyRemote(event('document.updated', doc({ id: 'd-5', version: 2 })))).toBe(false)
        expect((await snapshot(db)).documents).toEqual([])
        expect(await engine.applyRemote(event('document.unarchived', doc({ id: 'd-5', version: 4 })))).toBe(true)
        expect((await snapshot(db)).documents).toMatchObject([{ id: 'd-5', version: 4 }])
    })

    it('does not touch the row of a document with unsent changes, only its server copy', async () => {
        stubFetch(listRoutes([], [doc({ version: 1 })]))
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.updateDocument('d-1', { title: 'Mine' })

        await engine.applyRemote(event('document.updated', doc({ title: 'Theirs', version: 2 })))

        expect((await snapshot(db)).documents).toMatchObject([{ title: 'Mine' }])
        expect(await db.write((tx) => tx.serverDocuments.all())).toMatchObject([{ title: 'Theirs', version: 2 }])
    })

    it('ignores a malformed document frame, and a frame of another entity does not land in documents', async () => {
        stubFetch(listRoutes())
        const { engine, db } = await startEngine()
        const good = event('document.created', doc({ id: 'd-5' }))

        for (const junk of [
            { ...good, document: null },
            { ...good, document: { ...good.document, type: 'weird' } },
            { ...good, document: { ...good.document, body: 'text' } },
            { ...good, document: { ...good.document, version: 0 } },
            { ...good, document_id: 'someone-else' },
            { ...good, version: 9 },
            { ...good, type: 'document.exploded' },
        ]) {
            expect(await engine.applyRemote(junk)).toBe(false)
        }
        expect((await snapshot(db)).documents).toEqual([])
        // An unrelated event that carries both shapes is read as what its type says.
        expect(
            await engine.applyRemote({ type: 'ticket.created', ticket_id: 't-7', version: 1, ticket: ticket({ id: 't-7' }), document: good.document }),
        ).toBe(true)
        expect((await snapshot(db)).documents).toEqual([])
        expect((await snapshot(db)).tickets).toMatchObject([{ id: 't-7' }])
    })

    it('the feed of a document does not disturb a ticket with the same id space', async () => {
        stubFetch(listRoutes([ticket({ id: 'same' })], []))
        const { engine, db } = await startEngine()

        await engine.applyRemote(event('document.created', doc({ id: 'other', version: 1 })))

        expect(await snapshot(db)).toMatchObject({ tickets: [{ id: 'same' }], documents: [{ id: 'other' }] })
    })
})

// LAM-166: an edit carries the version and per-field starting text it began on.
describe('update from the version an edit began on (LAM-166)', () => {
    const live = (row: Doc) => ({
        type: 'document.updated',
        document_id: row.id,
        version: row.version,
        actor_id: 'acc-other',
        at: row.updated_at,
        document: docBody(row),
    })
    const BODY = { content: 'Hello', notes: 'N' }
    const base = () => doc({ version: 3, body: BODY })

    it('same body key changed by someone else: parked as a clash on that key only, nothing lost', async () => {
        const seen: (string | null)[] = []
        const theirs = doc({ version: 4, body: { ...BODY, content: 'Theirs' } })
        stubFetch({
            ...listRoutes([], [base()]),
            'PUT /api/v1/documents/d-1': (request) => {
                seen.push(request.headers.get('If-Match'))
                return conflict(theirs)
            },
        })
        const { engine, db } = await startEngine()
        await engine.applyRemote(live(theirs))

        await engine.updateDocument(
            'd-1',
            { body: { ...theirs.body, content: 'Mine' } },
            { base: 3, was: { body: { content: 'Hello' } } },
        )
        await engine.idle()

        expect(seen).toEqual(['"3"'])
        const now = await db.snapshot()
        expect(now.outbox).toMatchObject([
            { state: 'conflict', clashing: ['body.content'], payload: { body: { content: 'Mine', notes: 'N' } }, conflict: { current: { version: 4 } } },
        ])
        expect(now.documents).toMatchObject([{ body: { content: 'Mine' } }])
    })

    it('someone else changed the title while we edit the body: no panel, both kept', async () => {
        const bodies: unknown[] = []
        const theirs = doc({ version: 4, title: 'Their title', body: BODY })
        stubFetch({
            ...listRoutes([], [base()]),
            'PUT /api/v1/documents/d-1': async (request) => {
                const sent = (await request.clone().json()) as { title: string; body: unknown }
                bodies.push(sent)
                return request.headers.get('If-Match') === '"3"' ? conflict(theirs) : ok(docBody({ ...theirs, ...sent, version: 5 } as Doc))
            },
        })
        const { engine, db } = await startEngine()
        await engine.applyRemote(live(theirs))

        await engine.updateDocument('d-1', { body: { ...BODY, content: 'Mine' } }, { base: 3, was: { body: { content: 'Hello' } } })
        await engine.idle()

        expect(bodies).toMatchObject([{ title: 'Their title' }, { title: 'Their title', body: { content: 'Mine', notes: 'N' } }])
        const now = await db.snapshot()
        expect(now.outbox).toEqual([])
        expect(now.documents).toMatchObject([{ title: 'Their title', body: { content: 'Mine' }, version: 5 }])
    })

    it('someone else changed a different body key: no panel, their key and ours kept', async () => {
        const theirs = doc({ version: 4, body: { ...BODY, notes: 'Their notes' } })
        let last: { body: unknown } | undefined
        stubFetch({
            ...listRoutes([], [base()]),
            'PUT /api/v1/documents/d-1': async (request) => {
                last = (await request.clone().json()) as { body: unknown }
                return request.headers.get('If-Match') === '"3"' ? conflict(theirs) : ok(docBody({ ...theirs, body: last.body as Doc['body'], version: 5 }))
            },
        })
        const { engine, db } = await startEngine()
        await engine.applyRemote(live(theirs))

        await engine.updateDocument('d-1', { body: { ...theirs.body, content: 'Mine' } }, { base: 3, was: { body: { content: 'Hello' } } })
        await engine.idle()

        expect(last).toMatchObject({ body: { content: 'Mine', notes: 'Their notes' } })
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('several saves in one editing session never conflict with our own acked writes', async () => {
        const seen: (string | null)[] = []
        let version = 3
        stubFetch({
            ...listRoutes([], [base()]),
            'PUT /api/v1/documents/d-1': async (request) => {
                seen.push(request.headers.get('If-Match'))
                version += 1
                const sent = (await request.clone().json()) as Doc
                return ok(docBody({ ...sent, id: 'd-1', version }))
            },
        })
        const { engine, db } = await startEngine()

        for (const text of ['one', 'two', 'three']) {
            await engine.updateDocument('d-1', { body: { ...BODY, content: text } }, { base: 3, was: { body: { content: 'Hello' } } })
            await engine.idle()
        }

        expect(seen).toEqual(['"3"', '"4"', '"5"'])
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('edits folded into a pending entry keep the earliest start of each body key', async () => {
        const theirs = doc({ version: 4, body: { ...BODY, content: 'Theirs' } })
        stubFetch({ ...listRoutes([], [base()]), 'PUT /api/v1/documents/d-1': () => conflict(theirs) })
        const { engine, db, net } = await startEngine()
        net.goOffline()
        await engine.updateDocument('d-1', { body: { ...BODY, content: 'Mine' } }, { base: 3, was: { body: { content: 'Hello' } } })
        await engine.applyRemote(live(theirs))
        await engine.updateDocument('d-1', { body: { ...BODY, content: 'Mine, longer', notes: 'N2' } }, { base: 4, was: { body: { content: 'Theirs' } } })

        const [entry] = (await db.snapshot()).outbox
        expect(entry).toMatchObject({ base_version: 3, was: { body: { content: 'Hello', notes: 'N' } } })

        net.goOnline()
        await engine.idle()
        expect((await db.snapshot()).outbox).toMatchObject([{ state: 'conflict', clashing: ['body.content'] }])
    })
})
