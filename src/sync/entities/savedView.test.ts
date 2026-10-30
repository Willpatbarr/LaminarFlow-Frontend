import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { listRoutes, startEngine } from '../testing/harness'
import { isTempId } from '../types'
import { sameConfig } from './savedView'

// Saved views (LAM-118): an unversioned entity with no change-feed events, whose
// edits and deletes the server allows to the owner alone.

afterEach(() => {
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const FILTER = { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-todo'] }] }
const BUGS = {
    id: 'sv-1',
    team_id: 'team-1',
    project_id: 'p-1',
    board_id: null,
    layout: 'list',
    name: 'Bugs',
    is_shared: false,
    owner_account_id: 'acc-me',
    config: { filter: FILTER, group: 'epic' },
    ...stamp,
}

async function started(extra: Parameters<typeof stubFetch>[0] = {}, views: unknown[] = [BUGS]) {
    stubFetch({ ...listRoutes([], [], [], { savedViews: views }), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

describe('hydration', () => {
    it('holds the views the server lists, with a constant version', async () => {
        const { db } = await started()

        expect((await db.snapshot()).savedViews).toEqual([
            {
                id: 'sv-1',
                team_id: 'team-1',
                project_id: 'p-1',
                board_id: null,
                layout: 'list',
                name: 'Bugs',
                is_shared: false,
                owner_account_id: 'acc-me',
                config: { filter: FILTER, group: 'epic' },
                updated_at: '2026-01-01T00:00:00Z',
                version: 1,
            },
        ])
    })

    it('drops a view the server no longer lists', async () => {
        const { engine, db } = await started()
        stubFetch(listRoutes([], [], [], { savedViews: [] }))

        await engine.hydrate()

        expect((await db.snapshot()).savedViews).toEqual([])
    })
})

describe('create', () => {
    it('shows the view at once, sends the whole setup, then takes the server id', async () => {
        let sent: unknown
        const { engine, db } = await started({
            'POST /api/v1/saved-views': async (request) => {
                sent = await bodyOf(request)
                return ok({ ...BUGS, id: 'sv-new', name: 'Board', layout: 'board', board_id: 'b-1', is_shared: true })
            },
        })

        const row = await engine.create('saved_view', {
            team_id: 'team-1',
            project_id: 'p-1',
            board_id: 'b-1',
            layout: 'board',
            name: 'Board',
            is_shared: true,
            config: { filter: FILTER },
        })
        expect(isTempId(row.id)).toBe(true)
        expect(row.owner_account_id).toBe('acc-me')
        expect((await db.snapshot()).savedViews.map((view) => view.name).toSorted()).toEqual(['Board', 'Bugs'])
        await engine.idle()

        expect(sent).toEqual({
            team_id: 'team-1',
            project_id: 'p-1',
            board_id: 'b-1',
            layout: 'board',
            name: 'Board',
            is_shared: true,
            config: { filter: FILTER },
        })
        const snapshot = await db.snapshot()
        expect(snapshot.savedViews.map((view) => view.id).toSorted()).toEqual(['sv-1', 'sv-new'])
        expect(snapshot.outbox).toEqual([])
    })

    it('leaves out the board and project of a team-wide list view', async () => {
        let sent: Record<string, unknown> = {}
        const { engine } = await started({
            'POST /api/v1/saved-views': async (request) => {
                sent = await bodyOf(request)
                return ok({ ...BUGS, id: 'sv-new', project_id: null })
            },
        })

        await engine.create('saved_view', {
            team_id: 'team-1',
            project_id: null,
            board_id: null,
            layout: 'list',
            name: 'All',
            is_shared: false,
            config: {},
        })
        await engine.idle()

        expect(sent).toEqual({ team_id: 'team-1', layout: 'list', name: 'All', is_shared: false, config: {} })
    })

    it('parks a create the server refuses, with its code', async () => {
        const { engine, db } = await started({
            'POST /api/v1/saved-views': () => problem(422, 'filter_invalid', [{ location: 'body.config.filter', message: 'bad' }]),
        })
        await engine.create('saved_view', {
            team_id: 'team-1',
            project_id: null,
            board_id: null,
            layout: 'list',
            name: 'Bad',
            is_shared: false,
            config: {},
        })
        await engine.idle()

        const [entry] = (await db.snapshot()).outbox
        expect(entry).toMatchObject({ state: 'failed', error: { code: 'filter_invalid' } })
    })
})

describe('update and delete', () => {
    it('re-saves name, sharing and config in one PUT with no If-Match', async () => {
        let body: unknown
        let ifMatch: string | null = 'unset'
        const { engine, db } = await started({
            'PUT /api/v1/saved-views/sv-1': async (request) => {
                body = await bodyOf(request)
                ifMatch = request.headers.get('If-Match')
                return ok({ ...BUGS, name: 'Defects', is_shared: true, config: { group: 'status' } })
            },
        })

        expect(await engine.update('saved_view', 'sv-1', { name: 'Defects', is_shared: true, config: { group: 'status' } })).toBe(true)
        expect((await db.snapshot()).savedViews[0]).toMatchObject({ name: 'Defects', is_shared: true })
        await engine.idle()

        expect(body).toEqual({ name: 'Defects', is_shared: true, config: { group: 'status' } })
        expect(ifMatch).toBeNull()
    })

    it('parks an edit of someone else\'s shared view (403 saved_view_not_owner)', async () => {
        const { engine, db } = await started({
            'PUT /api/v1/saved-views/sv-1': () => problem(403, 'saved_view_not_owner'),
        })
        await engine.update('saved_view', 'sv-1', { name: 'Mine now' })
        await engine.idle()

        const [entry] = (await db.snapshot()).outbox
        expect(entry).toMatchObject({ state: 'failed', error: { code: 'saved_view_not_owner' } })
    })

    it('deletes with a DELETE and forgets the row', async () => {
        let deleted = false
        const { engine, db } = await started({
            'DELETE /api/v1/saved-views/sv-1': () => {
                deleted = true
                return new Response(null, { status: 204 })
            },
        })

        expect(await engine.archive('saved_view', 'sv-1')).toBe(true)
        expect((await db.snapshot()).savedViews).toEqual([])
        await engine.idle()

        expect(deleted).toBe(true)
        expect((await db.snapshot()).outbox).toEqual([])
    })
})

describe('the change feed', () => {
    it('reads nothing: the server announces no saved view events', async () => {
        const { engine, db } = await started()

        engine.applyRemote({
            type: 'saved_view.created',
            saved_view_id: 'sv-x',
            saved_view: { ...BUGS, id: 'sv-x' },
        })
        await engine.idle()

        expect((await db.snapshot()).savedViews.map((view) => view.id)).toEqual(['sv-1'])
    })
})

describe('sameConfig', () => {
    it('does not mind the order of keys, which jsonb does not keep', () => {
        expect(
            sameConfig(
                { filter: { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['a'] }] }, group: 'epic' },
                { group: 'epic', filter: { conditions: [{ value: ['a'], op: 'in', field: 'status' }], op: 'and' } },
            ),
        ).toBe(true)
        expect(sameConfig({ group: 'epic' }, { group: 'status' })).toBe(false)
    })
})
