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
// Sprint membership is the one thing on a ticket row the server does not put on
// a ticket: it is read by sprint when the list is hydrated, kept across change
// feed frames (which lack it), and written by the add / remove calls that follow
// the PUT. A sprint changed on another device therefore shows after the next
// hydration (reload or reconnect), not at once.

type TicketBody = components['schemas']['TicketBody']

/** Where a ticket the server has not seen yet sorts: after every position the
 *  server hands out, and inside the 32 bits it stores. */
export const LOCAL_END = 2 ** 30

/** `sprintIds` is not in the body (the server keeps sprint membership in a join
 *  table and does not put it on a ticket): the caller says what it knows. */
export function toTicket(body: TicketBody, sprintIds: string[] = []): Ticket {
    return {
        id: body.id,
        project_id: body.project_id,
        title: body.title,
        description: body.description,
        status_id: body.status_id,
        assignee_id: body.assignee_id,
        epic_id: body.epic_id ?? null,
        milestone_id: body.milestone_id ?? null,
        label_ids: body.label_ids ?? [],
        sprint_ids: sprintIds,
        position: body.position,
        version: body.version,
        updated_at: body.updated_at,
        updated_by: body.updated_by,
    }
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
    const left = a ?? []
    const right = b ?? []
    return left.length === right.length && left.every((id) => right.includes(id))
}

function sameFields(a: TicketFields, b: TicketFields): boolean {
    return (
        a.title === b.title &&
        a.description === b.description &&
        a.status_id === b.status_id &&
        a.assignee_id === b.assignee_id &&
        (a.epic_id ?? null) === (b.epic_id ?? null) &&
        (a.milestone_id ?? null) === (b.milestone_id ?? null) &&
        sameIds(a.label_ids, b.label_ids) &&
        sameIds(a.sprint_ids, b.sprint_ids) &&
        a.position === b.position
    )
}

// The fields the conflict panel can show side by side. A 409 is about the whole
// ticket, but it is only a conflict for the user when one of these, which they
// also changed, was changed by someone else too.
const CONTESTED = ['title', 'description', 'status_id', 'assignee_id'] as const
const isContested = (key: string) => (CONTESTED as readonly string[]).includes(key)

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
        // Absent on a server that predates LAM-93; null or [] then.
        !(row.epic_id === undefined || isNullableString(row.epic_id)) ||
        !(row.milestone_id === undefined || isNullableString(row.milestone_id)) ||
        !(row.label_ids === undefined || row.label_ids === null || (Array.isArray(row.label_ids) && row.label_ids.every(isString))) ||
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

// The body of a create or a PUT: the fields the endpoint takes (and the
// project, on a create). `position` is not one of them, and neither is
// `sprint_ids`: sprint membership is its own pair of calls (`syncSprints`).
function editable<F extends Partial<TicketFields>>(fields: F) {
    const { position: _position, sprint_ids: _sprints, ...rest } = fields
    return rest as Omit<F, 'position' | 'sprint_ids'>
}

type Raw = { data?: unknown; error?: unknown; response: Response }

// Puts the ticket in the sprints `want` names and takes it out of the rest. Each
// is its own call and the first that does not succeed ends the entry. Membership bumps the
// ticket's version, so the row to adopt is read again afterwards.
// (A retry after a failed sprint call is a 409 against our own PUT; `send`
// recognises it as applied.)
async function syncSprints(
    api: SyncApi,
    entry: { kind: EntryOf<'ticket'>['kind']; base_version: number | null; payload: unknown },
    ticketId: string,
    have: string[],
    want: string[] | undefined,
): Promise<Outcome<Ticket, TicketConflict> | null> {
    if (want === undefined) return null
    const leaving = have.filter((id) => !want.includes(id))
    const joining = want.filter((id) => !have.includes(id))
    if (leaving.length === 0 && joining.length === 0) return null
    const step = (call: () => Promise<Raw>) =>
        answer(entry, call, { row: () => null as never, conflict: () => null } as Codec<Ticket, TicketConflict>)
    for (const id of leaving) {
        const done = await step(() =>
            api.DELETE('/api/v1/sprints/{id}/tickets/{ticket_id}', { params: { path: { id, ticket_id: ticketId } } }),
        )
        if (done.type !== 'ok') return done
    }
    for (const id of joining) {
        const done = await step(() =>
            api.POST('/api/v1/sprints/{id}/tickets', { params: { path: { id } }, body: { ticket_id: ticketId } }),
        )
        if (done.type !== 'ok') return done
    }
    return answer(entry, () => api.GET('/api/v1/tickets/{id}', { params: { path: { id: ticketId } } }), {
        ...codec,
        row: (body: TicketBody) => toTicket(body, want),
    })
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
        !sameFields({ ...wants, position: undefined, status_id: null }, { ...fieldsOf(server), position: undefined, status_id: null })
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
            epic_id: null,
            milestone_id: null,
            label_ids: [],
            sprint_ids: [],
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
        // The feed's ticket frames do not carry sprint membership: the row we
        // already hold keeps its sprints until the next hydration.
        carry: (incoming, known) => (known ? { ...incoming, sprint_ids: known.sprint_ids ?? [] } : incoming),
        clash: (current, was) =>
            Object.keys(was).filter(
                (key) => isContested(key) && was[key] !== fieldsOf(current)[key as (typeof CONTESTED)[number]],
            ),
        merge: (mine, current, keep) => {
            const theirs = fieldsOf(current)
            return { ...mine, ...Object.fromEntries(CONTESTED.filter((key) => !keep.includes(key)).map((key) => [key, theirs[key]])) }
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
            // Sprint membership is not on a ticket: it is read through the
            // `sprint` filter, one sprint at a time.
            const members = new Map<string, string[]>()
            const projects = await listAll((cursor) =>
                api.POST('/api/v1/projects/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            for (const project of projects) {
                const sprints = await listAll(() => api.POST('/api/v1/sprints/list', { body: { project_id: project.id } }))
                for (const sprint of sprints) {
                    const inSprint = await listAll((cursor) =>
                        api.POST('/api/v1/tickets/list', {
                            body: {
                                limit: PAGE_SIZE,
                                cursor,
                                filter: { op: 'and', conditions: [{ field: 'sprint', op: 'eq', value: sprint.id }] },
                                sort: [{ field: 'created_at', desc: false }],
                            },
                        }),
                    )
                    for (const ticket of inSprint) members.set(ticket.id, [...(members.get(ticket.id) ?? []), sprint.id])
                }
            }
            return tickets.map((ticket) => toTicket(ticket, members.get(ticket.id) ?? []))
        },

        async send(api, entry, context) {
            // A drop on the board is the one edit that names a `position`: that
            // is a move (status and position in one write), not a PUT.
            if (entry.kind === 'update' && entry.payload.position !== undefined) {
                return sendMove(api, entry, await context.server(entry.entity_id))
            }
            const sent = await answer(
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
            // A retry whose PUT landed the first time (a sprint call after it
            // failed) is refused against our own write. When the server's copy
            // already holds exactly what this entry sent, the PUT is done and
            // only the sprint calls are left.
            const applied =
                sent.type === 'conflict' &&
                entry.kind === 'update' &&
                entry.payload.sprint_ids !== undefined &&
                sent.conflict.code === 'ticket_conflict' &&
                sameFields(
                    { ...fieldsOf(sent.conflict.current), sprint_ids: [], position: undefined },
                    { ...fieldsOf(entry.payload), sprint_ids: [], position: undefined },
                )
            const done: Outcome<Ticket, TicketConflict> = applied ? { type: 'ok', row: sent.conflict.current } : sent
            if (done.type !== 'ok' || !done.row) return done
            if (entry.kind !== 'create' && entry.kind !== 'update') return done

            // Sprint membership, after the write it rode in with: the ticket
            // exists (a create) or has taken its edit (an update, whose answer
            // carries the new version, which the memberships then move again).
            const known = entry.kind === 'update' ? await context.server(entry.entity_id) : undefined
            const member = await syncSprints(api, entry, done.row.id, known?.sprint_ids ?? [], entry.payload.sprint_ids)
            return member ?? { type: 'ok', row: { ...done.row, sprint_ids: entry.payload.sprint_ids ?? known?.sprint_ids ?? [] } }
        },

        parseEvent: (frame) => parseEvent(frame, 'ticket', readTicket),
    },
}
