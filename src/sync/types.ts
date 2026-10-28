import type { components } from '@/api/schema'

/*
┌─ sync ──────────────────────────────────────────
│  the rows the local database holds, and the outbox entry
├─ out ───────────────────────────────────────────
│      Ticket, TicketFields, Doc, DocFields, Team, Project, Status
│      EntityName, EntityRows, EntryOf, OutboxEntry, EntryState, TicketConflict, DocConflict, TicketSyncState
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

/** A document, as the local database holds it. Live documents only: an archived
 *  one is gone from this device, as an archived ticket is. */
export type Doc = {
    id: string
    title: string
    /** normal · aspect */
    type: 'normal' | 'aspect'
    /** Set exactly when `type` is `aspect`. */
    aspect_type_id: string | null
    /** Where it is filed. Fixed at creation; at most one is set. */
    team_id: string | null
    project_id: string | null
    /** Field id -> Markdown. A normal document keeps its text under `content`. */
    body: Record<string, string>
    /** 0 for a document the server has not seen yet; the server starts at 1. */
    version: number
    created_at: string
    updated_at: string
}

/** What `PUT /documents/{id}` replaces, so an outbox payload carries all four. */
export type DocFields = Pick<Doc, 'title' | 'type' | 'aspect_type_id' | 'body'>

export type NewDoc = DocFields & Pick<Doc, 'team_id' | 'project_id'>

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

/** The body of a 409 on a document. There is one code: `current.archived` says
 *  whether the document was edited or archived. `archived` is read from the
 *  server's `archived_at`, which the local row does not keep. */
export type DocConflict = {
    code: 'document_conflict'
    current: Doc
    /** True when the server's copy is archived. */
    archived: boolean
    changed_at: string
}

// pending       waiting to be sent, being sent, or waiting to be retried
// unauthorized  the server answered 401; nothing is sent until resume()
// conflict      the server answered 409; `conflict` holds its copy
// failed        the server refused it for good (422 and other 4xx); see `error`
export type EntryState = 'pending' | 'failed' | 'conflict' | 'unauthorized'

export type EntryKind = 'create' | 'update' | 'archive' | 'unarchive'

/** Every kind of thing the sync engine carries. Adding one means adding it to
 *  the four maps below and registering it (`entities/index.ts`). */
export type EntityName = 'ticket' | 'document'

/** The row each entity keeps locally. */
export type EntityRows = { ticket: Ticket; document: Doc }
/** What a user edits; `PUT` replaces all of it. */
export type EntityFields = { ticket: TicketFields; document: DocFields }
/** What a create carries. */
export type EntityCreates = { ticket: NewTicket; document: NewDoc }
/** The body of a 409, kept on the entry so LAM-71 can show both sides. */
export type EntityConflicts = { ticket: TicketConflict; document: DocConflict }

type EntryBase<N extends EntityName> = {
    /** Auto-incremented by IndexedDB, so id order is the order things were done. */
    id: number
    /** Which kind of entity this entry is about. */
    entity: N
    /** A temporary id (`isTempId`) until the entity's create has been answered. */
    entity_id: string
    /** The version this edit was made on top of, sent as `If-Match`. Null for a
     *  create, and for an entry queued behind another one for the same entity:
     *  that one fills it in with the version the server returns. */
    base_version: number | null
    state: EntryState
    /** Sends that got no usable answer (network error or 5xx). */
    attempts: number
    error: EntryError | null
    conflict: EntityConflicts[N] | null
    /** When the user did it. Becomes the local row's `updated_at`. */
    created_at: string
}

export type EntryOf<N extends EntityName> = EntryBase<N> &
    (
        | {
              kind: 'create'
              payload: EntityCreates[N]
              /** The `Idempotency-Key` every attempt to send this create carries.
               *  Made once, when the create is queued, so that an attempt whose
               *  response was lost and the attempt after it are the same request
               *  to the server. A create of a different entity gets a different
               *  key, always: the server never forgets one. Made for every
               *  entity; sent only where the endpoint takes it. */
              idempotency_key: string
          }
        | { kind: 'update'; payload: EntityFields[N] }
        | { kind: 'archive'; payload: null }
        | {
              kind: 'unarchive'
              /** The entity as it was when it was archived. The server's copy
               *  of an archived one is gone from this device, so the row
               *  that comes back has to come from the entry. */
              payload: EntityRows[N]
          }
    )

export type OutboxEntry = { [N in EntityName]: EntryOf<N> }[EntityName]

export type TicketEntry = EntryOf<'ticket'>
export type DocEntry = EntryOf<'document'>

/** An entry before IndexedDB has numbered it. */
export type NewOutboxEntry = OutboxEntry extends infer E ? (E extends unknown ? Omit<E, 'id'> : never) : never

/** What one row's marker shows: `synced`, or the state of the entry at the head
 *  of its queue. */
export type TicketSyncState = 'synced' | EntryState

const TEMP_PREFIX = 'tmp_'

/** A fresh temporary id. `prefix` is the entity's own rule (see `tempPrefix` in
 *  an entity definition) and must start with `tmp_`, so `isTempId` still holds. */
export function newTempId(prefix: string = TEMP_PREFIX): string {
    return prefix + crypto.randomUUID()
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
