import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { listRoutes, startEngine } from '../testing/harness'

// Comments (LAM-112). The engine is the one labels and statuses use; what these
// pin down is where a comment differs: no version, an Idempotency-Key on the
// create, a body-only edit that only its author may make, and a change feed
// that carries the comment under `comment`.

afterEach(() => {
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const BASE = { field_id: null, region_start: null, region_end: null, review_status: null, document_id: null, ...stamp }
const FIRST = { ...BASE, id: 'c-1', ticket_id: 't-1', author_id: 'acc-1', body: 'first' }

async function started(extra: Parameters<typeof stubFetch>[0] = {}) {
    stubFetch({ ...listRoutes([], [], [], { comments: [FIRST] }), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const bodies = async (db: Awaited<ReturnType<typeof startEngine>>['db']) =>
    (await db.snapshot()).comments.map((comment) => comment.body).toSorted()

describe('create', () => {
    it('shows the comment at once, sends the parent, body and key, then takes the server id', async () => {
        let sent: unknown
        let key: string | null = null
        const { engine, db } = await started({
            'POST /api/v1/comments': async (request) => {
                sent = await bodyOf(request)
                key = request.headers.get('Idempotency-Key')
                return ok({ ...BASE, id: 'c-new', ticket_id: 't-1', author_id: 'acc-1', body: 'second' })
            },
        })

        const row = await engine.create('comment', { ticket_id: 't-1', document_id: null, body: 'second' })
        expect(row.id.startsWith('tmp_')).toBe(true)
        expect(await bodies(db)).toEqual(['first', 'second'])
        await engine.idle()

        expect(sent).toEqual({ ticket_id: 't-1', body: 'second' })
        expect(key).toMatch(/^[ -~]{1,128}$/)
        const snapshot = await db.snapshot()
        expect(snapshot.comments.map((comment) => comment.id).toSorted()).toEqual(['c-1', 'c-new'])
        expect(snapshot.outbox).toEqual([])
    })

    it('names a document as the parent when it is one', async () => {
        let sent: unknown
        const { engine } = await started({
            'POST /api/v1/comments': async (request) => {
                sent = await bodyOf(request)
                return ok({ ...BASE, id: 'c-new', ticket_id: null, document_id: 'd-1', author_id: 'acc-1', body: 'on a doc' })
            },
        })
        await engine.create('comment', { ticket_id: null, document_id: 'd-1', body: 'on a doc' })
        await engine.idle()
        expect(sent).toEqual({ document_id: 'd-1', body: 'on a doc' })
    })

    it('parks a refused create (422) as failed, with the server\'s reason', async () => {
        const { engine, db } = await started({ 'POST /api/v1/comments': () => problem(422, 'validation') })
        await engine.create('comment', { ticket_id: 't-1', document_id: null, body: 'x' })
        await engine.idle()
        expect((await db.snapshot()).outbox[0]).toMatchObject({ state: 'failed', error: { status: 422 } })
    })
})

describe('edit', () => {
    it('sends only the body, with no If-Match', async () => {
        let body: unknown
        let ifMatch: string | null = 'unset'
        const { engine, db } = await started({
            'PUT /api/v1/comments/c-1': async (request) => {
                body = await bodyOf(request)
                ifMatch = request.headers.get('If-Match')
                return ok({ ...FIRST, body: 'edited' })
            },
        })
        expect(await engine.update('comment', 'c-1', { body: 'edited' })).toBe(true)
        expect(await bodies(db)).toEqual(['edited'])
        await engine.idle()
        expect(body).toEqual({ body: 'edited' })
        expect(ifMatch).toBeNull()
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('parks the edit when the server says it is not the author\'s (403)', async () => {
        const { engine, db } = await started({ 'PUT /api/v1/comments/c-1': () => problem(403, 'comment_not_author') })
        await engine.update('comment', 'c-1', { body: 'edited' })
        await engine.idle()
        const [entry] = (await db.snapshot()).outbox
        expect(entry).toMatchObject({ state: 'failed', error: { status: 403, code: 'comment_not_author' } })
    })
})

describe('delete', () => {
    it('hides the comment at once and sends the DELETE', async () => {
        const { engine, db } = await started({ 'DELETE /api/v1/comments/c-1': () => new Response(null, { status: 204 }) })
        expect(await engine.archive('comment', 'c-1')).toBe(true)
        expect(await bodies(db)).toEqual([])
        await engine.idle()
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('the change feed', () => {
    const frame = (type: string, comment: { id: string; body?: string }) => ({
        type,
        actor_id: 'acc-other',
        at: stamp.created_at,
        comment,
        comment_id: comment.id,
        ticket_id: 't-1',
    })

    it('adds a comment others make, replaces one they edit, removes one they delete', async () => {
        const { engine, db } = await started()
        const second = { ...BASE, id: 'c-2', ticket_id: 't-1', author_id: 'acc-2', body: 'hello' }

        await engine.applyRemote(frame('comment.created', second))
        await engine.applyRemote(frame('comment.updated', { ...second, body: 'hello again' }))
        expect(await bodies(db)).toEqual(['first', 'hello again'])

        await engine.applyRemote(frame('comment.deleted', { ...second, body: 'hello again' }))
        expect(await bodies(db)).toEqual(['first'])
    })

    it('does not show our own comment twice when its event arrives after the answer', async () => {
        const mine = { ...BASE, id: 'c-new', ticket_id: 't-1', author_id: 'acc-1', body: 'second' }
        const { engine, db } = await started({ 'POST /api/v1/comments': () => ok(mine) })
        await engine.create('comment', { ticket_id: 't-1', document_id: null, body: 'second' })
        await engine.idle()
        await engine.applyRemote(frame('comment.created', mine))
        expect((await db.snapshot()).comments.filter((comment) => comment.id === 'c-new')).toHaveLength(1)
    })

    it('ignores a frame that is not a whole comment', async () => {
        const { engine, db } = await started()
        await engine.applyRemote({ type: 'comment.created', comment: { id: 'c-9' }, comment_id: 'c-9' })
        await engine.applyRemote({ type: 'comment.created', comment: { ...FIRST, id: 'c-8' }, comment_id: 'other' })
        expect(await bodies(db)).toEqual(['first'])
    })
})
