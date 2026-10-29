import type { components } from '@/api/schema'

import {
    answer,
    ifMatch,
    isNullableString,
    isString,
    listAll,
    PAGE_SIZE,
    parseEvent,
    type Codec,
    type Outcome,
    type SyncApi,
} from '../http'
import { fieldsOf, type EntryOf, type Ticket, type TicketConflict, type TicketFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  tickets: the first entity, and the template for the next
├─ out ───────────────────────────────────────────
│      ticketEntity   the registry entry
│      toTicket, parseTicketEvent
*/

type TicketBody = components['schemas']['TicketBody']

/** Where a ticket the server has not seen yet sorts: after every position the
 *  server hands out, and inside the 32 bits it stores. */
export const LOCAL_END = 2 ** 30

export function toTicket(body: TicketBody): Ticket {
    return {
        id: body.id,
        project_id: body.project_id,
        title: body.title,
        description: body.description,
        status_id: body.status_id,
        assignee_id: body.assignee_id,
        position: body.position,
        version: body.version,
        updated_at: body.updated_at,
        updated_by: body.updated_by,
    }
}

function sameFields(a: TicketFields, b: TicketFields): boolean {
    return (
        a.title === b.title &&
        a.description === b.description &&
        a.status_id === b.status_id &&
        a.assignee_id === b.assignee_id &&
        a.position === b.position
    )
}

const codec: Codec<Ticket, TicketConflict> = {
    row: toTicket,
    conflict(body: Partial<components['schemas']['TicketConflict']>) {
        if (!body.current || !body.code) return null
        return {
            code: body.code,
            current: toTicket(body.current),
            changed_by: body.changed_by ?? null,
            changed_at: body.changed_at ?? body.current.updated_at,
        }
    },
}

function readTicket(row: Record<string, unknown>): Ticket | null {
    if (
        !isString(row.id) ||
        !isString(row.project_id) ||
        !isString(row.title) ||
        !isString(row.description) ||
        !isNullableString(row.status_id) ||
        !isNullableString(row.assignee_id) ||
        !isString(row.updated_at) ||
        !isNullableString(row.updated_by) ||
        typeof row.position !== 'number' ||
        typeof row.version !== 'number' ||
        !Number.isInteger(row.version) ||
        row.version < 1
    ) {
        return null
    }
    return toTicket(row as unknown as TicketBody)
}

/** Reads one frame of the change feed. Null for anything that is not a ticket
 *  event this client understands. Never throws. */
export function parseTicketEvent(frame: unknown) {
    if (typeof frame !== 'object' || frame === null) return null
    return parseEvent(frame as Record<string, unknown>, 'ticket', readTicket)
}

// The body of a create or a PUT: the four fields the endpoint takes (and the
// project, on a create). `position` is not one of them.
function editable<F extends Partial<TicketFields>>(fields: F) {
    const { position: _position, ...rest } = fields
    return rest as Omit<F, 'position'>
}

type UpdateEntry = Extract<EntryOf<'ticket'>, { kind: 'update' }>

// The move, then - when title, description or assignee also differ from the
// server's copy - the edit on top of it, at the version the move returned.
async function sendMove(api: SyncApi, entry: UpdateEntry, server: Ticket | undefined): Promise<Outcome<Ticket, TicketConflict>> {
    const wants = entry.payload
    const moved = await answer(
        entry,
        () =>
            api.POST('/api/v1/tickets/{id}/move', {
                params: { path: { id: entry.entity_id }, header: ifMatch(entry.base_version) },
                // A ticket with no status has no column to be moved in; the
                // server's own status is then what it stays in.
                body: { status_id: wants.status_id ?? server?.status_id ?? '', position: wants.position! },
            }),
        codec,
    )
    // With no server copy to compare with, the edit is sent: a PUT that
    // changes nothing is harmless, and a missed one would lose the user's words.
    const rest =
        !server ||
        wants.title !== server.title ||
        wants.description !== server.description ||
        wants.assignee_id !== server.assignee_id
    if (moved.type !== 'ok' || !moved.row || !rest) return moved
    return answer(
        entry,
        () =>
            api.PUT('/api/v1/tickets/{id}', {
                params: { path: { id: entry.entity_id }, header: ifMatch(moved.row!.version) },
                body: editable({ ...wants, status_id: moved.row!.status_id }),
            }),
        codec,
    )
}

export const ticketEntity: Entity<'ticket'> = {
    name: 'ticket',

    rules: {
        tempPrefix: 'tmp_',
        fieldsOf,
        sameFields,
        // No position yet: the server puts a new ticket at the end of its
        // project, so until it answers the ticket sorts last.
        fromCreate: (id, payload, { at, accountId }) => ({
            id,
            ...payload,
            position: LOCAL_END,
            version: 0,
            updated_at: at,
            updated_by: accountId,
        }),
        edit: (base, fields, { at, accountId }) => ({ ...base, ...fields, updated_at: at, updated_by: accountId }),
        restore: (archived, { at, accountId }) => ({ ...archived, updated_at: at, updated_by: accountId }),
        copyOf: (row) => {
            const { position: _position, ...fields } = fieldsOf(row)
            return { ...fields, project_id: row.project_id }
        },
        conflictIsArchive: (conflict) => conflict.code === 'ticket_archived',
        conflictIsBy: (conflict, accountId) => conflict.changed_by?.account_id === accountId,
    },

    remote: {
        // Sorted on a field that never changes, so an edit made while the
        // pages are being read cannot move a ticket across a page boundary
        // and have it skipped.
        async list(api) {
            const tickets = await listAll((cursor) =>
                api.POST('/api/v1/tickets/list', {
                    body: { limit: PAGE_SIZE, cursor, sort: [{ field: 'created_at', desc: false }] },
                }),
            )
            return tickets.map(toTicket)
        },

        async send(api, entry, context) {
            // A drop on the board is the one edit that names a `position`: that
            // is a move (status and position in one write), not a PUT.
            if (entry.kind === 'update' && entry.payload.position !== undefined) {
                return sendMove(api, entry, await context.server(entry.entity_id))
            }
            return answer(
                entry,
                () => {
                    if (entry.kind === 'create') {
                        return api.POST('/api/v1/tickets', {
                            params: { header: { 'Idempotency-Key': entry.idempotency_key } },
                            body: editable(entry.payload),
                        })
                    }
                    const params = { path: { id: entry.entity_id }, header: ifMatch(entry.base_version) }
                    if (entry.kind === 'update') return api.PUT('/api/v1/tickets/{id}', { params, body: editable(entry.payload) })
                    if (entry.kind === 'unarchive') return api.POST('/api/v1/tickets/{id}/unarchive', { params })
                    return api.DELETE('/api/v1/tickets/{id}', { params })
                },
                codec,
            )
        },

        parseEvent: (frame) => parseEvent(frame, 'ticket', readTicket),
    },
}
