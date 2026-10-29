import type { components } from '@/api/schema'

import { answer, isString, listAll, PAGE_SIZE, type Codec, type Outcome, type RemoteEvent } from '../http'
import type { Board, BoardColumn, BoardConflict, BoardFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  boards: the fourth entity (LAM-107)
├─ out ───────────────────────────────────────────
│      boardEntity   the registry entry
│      toBoard, boardFieldsOf, sortColumns
*/
// A board row holds its columns, because the API serves and announces them
// that way (`BoardBody.columns`, and `board` on every board event). How it
// differs from a ticket, and nothing else:
//  - the server keeps NO version: no If-Match, no 409. Rows hold a constant 1
//    and `unversioned` makes the change feed an upsert / remove on the id.
//  - there is no call that writes a board as a whole. An edit is the difference
//    between the row the screen shows and the server's copy, sent as the calls
//    it takes: a rename, a column's name or visibility, the statuses of the
//    columns whose set changed, and a reorder. Statuses first leave the
//    columns they are moving out of and then enter the ones they are moving
//    into, because a status may sit in only one column of a board.
//  - columns are not created or deleted from here (the default board's columns
//    are the team's statuses); a column the server does not know is skipped.
//  - an archive is a DELETE of the board; the create takes the name only.

type BoardBody = components['schemas']['BoardBody']
type ColumnBody = components['schemas']['ColumnBody']

/** Board order: by position, then id, because positions are not unique. */
export function sortColumns<C extends Pick<BoardColumn, 'position' | 'id'>>(columns: C[]): C[] {
    return columns.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

function toColumn(body: ColumnBody): BoardColumn {
    return {
        id: body.id,
        name: body.name,
        position: body.position,
        is_visible: body.is_visible,
        status_ids: body.status_ids ?? [],
    }
}

export function toBoard(body: BoardBody): Board {
    return {
        id: body.id,
        project_id: body.project_id,
        name: body.name,
        group_by: body.group_by,
        columns: sortColumns((body.columns ?? []).map(toColumn)),
        version: 1,
    }
}

export function boardFieldsOf(board: BoardFields): BoardFields {
    return { name: board.name, columns: board.columns.map((column) => ({ ...column, status_ids: [...column.status_ids] })) }
}

function sameColumn(a: BoardColumn, b: BoardColumn): boolean {
    return (
        a.id === b.id &&
        a.name === b.name &&
        a.position === b.position &&
        a.is_visible === b.is_visible &&
        a.status_ids.length === b.status_ids.length &&
        a.status_ids.every((id, index) => id === b.status_ids[index])
    )
}

function sameFields(a: BoardFields, b: BoardFields): boolean {
    return a.name === b.name && a.columns.length === b.columns.length && a.columns.every((column, index) => sameColumn(column, b.columns[index]))
}

const codec: Codec<Board, BoardConflict> = { row: toBoard, conflict: () => null }

function isColumn(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false
    const column = value as Record<string, unknown>
    return (
        isString(column.id) &&
        isString(column.name) &&
        typeof column.position === 'number' &&
        typeof column.is_visible === 'boolean' &&
        (column.status_ids === null || (Array.isArray(column.status_ids) && column.status_ids.every(isString)))
    )
}

function readBoard(frame: Record<string, unknown>): Board | null {
    const body = frame.board
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (
        !isString(row.id) ||
        !isString(row.project_id) ||
        !isString(row.name) ||
        !isString(row.group_by) ||
        !Array.isArray(row.columns) ||
        !row.columns.every(isColumn) ||
        frame.board_id !== row.id
    ) {
        return null
    }
    return toBoard(row as unknown as BoardBody)
}

// `board.column.updated` carries the whole board too, so it is an update of the
// board like the others. `board.deleted` is this entity's "archived".
const EVENTS: Record<string, 'created' | 'updated' | 'archived'> = {
    'board.created': 'created',
    'board.updated': 'updated',
    'board.column.updated': 'updated',
    'board.deleted': 'archived',
}

function parseBoardEvent(frame: Record<string, unknown>): RemoteEvent<'board', Board> | null {
    if (!isString(frame.type)) return null
    const type = EVENTS[frame.type]
    if (!type) return null
    const row = readBoard(frame)
    return row ? { entity: 'board', type, row } : null
}

type Step = Outcome<Board, BoardConflict>

export const boardEntity: Entity<'board'> = {
    name: 'board',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_board_',
        fieldsOf: boardFieldsOf,
        sameFields,
        fromCreate: (id, payload) => ({
            id,
            project_id: payload.project_id,
            name: payload.name,
            group_by: 'status',
            columns: payload.columns,
            version: 1,
        }),
        edit: (base, fields) => ({ ...base, ...boardFieldsOf(fields) }),
        // A board cannot be unarchived; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({ ...boardFieldsOf(row), project_id: row.project_id }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        async list(api) {
            const projects = await listAll((cursor) =>
                api.POST('/api/v1/projects/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const boards: Board[] = []
            for (const project of projects) {
                // Always one page (`has_more` is false), so the loop reads it once.
                const listed = await listAll(() => api.POST('/api/v1/boards/list', { body: { project_id: project.id } }))
                boards.push(...listed.map(toBoard))
            }
            return boards
        },

        async send(api, entry, context): Promise<Step> {
            if (entry.kind === 'unarchive') {
                return { type: 'http', error: { status: 400, code: 'unsupported', errors: [] } }
            }
            if (entry.kind === 'create') {
                return answer(
                    entry,
                    () =>
                        api.POST('/api/v1/projects/{id}/boards', {
                            params: { path: { id: entry.payload.project_id } },
                            body: { name: entry.payload.name, group_by: 'status' },
                        }),
                    codec,
                )
            }
            const path = { id: entry.entity_id }
            if (entry.kind === 'archive') {
                return answer(entry, () => api.DELETE('/api/v1/boards/{id}', { params: { path } }), codec)
            }

            const wants = entry.payload
            const server = (await context.server(entry.entity_id)) ?? (await context.rows()).find((row) => row.id === entry.entity_id)
            if (!server) return { type: 'http', error: { status: 404, code: 'board_not_found', errors: [] } }

            // Each step is its own call; the first that does not succeed ends the
            // entry and is what the engine sees. A retry diffs again from the
            // server's copy, so a step that already landed is not repeated.
            const step = (call: () => Promise<{ data?: unknown; error?: unknown; response: Response }>) =>
                answer(entry, call, { row: () => server, conflict: () => null } as Codec<Board, BoardConflict>)
            const known = new Map(server.columns.map((column) => [column.id, column]))
            const columns = wants.columns.filter((column) => known.has(column.id))

            if (wants.name !== server.name) {
                const done = await step(() => api.PUT('/api/v1/boards/{id}', { params: { path }, body: { name: wants.name } }))
                if (done.type !== 'ok') return done
            }

            for (const column of columns) {
                const was = known.get(column.id)!
                if (column.name === was.name && column.is_visible === was.is_visible) continue
                const done = await step(() =>
                    api.PUT('/api/v1/boards/{id}/columns/{column_id}', {
                        params: { path: { ...path, column_id: column.id } },
                        body: { name: column.name, is_visible: column.is_visible },
                    }),
                )
                if (done.type !== 'ok') return done
            }

            // Statuses leave before they arrive (see the header).
            const setStatuses = (column: BoardColumn, statusIds: string[]) =>
                step(() =>
                    api.PUT('/api/v1/boards/{id}/columns/{column_id}/statuses', {
                        params: { path: { ...path, column_id: column.id } },
                        body: { status_ids: statusIds },
                    }),
                )
            for (const column of columns) {
                const was = known.get(column.id)!
                const kept = was.status_ids.filter((id) => column.status_ids.includes(id))
                if (kept.length === was.status_ids.length) continue
                const done = await setStatuses(column, kept)
                if (done.type !== 'ok') return done
                known.set(column.id, { ...was, status_ids: kept })
            }
            for (const column of columns) {
                const was = known.get(column.id)!
                const same = was.status_ids.length === column.status_ids.length && was.status_ids.every((id) => column.status_ids.includes(id))
                if (same) continue
                const done = await setStatuses(column, column.status_ids)
                if (done.type !== 'ok') return done
            }

            // The order: every column the server has, the ones the user placed
            // first, in the order they placed them.
            const placed = sortColumns(columns).map((column) => column.id)
            const order = [...placed, ...server.columns.map((column) => column.id).filter((id) => !placed.includes(id))]
            const before = server.columns.map((column) => column.id)
            if (order.some((id, index) => id !== before[index])) {
                const done = await step(() =>
                    api.POST('/api/v1/boards/{id}/columns/reorder', { params: { path }, body: { column_ids: order } }),
                )
                if (done.type !== 'ok') return done
            }

            // The board as the server now has it.
            return answer(entry, () => api.GET('/api/v1/boards/{id}', { params: { path } }), codec)
        },

        parseEvent: parseBoardEvent,
    },
}
