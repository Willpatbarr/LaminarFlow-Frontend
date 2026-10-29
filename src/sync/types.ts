import type { components } from '@/api/schema'

/*
┌─ sync ──────────────────────────────────────────
│  the rows the local database holds, and the outbox entry
├─ out ───────────────────────────────────────────
│      Ticket, TicketFields, Epic, Sprint, Milestone, Label, Doc, DocFields, Team, Project, Status, StatusFields, NewStatus
│      Board, BoardColumn, BoardFields, NewBoard, BoardConflict
│      SavedView, SavedViewConfig, SavedViewFields, NewSavedView
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
    /** The ticket's epic, if any (LAM-93). Null is normal: a ticket needs no parent. */
    epic_id: string | null
    /** The ticket's milestone, if any. A release is a milestone (LAM-82). */
    milestone_id: string | null
    /** Its labels, in id order. Empty for none. */
    label_ids: string[]
    /** The sprints it is in. The server does not put these on a ticket: the
     *  engine reads them through the `sprint` filter when it hydrates, and
     *  writes them with the add / remove calls. Empty for none. */
    sprint_ids: string[]
    /** Order within a board column: ascending, not unique (ties break on id).
     *  A ticket the server has not seen yet sorts last. */
    position: number
    /** 0 for a ticket the server has not seen yet; the server starts at 1. */
    version: number
    updated_at: string
    updated_by: string | null
}

/** What a user edits. `PUT /tickets/{id}` replaces the fields and an outbox
 *  payload carries all of them (one queued before LAM-103 may lack the last
 *  four, which reads as "leave them alone"). `position` is there only when the
 *  edit is a move (a drop on the board): it is then sent as
 *  `POST /tickets/{id}/move`, which sets the status and the position in one
 *  write (LAM-107). An edit that does not move a card leaves it out. */
export type TicketFields = Pick<
    Ticket,
    'title' | 'description' | 'status_id' | 'assignee_id' | 'epic_id' | 'milestone_id' | 'label_ids' | 'sprint_ids'
> & { position?: number }

/** A new ticket has no position of its own: the server puts it at the end.
 *  The hierarchy and labels are optional: leave them out for none. */
export type NewTicket = Pick<TicketFields, 'title' | 'description' | 'status_id' | 'assignee_id'> &
    Partial<Pick<TicketFields, 'epic_id' | 'milestone_id' | 'label_ids' | 'sprint_ids'>> & { project_id: string }

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
    /** The server keeps no version for a status (no `If-Match`, none on a change
     *  feed frame), so this is always 1. The engine needs one on every row, and
     *  the status entity is marked `unversioned` so it never compares them. */
    version: number
}

/** The four fields a user edits. `position` is the status's place in its team's
 *  order; changing it is sent as a reorder (the server has no per-status
 *  position write). */
export type StatusFields = Pick<Status, 'name' | 'color' | 'category' | 'position'>

export type NewStatus = StatusFields & { team_id: string }

/** One column of a board. `status_ids` are the statuses whose tickets it shows. */
export type BoardColumn = {
    id: string
    name: string
    position: number
    is_visible: boolean
    status_ids: string[]
}

/** A board and its columns. The server keeps no version for a board (no
 *  `If-Match`, none on a change feed frame), so `version` is always 1, as for a
 *  status. */
export type Board = {
    id: string
    project_id: string
    name: string
    group_by: string
    columns: BoardColumn[]
    version: number
}

/** What a user edits on a board. The columns go as a whole: the engine sends
 *  the difference from the server's copy (a rename, a visibility change, a new
 *  order, a new set of statuses), one call each. */
export type BoardFields = Pick<Board, 'name' | 'columns'>

export type NewBoard = BoardFields & { project_id: string }

/** The four things a ticket can be filed under. The app writes labels (LAM-104)
 *  and only reads the rest (the pickers); all are carried by the engine so they
 *  work offline and follow the change feed. The server keeps no version for
 *  them, so `version` is always 1, as for a status. */
export type Epic = { id: string; project_id: string; name: string; description: string; version: number }
export type Sprint = {
    id: string
    project_id: string
    name: string
    start_date: string | null
    end_date: string | null
    version: number
}
export type Milestone = {
    id: string
    project_id: string
    name: string
    description: string
    target_date: string | null
    version: number
}
export type Label = { id: string; team_id: string; name: string; color: string; version: number }

/** What a user edits. Labels are written from the app (LAM-104); the others are
 *  not yet (LAM-105), and their field types exist so the engine's maps are complete. */
export type EpicFields = Pick<Epic, 'name' | 'description'>
export type SprintFields = Pick<Sprint, 'name' | 'start_date' | 'end_date'>
export type MilestoneFields = Pick<Milestone, 'name' | 'description' | 'target_date'>
export type LabelFields = Pick<Label, 'name' | 'color'>

/** A saved list or board setup (LAM-118). `config` is the API's `Config` as it
 *  is: the list view's filter, group, sort and columns. The server keeps no
 *  version for one (no `If-Match`, no 409) and announces nothing on the change
 *  feed, so `version` is always 1 and a teammate's new view arrives with the
 *  next hydration. */
export type SavedViewConfig = components['schemas']['Config']
export type SavedView = {
    id: string
    team_id: string
    /** Null for a view of the whole team. */
    project_id: string | null
    /** Set exactly when `layout` is `board`. */
    board_id: string | null
    layout: 'list' | 'board'
    name: string
    /** False is private to the owner; true is visible to the whole team. */
    is_shared: boolean
    /** Null for a team's own view, which any member may edit. */
    owner_account_id: string | null
    config: SavedViewConfig
    version: number
}

/** What a user edits. The layout and the scope are fixed when it is saved. */
export type SavedViewFields = Pick<SavedView, 'name' | 'is_shared' | 'config'>

export type NewSavedView = SavedViewFields &
    Pick<SavedView, 'team_id' | 'project_id' | 'board_id' | 'layout'>

/** Read-only entities answer no 409; the type exists so the maps are complete. */
export type ReadOnlyConflict<Row> = { code: 'read_only_conflict'; current: Row; changed_at: string }

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

/** The status endpoints answer no 409 (there is no version to disagree about);
 *  the type exists so the maps are complete, and nothing ever builds one. */
export type StatusConflict = { code: 'status_conflict'; current: Status; changed_at: string }

/** Likewise: boards answer no 409. */
export type BoardConflict = { code: 'board_conflict'; current: Board; changed_at: string }

// pending       waiting to be sent, being sent, or waiting to be retried
// unauthorized  the server answered 401; nothing is sent until resume()
// conflict      the server answered 409; `conflict` holds its copy
// failed        the server refused it for good (422 and other 4xx); see `error`
export type EntryState = 'pending' | 'failed' | 'conflict' | 'unauthorized'

export type EntryKind = 'create' | 'update' | 'archive' | 'unarchive'

/** Every kind of thing the sync engine carries. Adding one means adding it to
 *  the four maps below and registering it (`entities/index.ts`). */
export type EntityName = 'ticket' | 'document' | 'status' | 'board' | 'epic' | 'sprint' | 'milestone' | 'label' | 'saved_view'

/** The row each entity keeps locally. */
export type EntityRows = {
    ticket: Ticket
    document: Doc
    status: Status
    board: Board
    epic: Epic
    sprint: Sprint
    milestone: Milestone
    label: Label
    saved_view: SavedView
}
/** What a user edits; `PUT` replaces all of it. */
export type EntityFields = {
    ticket: TicketFields
    document: DocFields
    status: StatusFields
    board: BoardFields
    epic: EpicFields
    sprint: SprintFields
    milestone: MilestoneFields
    label: LabelFields
    saved_view: SavedViewFields
}
/** What a create carries. */
export type EntityCreates = {
    ticket: NewTicket
    document: NewDoc
    status: NewStatus
    board: NewBoard
    epic: EpicFields & Pick<Epic, 'project_id'>
    sprint: SprintFields & Pick<Sprint, 'project_id'>
    milestone: MilestoneFields & Pick<Milestone, 'project_id'>
    label: LabelFields & Pick<Label, 'team_id'>
    saved_view: NewSavedView
}
/** What an archive carries. A ticket or document archive needs nothing; deleting
 *  a status says where its tickets go (`move_to`, a status of the same team). */
export type EntityArchives = {
    ticket: null
    document: null
    status: { move_to: string | null }
    board: null
    epic: null
    sprint: null
    milestone: null
    label: null
    saved_view: null
}
/** The body of a 409, kept on the entry so LAM-71 can show both sides. */
export type EntityConflicts = {
    ticket: TicketConflict
    document: DocConflict
    status: StatusConflict
    board: BoardConflict
    epic: ReadOnlyConflict<Epic>
    sprint: ReadOnlyConflict<Sprint>
    milestone: ReadOnlyConflict<Milestone>
    label: ReadOnlyConflict<Label>
    saved_view: ReadOnlyConflict<SavedView>
}

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
        | { kind: 'archive'; payload: EntityArchives[N] }
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
export type StatusEntry = EntryOf<'status'>
export type BoardEntry = EntryOf<'board'>
export type LabelEntry = EntryOf<'label'>
export type SavedViewEntry = EntryOf<'saved_view'>

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
        // Rows stored before LAM-103 have none of these until the next hydration.
        epic_id: ticket.epic_id ?? null,
        milestone_id: ticket.milestone_id ?? null,
        label_ids: ticket.label_ids ?? [],
        sprint_ids: ticket.sprint_ids ?? [],
    }
}
