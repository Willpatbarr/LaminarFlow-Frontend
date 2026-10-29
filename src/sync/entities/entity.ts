import type { RemoteEvent, SyncApi, Outcome } from '../http'
import type {
    EntityConflicts,
    EntityCreates,
    EntityFields,
    EntityName,
    EntityRows,
    EntryOf,
} from '../types'

/*
┌─ sync/entities ─────────────────────────────────
│  what the engine needs to know about one kind of entity
├─ out ───────────────────────────────────────────
│      Entity<N>        { name, rules, remote } - one registry entry
│      EntityRules<N>   the pure half: how rows, edits and conflicts behave
│      EntityRemote<N>  the HTTP half: list, send, and reading a change-feed frame
├─ example ───────────────────────────────────────
│      registering a new entity: add its row/fields/create/conflict types to the
│      maps in ../types.ts, a store pair in ../db.ts, a file here that exports an
│      Entity, and one line in ./index.ts. The engine, the outbox and the change
│      feed need no change.
*/
// The engine owns everything that is the same for every entity: the outbox, the
// optimistic row, ordering per entity, idempotency keys, backoff, 401 parking,
// hydration and the change feed. An Entity is the little that is not. It is
// split in two so the half that decides things (rules) can be read, and tested,
// without a network.

type Row<N extends EntityName> = EntityRows[N]
type Fields<N extends EntityName> = EntityFields[N]
type Conflict<N extends EntityName> = EntityConflicts[N]

/** Who made a change, and when: stamped onto the local row for an unsent one. */
export type Stamp = { at: string; accountId: string }

export type EntityRules<N extends EntityName> = {
    /** True for an entity the server keeps no version of (a status): its rows
     *  carry a constant `version`, the change feed is applied by upsert and
     *  remove instead of by comparing versions, and nothing is sent with
     *  `If-Match`. Absent means versioned. */
    unversioned?: boolean

    /** The temporary id's prefix. It must start with `tmp_` (see `isTempId`):
     *  that is the whole rule for telling an id the server has not seen. */
    tempPrefix: string

    /** The fields a user edits. */
    fieldsOf(row: Row<N>): Fields<N>
    sameFields(a: Fields<N>, b: Fields<N>): boolean

    /** The row a queued create shows until the server answers (version 0). */
    fromCreate(id: string, payload: EntityCreates[N], stamp: Stamp): Row<N>
    /** `base` with an unsent edit on top. */
    edit(base: Row<N>, fields: Fields<N>, stamp: Stamp): Row<N>
    /** An unsent unarchive: the row as it was, until the server answers. */
    restore(archived: Row<N>, stamp: Stamp): Row<N>
    /** A create that would make a copy of `row`: for "keep mine as new", and for
     *  undoing the archive of something that was never sent. */
    copyOf(row: Row<N>): EntityCreates[N]

    /** Optional: what a change-feed frame becomes when the row is already held.
     *  For an entity whose frames lack something the row has (a ticket's
     *  sprints), the held row's value is kept. */
    carry?(incoming: Row<N>, known: Row<N>): Row<N>

    /** Optional, with `merge`: of the fields in `was` (an edit's fields as they
     *  were when it began), the ones the server's `current` copy holds a different
     *  value for, so someone else changed them too. An entity without it treats
     *  every 409 as a conflict. */
    clash?(current: Row<N>, was: Record<string, unknown>): string[]
    /** `mine` (an edit's fields) with everything `was` does not name taken from
     *  the server's `current` copy: what the edit becomes on top of their change. */
    merge?(mine: Fields<N>, current: Row<N>, was: Record<string, unknown>): Fields<N>
    /** Optional, for a field made of parts (a document's body): what the part(s)
     *  of `field` this edit changes held when it began. `given` is the autosave's
     *  start value, `acked` what our own acked write left there, `before` the
     *  local row's value. Default: acked, else given, else before. */
    startOf?(field: string, patched: unknown, given: unknown, acked: unknown, before: unknown): unknown
    /** Optional: two `was` records of edits folded together; the earlier value of
     *  each part stays. Default: the earlier record's fields win. */
    foldWas?(earlier: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown>

    /** The server's copy in this 409 is archived. */
    conflictIsArchive(conflict: Conflict<N>): boolean
    /** The change this 409 describes was made by `accountId`, as far as the
     *  server says. Where it says nothing, true: an identical copy is then taken
     *  to be ours, and adopting an identical copy loses nothing. */
    conflictIsBy(conflict: Conflict<N>, accountId: string): boolean
}

/** What a send may look at besides its entry: the local database, read-only.
 *  An entity whose write needs more than the entry carries (a reorder needs
 *  the whole order) asks here instead of fetching its own copy. */
export type SendContext<N extends EntityName> = {
    /** The server's copy of one row. */
    server(id: string): Promise<Row<N> | undefined>
    /** Every row of this entity as the screen shows it, unsent changes included. */
    rows(): Promise<Row<N>[]>
}

export type EntityRemote<N extends EntityName> = {
    /** Every live row this account can see, every page of it. Throws
     *  `ListFailure` if any page fails: half a list must never be mistaken for
     *  the whole one, because rows missing from it get removed. */
    list(api: SyncApi): Promise<Row<N>[]>
    /** Sends one outbox entry. Never throws: every way it can go is an Outcome. */
    send(api: SyncApi, entry: EntryOf<N>, context: SendContext<N>): Promise<Outcome<Row<N>, Conflict<N>>>
    /** Reads one change-feed frame. Null for anything that is not an event of
     *  this entity that this client understands. Never throws. */
    parseEvent(frame: Record<string, unknown>): RemoteEvent<N, Row<N>> | null
}

export type Entity<N extends EntityName = EntityName> = {
    name: N
    rules: EntityRules<N>
    remote: EntityRemote<N>
}

/** The rules with the row types erased. The engine moves rows between tables
 *  and these rules and looks inside none of them, so for it the entity is
 *  only a name; this is the one place that fact is written down as a type. */
export type LooseRules = {
    unversioned?: boolean
    tempPrefix: string
    fieldsOf(row: any): any
    sameFields(a: any, b: any): boolean
    fromCreate(id: string, payload: any, stamp: Stamp): any
    edit(base: any, fields: any, stamp: Stamp): any
    restore(archived: any, stamp: Stamp): any
    copyOf(row: any): any
    carry?(incoming: any, known: any): any
    clash?(current: any, was: Record<string, unknown>): string[]
    merge?(mine: any, current: any, was: Record<string, unknown>): any
    startOf?(field: string, patched: unknown, given: unknown, acked: unknown, before: unknown): unknown
    foldWas?(earlier: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown>
    conflictIsArchive(conflict: any): boolean
    conflictIsBy(conflict: any, accountId: string): boolean
}
