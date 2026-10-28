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
} from '../http'
import { fieldsOf, type Ticket, type TicketConflict, type TicketFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  tickets: the first entity, and the template for the next
├─ out ───────────────────────────────────────────
│      ticketEntity   the registry entry
│      toTicket, parseTicketEvent
*/

type TicketBody = components['schemas']['TicketBody']

export function toTicket(body: TicketBody): Ticket {
    return {
        id: body.id,
        project_id: body.project_id,
        title: body.title,
        description: body.description,
        status_id: body.status_id,
        assignee_id: body.assignee_id,
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
        a.assignee_id === b.assignee_id
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

export const ticketEntity: Entity<'ticket'> = {
    name: 'ticket',

    rules: {
        tempPrefix: 'tmp_',
        fieldsOf,
        sameFields,
        fromCreate: (id, payload, { at, accountId }) => ({
            id,
            ...payload,
            version: 0,
            updated_at: at,
            updated_by: accountId,
        }),
        edit: (base, fields, { at, accountId }) => ({ ...base, ...fields, updated_at: at, updated_by: accountId }),
        restore: (archived, { at, accountId }) => ({ ...archived, updated_at: at, updated_by: accountId }),
        copyOf: (row) => ({ ...fieldsOf(row), project_id: row.project_id }),
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

        send(api, entry) {
            return answer(
                entry,
                () => {
                    if (entry.kind === 'create') {
                        return api.POST('/api/v1/tickets', {
                            params: { header: { 'Idempotency-Key': entry.idempotency_key } },
                            body: entry.payload,
                        })
                    }
                    const params = { path: { id: entry.entity_id }, header: ifMatch(entry.base_version) }
                    if (entry.kind === 'update') return api.PUT('/api/v1/tickets/{id}', { params, body: entry.payload })
                    if (entry.kind === 'unarchive') return api.POST('/api/v1/tickets/{id}/unarchive', { params })
                    return api.DELETE('/api/v1/tickets/{id}', { params })
                },
                codec,
            )
        },

        parseEvent: (frame) => parseEvent(frame, 'ticket', readTicket),
    },
}
