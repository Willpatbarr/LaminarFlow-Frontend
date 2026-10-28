import type { components } from '@/api/schema'

/*
┌─ sync ──────────────────────────────────────────
│  the rows the local database holds, and the outbox entry
├─ out ───────────────────────────────────────────
│      Ticket, TicketFields, Team, Project, Status
│      OutboxEntry, EntryState, TicketConflict, TicketSyncState
*/
// Written out rather than aliased to the generated schema types: these are
// what is stored on disk, so a field the backend adds does not silently become
// part of the local database until someone decides it should.

export type Ticket = {
    id: string
    project_id: string
    title: string
    description: string
    status_id: string | null
    assignee_id: string | null
    /** 0 for a ticket the server has not seen yet; the server starts at 1. */
    version: number
    updated_at: string
    updated_by: string | null
}

/** The four fields a user edits. `PUT /tickets/{id}` replaces all four, so an
 *  outbox payload always carries all four. */
export type TicketFields = Pick<Ticket, 'title' | 'description' | 'status_id' | 'assignee_id'>

export type NewTicket = TicketFields & { project_id: string }

export type Team = { id: string; workspace_id: string; name: string }

export type Project = { id: string; team_id: string; name: string }

export type Status = {
    id: string
    team_id: string
    name: string
    color: string
    position: number
    /** not_started · in_progress · done */
    category: string
}

export type FieldError = NonNullable<components['schemas']['Error']['errors']>[number]

/** Why the last attempt did not succeed. `status` 0 means no response at all. */
export type EntryError = {
    status: number
    code: string
    errors: FieldError[]
}

/** The body of a 409, kept on the entry so LAM-71 can show both sides. */
export type TicketConflict = {
    code: 'ticket_conflict' | 'ticket_archived'
    current: Ticket
    changed_by: { account_id: string; display_name: string } | null
    changed_at: string
}

// pending       waiting to be sent, being sent, or waiting to be retried
// unauthorized  the server answered 401; nothing is sent until resume()
// conflict      the server answered 409; `conflict` holds its copy
// failed        the server refused it for good (422 and other 4xx); see `error`
export type EntryState = 'pending' | 'failed' | 'conflict' | 'unauthorized'

export type EntryKind = 'create' | 'update' | 'archive' | 'unarchive'

type EntryBase = {
    /** Auto-incremented by IndexedDB, so id order is the order things were done. */
    id: number
    /** A temporary id (`isTempId`) until the ticket's create has been answered. */
    ticket_id: string
    /** The version this edit was made on top of, sent as `If-Match`. Null for a
     *  create, and for an entry queued behind another one for the same ticket:
     *  that one fills it in with the version the server returns. */
    base_version: number | null
    state: EntryState
    /** Sends that got no usable answer (network error or 5xx). */
    attempts: number
    error: EntryError | null
    conflict: TicketConflict | null
    /** When the user did it. Becomes the local row's `updated_at`. */
    created_at: string
}

export type OutboxEntry = EntryBase &
    (
        | {
              kind: 'create'
              payload: NewTicket
              /** The `Idempotency-Key` every attempt to send this create carries.
               *  Made once, when the create is queued, so that an attempt whose
               *  response was lost and the attempt after it are the same request
               *  to the server. A create of a different ticket gets a different
               *  key, always: the server never forgets one. */
              idempotency_key: string
          }
        | { kind: 'update'; payload: TicketFields }
        | { kind: 'archive'; payload: null }
        | {
              kind: 'unarchive'
              /** The ticket as it was when it was archived. The server's copy
               *  of an archived ticket is gone from this device, so the row
               *  that comes back has to come from the entry. */
              payload: Ticket
          }
    )

/** An entry before IndexedDB has numbered it. */
export type NewOutboxEntry = OutboxEntry extends infer E ? (E extends unknown ? Omit<E, 'id'> : never) : never

/** What one ticket's row marker shows: `synced`, or the state of the entry at
 *  the head of its queue. */
export type TicketSyncState = 'synced' | EntryState

const TEMP_PREFIX = 'tmp_'

export function newTempId(): string {
    return TEMP_PREFIX + crypto.randomUUID()
}

/** A fresh `Idempotency-Key`: 36 printable ASCII characters, inside the 1-128
 *  the server accepts. */
export function newIdempotencyKey(): string {
    return crypto.randomUUID()
}

/** True for an id this client made up, which the server will replace. */
export function isTempId(id: string): boolean {
    return id.startsWith(TEMP_PREFIX)
}

export function fieldsOf(ticket: TicketFields): TicketFields {
    return {
        title: ticket.title,
        description: ticket.description,
        status_id: ticket.status_id,
        assignee_id: ticket.assignee_id,
    }
}
