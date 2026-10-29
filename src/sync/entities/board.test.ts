import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { BOARD, listRoutes, startEngine } from '../testing/harness'
import type { BoardColumn } from '../types'

// Boards are the fourth entity (LAM-107). Like a status a board has no
// version; unlike one it holds its columns, and an edit is the difference
// between the screen's board and the server's, sent as the calls it takes.

afterEach(() => {
    vi.unstubAllGlobals()
})

const BASE = '/api/v1/boards/b-1'

async function started(extra: Parameters<typeof stubFetch>[0] = {}) {
    stubFetch({ ...listRoutes([], [], [BOARD]), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const columnsOf = async (db: Awaited<ReturnType<typeof startEngine>>['db']) => (await db.snapshot()).boards[0].columns
const named = (columns: BoardColumn[]) => columns.map((column) => column.name)

describe('hydration', () => {
    it('lists every project\'s boards with their columns in order, and a constant version', async () => {
        const { db } = await started()
        const [board] = (await db.snapshot()).boards
        expect(board).toMatchObject({ id: 'b-1', project_id: 'p-1', name: 'Launch board', version: 1 })
        expect(board.columns).toMatchObject([
            { id: 'c-todo', status_ids: ['s-todo'] },
            { id: 'c-doing' },
            { id: 'c-done' },
        ])
    })
})

describe('editing columns', () => {
    it('renames a column at once and sends only that column', async () => {
        const calls: string[] = []
        let body: unknown
        const { engine, db } = await started({
            [`PUT ${BASE}/columns/c-todo`]: async (request) => {
                calls.push('column')
                body = await bodyOf(request)
                return ok({ ...BOARD.columns[0], name: 'Backlog' })
            },
            [`GET ${BASE}`]: () => ok({ ...BOARD, columns: [{ ...BOARD.columns[0], name: 'Backlog' }, ...BOARD.columns.slice(1)] }),
        })
        const columns = await columnsOf(db)

        expect(await engine.updateBoard('b-1', { columns: columns.map((c) => (c.id === 'c-todo' ? { ...c, name: 'Backlog' } : c)) })).toBe(true)
        expect(named(await columnsOf(db))).toEqual(['Backlog', 'In Progress', 'Done'])
        await engine.idle()

        expect(calls).toEqual(['column'])
        expect(body).toEqual({ name: 'Backlog', is_visible: true })
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('hides a column with is_visible', async () => {
        let body: unknown
        const { engine, db } = await started({
            [`PUT ${BASE}/columns/c-done`]: async (request) => {
                body = await bodyOf(request)
                return ok({ ...BOARD.columns[2], is_visible: false })
            },
            [`GET ${BASE}`]: () => ok({ ...BOARD, columns: BOARD.columns.map((c) => (c.id === 'c-done' ? { ...c, is_visible: false } : c)) }),
        })
        await engine.updateBoard('b-1', { columns: (await columnsOf(db)).map((c) => (c.id === 'c-done' ? { ...c, is_visible: false } : c)) })
        await engine.idle()
        expect(body).toEqual({ name: 'Done', is_visible: false })
        expect((await columnsOf(db)).find((c) => c.id === 'c-done')?.is_visible).toBe(false)
    })

    it('sends one reorder with every column, in the new order', async () => {
        let body: unknown
        const reordered = [BOARD.columns[2], BOARD.columns[0], BOARD.columns[1]].map((c, index) => ({ ...c, position: index + 1 }))
        const { engine, db } = await started({
            [`POST ${BASE}/columns/reorder`]: async (request) => {
                body = await bodyOf(request)
                return ok({ ...BOARD, columns: reordered })
            },
            [`GET ${BASE}`]: () => ok({ ...BOARD, columns: reordered }),
        })
        const columns = await columnsOf(db)
        const order = ['c-done', 'c-todo', 'c-doing']
        await engine.updateBoard('b-1', { columns: order.map((id, index) => ({ ...columns.find((c) => c.id === id)!, position: index + 1 })) })
        expect(named(await columnsOf(db))).toEqual(['Done', 'To Do', 'In Progress'])
        await engine.idle()

        expect(body).toEqual({ column_ids: order })
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('takes a status out of its column before putting it in another (a status sits in one column)', async () => {
        const calls: string[] = []
        const moved = BOARD.columns.map((c) =>
            c.id === 'c-todo' ? { ...c, status_ids: [] } : c.id === 'c-doing' ? { ...c, status_ids: ['s-doing', 's-todo'] } : c,
        )
        const { engine, db } = await started({
            [`PUT ${BASE}/columns/c-todo/statuses`]: async (request) => {
                calls.push(`todo ${JSON.stringify((await bodyOf(request)).status_ids)}`)
                return ok(moved[0])
            },
            [`PUT ${BASE}/columns/c-doing/statuses`]: async (request) => {
                calls.push(`doing ${JSON.stringify((await bodyOf(request)).status_ids)}`)
                return ok(moved[1])
            },
            [`GET ${BASE}`]: () => ok({ ...BOARD, columns: moved }),
        })
        const columns = await columnsOf(db)
        await engine.updateBoard('b-1', {
            columns: columns.map((c) =>
                c.id === 'c-todo' ? { ...c, status_ids: [] } : c.id === 'c-doing' ? { ...c, status_ids: ['s-doing', 's-todo'] } : c,
            ),
        })
        await engine.idle()

        expect(calls).toEqual(['todo []', 'doing ["s-doing","s-todo"]'])
        expect((await columnsOf(db)).find((c) => c.id === 'c-doing')?.status_ids).toEqual(['s-doing', 's-todo'])
    })

    it('keeps a refused change on screen, with the reason, until it is discarded', async () => {
        const { engine, db } = await started({
            [`PUT ${BASE}/columns/c-todo`]: () => problem(422, 'validation', [{ location: 'body.name', message: 'too long' }]),
        })
        const columns = await columnsOf(db)
        await engine.updateBoard('b-1', { columns: columns.map((c) => (c.id === 'c-todo' ? { ...c, name: 'Nope' } : c)) })
        await engine.idle()

        const { outbox } = await db.snapshot()
        expect(outbox).toMatchObject([{ entity: 'board', state: 'failed' }])
        expect(named(await columnsOf(db))).toEqual(['Nope', 'In Progress', 'Done'])

        await engine.discard(outbox[0].id)
        expect(named(await columnsOf(db))).toEqual(['To Do', 'In Progress', 'Done'])
    })
})

describe('the change feed', () => {
    const frame = (type: string, board: object, extra = {}) => ({
        type,
        actor_id: 'acc-other',
        at: '2026-01-01T00:00:01Z',
        project_id: 'p-1',
        board_id: (board as { id: string }).id,
        board,
        ...extra,
    })

    it('replaces the board on board.updated and on board.column.updated, and removes it on board.deleted', async () => {
        const { engine, db } = await started()
        const renamed = { ...BOARD, columns: BOARD.columns.map((c) => (c.id === 'c-todo' ? { ...c, name: 'Backlog' } : c)) }

        expect(await engine.applyRemote(frame('board.column.updated', renamed, { column_id: 'c-todo', column: renamed.columns[0] }))).toBe(true)
        expect(named(await columnsOf(db))).toEqual(['Backlog', 'In Progress', 'Done'])

        expect(await engine.applyRemote(frame('board.updated', { ...renamed, name: 'Renamed' }))).toBe(true)
        expect((await db.snapshot()).boards[0].name).toBe('Renamed')

        expect(await engine.applyRemote(frame('board.deleted', BOARD))).toBe(true)
        expect((await db.snapshot()).boards).toEqual([])
    })

    it('ignores a frame whose board is not the one it names', async () => {
        const { engine } = await started()
        expect(await engine.applyRemote(frame('board.updated', BOARD, { board_id: 'b-other' }))).toBe(false)
    })
})
