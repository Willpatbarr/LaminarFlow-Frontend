import { classify } from '@/api/errors'

import type { EntityTables, SyncDb, SyncTx } from './db'
import { rulesFor } from './entities'
import {
    createRemote,
    ListFailure,
    type AnyEvent,
    type AnyOutcome,
    type ServerState,
    type SyncApi,
} from './remote'
import {
    isTempId,
    newIdempotencyKey,
    newTempId,
    type Doc,
    type DocFields,
    type EntityArchives,
    type EntityConflicts,
    type EntityCreates,
    type EntityFields,
    type EntityName,
    type EntityRows,
    type EntryError,
    type NewDoc,
    type NewStatus,
    type Status,
    type StatusFields,
    type NewTicket,
    type OutboxEntry,
    type Ticket,
    type TicketFields,
} from './types'

/*
╔═ engine.ts ═══════════════════════════════════════════════════════════════════════════
║  sync · the rules: what a user action writes locally, and how it reaches the server
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      createSyncEngine   start/stop, hydrate, create/update/archive/unarchive for any registered
║                         entity (and the ticket and document spellings of them), retry/discard/
║                         keepAsNew/resume, applyRemote (one event from the change feed)
║      Timer, Connectivity   the two things it needs from the outside world
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      store.ts (the app, and the socket it owns), engine tests, the real-backend integration test (LAM-72)
╚═══════════════════════════════════════════════════════════════════════════════════════
*/
// No Solid and no DOM in here, on purpose: everything it touches arrives as an
// argument, so a test can hand it a fake clock and a fake network status and
// run it in plain Node.
//
// ANY ENTITY (LAM-125). Nothing here knows what a ticket or a document is. An
// entry names its `entity` and the engine asks that entity's rules (./entities)
// for the few things that differ: which fields are the user's, what a row looks
// like before the server has seen it, what a 409 means, how to talk to the
// endpoints. One outbox carries them all; its order is kept per `entity_id`
// (ids are unique across entities, temporary ones included), so a parked
// document blocks that document and nothing else. To add an entity, register it
// (./entities/index.ts); this file does not change.
//
// THE MODEL. The row on screen is always "the server's copy, with the outbox
// entries for that entity replayed on top" (`rebuild`). A user action only ever
// appends to (or amends) the outbox and rebuilds; an answer from the server
// only ever replaces the server's copy, removes the entry it answers, and
// rebuilds. Nothing else writes a row, which is why an optimistic edit
// cannot be lost by a refresh and a refresh cannot be lost by an edit.
//
// ONE WORKER. Hydration and sending both happen inside a single loop (`pass`),
// one request at a time. They therefore never overlap, and that is what makes
// "this ticket is missing from the server's list, remove it" safe: no create
// can be answered between the list being read and being applied.
//
// REMOTE EVENTS (LAM-68) go through that same worker. `applyRemote` only queues;
// the worker applies the queue between requests and after a hydration, never
// during one. That ordering is what keeps the feed and the other two writers
// from undoing each other: an event that arrives while a list is on the wire is
// applied on top of the list, by version, instead of being overwritten by it
// (or having its brand-new ticket removed as "missing from the list"); and one
// that arrives while a create is on the wire waits for the answer, so it finds
// the ticket under its real id instead of making a second row beside the
// temporary one.

export type Timer = {
    now(): number
    set(fn: () => void, ms: number): unknown
    clear(handle: unknown): void
}

export type Connectivity = {
    isOnline(): boolean
    /** Calls `fn` each time the network comes back. Returns the unsubscribe. */
    onOnline(fn: () => void): () => void
    /** Calls `fn` each time the browser reports the network gone. Returns the
     *  unsubscribe. The browser's word is taken over any socket's. */
    onOffline(fn: () => void): () => void
}

export const systemTimer: Timer = {
    now: () => Date.now(),
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export const alwaysOnline: Connectivity = {
    isOnline: () => true,
    onOnline: () => () => {},
    onOffline: () => () => {},
}

export type Backoff = { baseMs: number; maxMs: number }

export const DEFAULT_BACKOFF: Backoff = { baseMs: 1_000, maxMs: 60_000 }

export type EngineDeps = {
    db: SyncDb
    api: SyncApi
    /** Whose data this is. Decides whether a 409 is the echo of our own write. */
    accountId: string
    timer?: Timer
    connectivity?: Connectivity
    backoff?: Backoff
    /** Makes the temporary id for something created locally; `prefix` is the
     *  entity's own (`tmp_` for tickets). */
    newId?: (prefix: string) => string
    /** Makes the `Idempotency-Key` for a create. */
    newKey?: () => string
}

export type EngineStatus = {
    /** How the most recent hydration went. */
    hydration: 'idle' | 'running' | 'done' | 'failed'
    /** True once any hydration has succeeded since `start()`. */
    hydrated: boolean
    /** True after a 401: nothing is sent until `resume()`. */
    paused: boolean
    /** Set while the last hydration failed for a reason a retry may fix. */
    hydrationFailure: 'network' | 'server' | null
}

export type SyncChange = {
    /** A locally created ticket got its real id. Listeners that hold the old
     *  id (a selection, a URL) swap it for the new one. */
    swap?: { from: string; to: string }
}

export type SyncEngine = {
    /** Hydrates, then drains the outbox, and keeps draining as things are
     *  queued. An engine is used once: start it, stop it, make another. */
    start(): void
    /** Stops sending and listening. Resolves once nothing more will be written
     *  to the database, so it is safe to clear it afterwards. A request already
     *  on the wire is abandoned, not awaited. */
    stop(): Promise<void>
    /** Resolves when the worker has nothing it can do right now. For tests,
     *  and for callers that want to wait for a hydration they asked for. */
    idle(): Promise<void>
    /** Pulls every list from the server. Resolves true if it was applied. */
    hydrate(): Promise<boolean>
    status(): EngineStatus
    /** The four writes, for any registered entity. Each shows its result in the
     *  local row at once and queues the request; see the ticket spellings
     *  below for what each resolves with. */
    create<N extends EntityName>(entity: N, input: EntityCreates[N]): Promise<EntityRows[N]>
    update<N extends EntityName>(entity: N, id: string, patch: Partial<EntityFields[N]>): Promise<boolean>
    archive<N extends EntityName>(entity: N, id: string, ...payload: ArchiveArgs<N>): Promise<boolean>
    unarchive<N extends EntityName>(entity: N, row: EntityRows[N]): Promise<string | null>

    createTicket(ticket: NewTicket): Promise<Ticket>
    /** Resolves false if there is no such local ticket. A patch that changes
     *  nothing queues nothing. */
    updateTicket(id: string, patch: Partial<TicketFields>): Promise<boolean>
    archiveTicket(id: string): Promise<boolean>
    /** Undoes an archive. `ticket` is the row as it was before it was archived.
     *  If the archive has not reached the server it is simply withdrawn;
     *  otherwise an unarchive is queued and the row comes back at once.
     *  Resolves with the id the ticket has now (a ticket whose create was
     *  withdrawn by the archive is created again, under a new temporary id),
     *  or null when there is nothing to undo. */
    unarchiveTicket(ticket: Ticket): Promise<string | null>

    createStatus(status: NewStatus): Promise<Status>
    updateStatus(id: string, patch: Partial<StatusFields>): Promise<boolean>
    /** Deletes a status. `moveTo` is where the tickets that still use it go: a
     *  status of the same team, or null when none does (the server refuses a
     *  null while tickets, archived ones too, use it). */
    deleteStatus(id: string, moveTo: string | null): Promise<boolean>

    createDocument(document: NewDoc): Promise<Doc>
    updateDocument(id: string, patch: Partial<DocFields>): Promise<boolean>
    archiveDocument(id: string): Promise<boolean>
    unarchiveDocument(document: Doc): Promise<string | null>
    /** Sends a parked entry again. For a conflict this means "mine wins": it is
     *  resent against the server's current version. False if there is no such
     *  entry or it is on the wire. */
    retry(entryId: number): Promise<boolean>
    /** Drops an entry and everything queued behind it for the same entity (it
     *  was all built on top of it), and puts the local row back to the
     *  server's copy. False if there is no such entry or it is on the wire. */
    discard(entryId: number): Promise<boolean>
    /** For a parked edit that lost to someone else's change: makes a new
     *  one of the same entity, filed in the same place, out of the user's version (the row as it
     *  stands, later edits queued behind the conflict included), then resolves
     *  the original exactly as `discard` does. All in one transaction, so there
     *  is never a moment with the edit gone and no copy of it. Resolves with
     *  the new ticket's (temporary) id; null if there is no such entry, it is
     *  on the wire, or it is not an edit in conflict - an archive has no
     *  version of the user's to keep. */
    keepAsNew(entryId: number): Promise<string | null>
    /** After a 401 has been dealt with (the user signed in again): un-parks
     *  every `unauthorized` entry and carries on. */
    resume(): Promise<void>
    /** Tries everything that was waiting out a backoff right now: the entries,
     *  and the hydration if it failed. For a "Retry now" button. Does nothing
     *  while paused (a 401 needs `resume()`, not a retry). */
    retryNow(): void
    /** Applies one frame of the change feed (`unknown`: it comes off the wire).
     *  Resolves true if it changed the local data; false for an echo of our own
     *  write, a stale or out-of-order frame, a type or shape it does not
     *  understand, or an engine that has stopped. Never rejects on a bad frame. */
    applyRemote(event: unknown): Promise<boolean>
    subscribe(listener: (change: SyncChange) => void): () => void
}

type Rows = EntityTables<any>

/** An archive's payload, as the rest arguments of the call: none for an entity
 *  whose archive carries nothing, one for one whose archive says more. */
type ArchiveArgs<N extends EntityName> = EntityArchives[N] extends null ? [] : [payload: EntityArchives[N]]

export function createSyncEngine(deps: EngineDeps): SyncEngine {
    const { db, accountId } = deps
    const remote = createRemote(deps.api)
    const timer = deps.timer ?? systemTimer
    const connectivity = deps.connectivity ?? alwaysOnline
    const backoff = deps.backoff ?? DEFAULT_BACKOFF
    const newId = deps.newId ?? newTempId
    const newKey = deps.newKey ?? newIdempotencyKey

    let phase: 'new' | 'running' | 'stopped' = 'new'
    let paused = false
    let hydration: EngineStatus['hydration'] = 'idle'
    let hydrated = false
    // Why the last hydration failed, for the screen: no answer at all, or the
    // server's trouble. A 401 is not recorded here - it pauses the engine.
    let hydrationFailure: EngineStatus['hydrationFailure'] = null

    let hydrateWanted = false
    let hydrateWaiters: ((applied: boolean) => void)[] = []
    let hydrateFailures = 0
    let hydrateRetryAt = 0

    // The entry on the wire. A queued edit may be folded into an entry that
    // has not been sent, never into this one.
    let inFlight: number | null = null
    // A request that got no response says nothing about the entry and
    // everything about the network, so that backoff is shared by all entries.
    let networkFailures = 0
    let networkRetryAt = 0
    // A 5xx is about one entry: only that entry waits. entry id -> not before.
    const waits = new Map<number, number>()

    // Frames waiting for the worker, in arrival order.
    let remoteQueue: { event: AnyEvent; resolve: (changed: boolean) => void }[] = []
    // Things archived by someone else, and the version they were archived at.
    // Events are not ordered across writers, so an update at version 2 can still
    // arrive after the archive at 3, and with the server's copy deleted there
    // would be nothing to tell it is stale. Anything at or below this version is;
    // an unarchive is above it and clears it. A few bytes per archived row
    // for the length of the session.
    const buried = new Map<string, number>()

    let working: Promise<void> | null = null
    let again = false
    let wake: unknown = null
    let offOnline = () => {}

    // Resolves when the engine stops, so an await on the network can be
    // abandoned instead of holding up `stop()` for as long as a dead
    // connection takes to time out.
    let halt = () => {}
    const halted = new Promise<null>((resolve) => {
        halt = () => resolve(null)
    })

    const listeners = new Set<(change: SyncChange) => void>()

    function notify(change: SyncChange = {}) {
        for (const listener of listeners) {
            try {
                listener(change)
            } catch (error) {
                console.error('a sync listener failed', error)
            }
        }
    }

    const isRunning = () => phase === 'running'

    function delay(failures: number) {
        return Math.min(backoff.maxMs, backoff.baseMs * 2 ** (failures - 1))
    }

    const stamp = () => new Date(timer.now()).toISOString()

    // ── the local row ───────────────────────────────────────────────────────

    const tables = (tx: SyncTx, entity: EntityName) => tx.entity(entity) as Rows

    // The only function that writes the rows tables. See THE MODEL above.
    async function rebuild(tx: SyncTx, entity: EntityName, id: string) {
        const rules = rulesFor(entity)
        const { rows, server } = tables(tx, entity)
        let row = (await server.get(id)) ?? null
        const existing = await rows.get(id)

        // Whether the queue so far has an entry that is waiting for a person.
        let parked = false
        for (const entry of await tx.outbox.forEntity(id)) {
            parked ||= entry.state === 'conflict' || entry.state === 'failed'
            const by = { at: entry.created_at, accountId }
            if (entry.kind === 'create') {
                row = rules.fromCreate(id, entry.payload, by)
            } else if (entry.kind === 'update') {
                // No server copy to start from (it was dropped while this edit
                // was parked): the row as it stands is the next best base. An
                // unsent edit never makes its row disappear.
                const base = row ?? existing
                if (base) row = rules.edit(base, entry.payload, by)
            } else if (entry.kind === 'unarchive') {
                // It is back as it was, until the server answers.
                row = rules.restore(entry.payload, by)
            } else {
                // An archive hides the row until the server has agreed. But
                // one whose queue is waiting for a person - this archive
                // was refused or collided, or an edit before it was - must stay
                // reachable: its page is where the user is told so and decides.
                row = parked ? (row ?? existing ?? null) : null
            }
        }

        if (row) await rows.put(row)
        else await rows.delete(id)
        return row
    }

    // ── user actions ────────────────────────────────────────────────────────

    function blank() {
        return {
            state: 'pending' as const,
            attempts: 0,
            error: null,
            conflict: null,
            created_at: stamp(),
        }
    }

    // Whether a new edit may be folded into `entry` instead of queued behind
    // it. Only when the server certainly has not applied that entry: it was
    // never sent, or the server refused it. An entry that was sent and got no
    // answer may have been applied - if its payload were replaced now, the
    // retry would be refused as a conflict with our own lost write and there
    // would be no telling the two apart.
    function canFold(entry: OutboxEntry): boolean {
        if (entry.id === inFlight) return false
        if (entry.kind === 'archive' || entry.kind === 'unarchive') return false
        return entry.attempts === 0 || entry.state !== 'pending'
    }

    async function create<N extends EntityName>(entity: N, input: EntityCreates[N]): Promise<EntityRows[N]> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const rules = rulesFor(entity)
        const id = newId(rules.tempPrefix)
        const row = await db.write(async (tx) => {
            // Through the row and back, so the entry carries what the entity
            // keeps of the input and nothing the caller happened to pass along.
            const payload = rules.copyOf(rules.fromCreate(id, input, { at: stamp(), accountId }))
            await tx.outbox.add({
                kind: 'create',
                entity,
                entity_id: id,
                payload,
                idempotency_key: newKey(),
                base_version: null,
                ...blank(),
            } as never)
            return rebuild(tx, entity, id)
        })
        notify()
        kick()
        return row!
    }

    async function update<N extends EntityName>(
        entity: N,
        id: string,
        patch: Partial<EntityFields[N]>,
    ): Promise<boolean> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const rules = rulesFor(entity)
        const queued = await db.write(async (tx) => {
            const { rows, server: copies } = tables(tx, entity)
            const local = await rows.get(id)
            if (!local) return null
            const next = { ...rules.fieldsOf(local), ...patch }
            if (rules.sameFields(rules.fieldsOf(local), next)) return 'unchanged'

            const entries = await tx.outbox.forEntity(id)
            const last = entries.at(-1)
            // A row whose archive is parked is kept so it can be reached, not
            // so it can be edited: the user decides about the archive first.
            if (last?.kind === 'archive') return 'held'
            if (last && canFold(last)) {
                // A refused entry is worth sending again once its payload has
                // changed; a conflict still needs someone to decide.
                const state = last.state === 'failed' ? 'pending' : last.state
                await tx.outbox.put({
                    ...last,
                    payload: { ...last.payload, ...patch },
                    state,
                    attempts: state === last.state ? last.attempts : 0,
                    error: state === last.state ? last.error : null,
                    created_at: stamp(),
                } as OutboxEntry)
            } else {
                const server = await copies.get(id)
                await tx.outbox.add({
                    kind: 'update',
                    entity,
                    entity_id: id,
                    payload: next,
                    // Behind another entry there is no version to name yet:
                    // that entry's answer fills it in (`adopt`).
                    base_version: last ? null : (server?.version ?? null),
                    ...blank(),
                } as never)
            }
            await rebuild(tx, entity, id)
            return 'queued'
        })
        if (queued === 'queued') {
            notify()
            kick()
        }
        return queued !== null && queued !== 'held'
    }

    async function archive<N extends EntityName>(entity: N, id: string, ...rest: ArchiveArgs<N>): Promise<boolean> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const found = await db.write(async (tx) => {
            const { rows, server: copies } = tables(tx, entity)
            if (!(await rows.get(id))) return false
            const entries = await tx.outbox.forEntity(id)
            if (entries.at(-1)?.kind === 'archive') return false
            const only = entries.length === 1 ? entries[0] : undefined
            if (only && only.kind === 'create' && only.attempts === 0 && only.id !== inFlight) {
                // The server has never heard of this one, so there is
                // nothing to archive there: the create is simply withdrawn.
                await tx.outbox.delete(only.id)
            } else {
                const server = await copies.get(id)
                await tx.outbox.add({
                    kind: 'archive',
                    entity,
                    entity_id: id,
                    payload: rest[0] ?? null,
                    base_version: entries.length > 0 ? null : (server?.version ?? null),
                    ...blank(),
                } as never)
            }
            await rebuild(tx, entity, id)
            return true
        })
        if (found) {
            notify()
            kick()
        }
        return found
    }

    async function unarchive<N extends EntityName>(entity: N, snapshot: EntityRows[N]): Promise<string | null> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const rules = rulesFor(entity)
        const id = snapshot.id
        const result = await db.write(async (tx) => {
            const { rows } = tables(tx, entity)
            const entries = await tx.outbox.forEntity(id)
            const last = entries.at(-1)
            if (last?.kind === 'archive' && last.id !== inFlight && (last.attempts === 0 || last.state !== 'pending')) {
                // The server has not applied it (never sent, or refused):
                // withdrawing it is the whole undo.
                waits.delete(last.id)
                await tx.outbox.delete(last.id)
                await rebuild(tx, entity, id)
                return id
            }
            const visible = await rows.get(id)
            if (last?.kind !== 'archive' && visible) return null // not archived
            if (!visible && entries.length === 0 && isTempId(id)) {
                // Archiving withdrew the create, so it exists nowhere:
                // make it again, as the user had it.
                const fresh = newId(rules.tempPrefix)
                await tx.outbox.add({
                    kind: 'create',
                    entity,
                    entity_id: fresh,
                    payload: rules.copyOf(snapshot),
                    idempotency_key: newKey(),
                    base_version: null,
                    ...blank(),
                } as never)
                await rebuild(tx, entity, fresh)
                return fresh
            }
            await tx.outbox.add({
                kind: 'unarchive',
                entity,
                entity_id: id,
                payload: { ...snapshot },
                // Behind another entry the answer to that one fills it in. Alone,
                // it is at the version its archive made.
                base_version: last ? null : (buried.get(id) ?? snapshot.version + 1),
                ...blank(),
            } as never)
            await rebuild(tx, entity, id)
            return id
        })
        if (result !== null) {
            notify()
            kick()
        }
        return result
    }

    // ── answers from the server ─────────────────────────────────────────────

    // The server has this row at `server` because of `entry`. Entries queued
    // behind it were made on top of it, so they now name its version - and its
    // id, when the entry was the create and the id until now was temporary.
    async function adopt(tx: SyncTx, entry: OutboxEntry, server: { id: string; version: number }): Promise<SyncChange> {
        const from = entry.entity_id
        const { rows, server: copies } = tables(tx, entry.entity)
        await tx.outbox.delete(entry.id)
        for (const later of await tx.outbox.forEntity(from)) {
            await tx.outbox.put({ ...later, entity_id: server.id, base_version: server.version })
        }
        if (from !== server.id) await rows.delete(from)
        await copies.put(server)
        await rebuild(tx, entry.entity, server.id)
        return from === server.id ? {} : { swap: { from, to: server.id } }
    }

    // The server has archived this row, at `version` when that is known.
    // Normally nothing is queued behind an archive and the row is simply
    // forgotten. An unarchive queued behind it (an undo made while the archive
    // was on the wire) is kept, and now names the archived version.
    async function archived(tx: SyncTx, entry: OutboxEntry, version: number | null) {
        const behind = (await tx.outbox.forEntity(entry.entity_id)).filter((queued) => queued.id !== entry.id)
        if (behind.length === 0) {
            await forget(tx, entry.entity, entry.entity_id)
            return
        }
        waits.delete(entry.id)
        await tx.outbox.delete(entry.id)
        await tables(tx, entry.entity).server.delete(entry.entity_id)
        await tx.outbox.put({ ...behind[0], base_version: version })
        await rebuild(tx, entry.entity, entry.entity_id)
    }

    async function forget(tx: SyncTx, entity: EntityName, id: string) {
        for (const entry of await tx.outbox.forEntity(id)) {
            waits.delete(entry.id)
            await tx.outbox.delete(entry.id)
        }
        const { rows, server } = tables(tx, entity)
        await server.delete(id)
        await rows.delete(id)
    }

    // A 409 that is really a success: the server is already where this entry
    // wanted it. An archive of something that is archived, whoever did it; or an
    // update refused because of a change that is ours and identical to what we
    // sent - the first attempt landed and only its response was lost. "Ours"
    // alone is not enough: the same user editing in another tab is a real
    // conflict, and adopting it would silently drop this edit.
    function alreadyApplied(entry: OutboxEntry, conflict: EntityConflicts[EntityName]): boolean {
        const rules = rulesFor(entry.entity)
        if (entry.kind === 'archive') return rules.conflictIsArchive(conflict)
        // Only an edit, or a restore whose response was lost (it is back, by
        // us, as sent), can have been applied and answered with a conflict.
        if (entry.kind !== 'update' && entry.kind !== 'unarchive') return false
        const sent = entry.kind === 'update' ? entry.payload : rules.fieldsOf(entry.payload)
        return (
            !rules.conflictIsArchive(conflict) &&
            rules.conflictIsBy(conflict, accountId) &&
            rules.sameFields(rules.fieldsOf(conflict.current), sent)
        )
    }

    // The create this client sent landed, and someone archived the row before
    // the retry came: the server answers a replay of its key with the archived
    // conflict and the row. The create is therefore done, with a real id and a
    // history, and what is left is the user's own edits made since (if any).
    // Nothing here is an error for the user to puzzle over.
    async function createdThenArchived(
        tx: SyncTx,
        entry: OutboxEntry,
        conflict: EntityConflicts[EntityName],
    ): Promise<SyncChange> {
        const from = entry.entity_id
        const to = conflict.current.id
        waits.delete(entry.id)
        // A late frame for the row's life before the archive must not bring
        // it back.
        buried.set(to, Math.max(conflict.current.version, buried.get(to) ?? 0))

        const behind = (await tx.outbox.forEntity(from)).filter((queued) => queued.id !== entry.id)
        // Edits are worth keeping. An archive queued behind is the user saying
        // what the other person did, so there is nothing left to decide.
        if (behind.length === 0 || behind.some((queued) => queued.kind === 'archive')) {
            await forget(tx, entry.entity, from)
            // The feed may have shown it under its real id already.
            await forget(tx, entry.entity, to)
            return {}
        }

        // The edits become the same conflict an edit to an archived row is:
        // the head of the queue, parked, on the real id. The panel it gets
        // offers "Keep mine as a new one", which makes a create of its own,
        // under a key of its own.
        const { rows, server } = tables(tx, entry.entity)
        await tx.outbox.delete(entry.id)
        for (const [index, queued] of behind.entries()) {
            const moved = { ...queued, entity_id: to, base_version: index === 0 ? conflict.current.version : null }
            await tx.outbox.put(
                (index === 0 ? { ...moved, state: 'conflict', conflict, error: null } : moved) as OutboxEntry,
            )
        }
        await rows.delete(from)
        await server.put(conflict.current)
        await rebuild(tx, entry.entity, to)
        return { swap: { from, to } }
    }

    async function settle(sent: OutboxEntry, outcome: AnyOutcome): Promise<SyncChange> {
        if (outcome.type === 'network') {
            // With the browser saying it is offline, a failed request says
            // nothing about the server and `online` retries at once: a backoff
            // here would only make that wait longer.
            if (connectivity.isOnline()) {
                networkFailures += 1
                networkRetryAt = timer.now() + delay(networkFailures)
            }
        } else {
            networkFailures = 0
            networkRetryAt = 0
        }

        return db.write(async (tx) => {
            // The entry cannot have changed while it was on the wire (nothing
            // folds into, retries or discards the in-flight entry), but it is
            // read again so that what is written back is what is stored.
            const entry = await tx.outbox.get(sent.id)
            if (!entry) return {}
            const rules = rulesFor(entry.entity)

            const park = async (change: Partial<OutboxEntry>) => {
                const parked = { ...entry, ...change } as OutboxEntry
                await tx.outbox.put(parked)
                // Whether an archive queued here hides the row depends on the
                // state of what is ahead of it.
                await rebuild(tx, parked.entity, parked.entity_id)
                return {}
            }
            const unanswered = (error: EntryError) =>
                park({ attempts: entry.attempts + 1, error })

            switch (outcome.type) {
                case 'ok':
                    waits.delete(entry.id)
                    if (outcome.row) return adopt(tx, entry, outcome.row)
                    // Our own archive. Its echo says so; a late echo of an
                    // earlier write must not bring the row back before it.
                    if (entry.base_version !== null) buried.set(entry.entity_id, entry.base_version + 1)
                    await archived(tx, entry, entry.base_version === null ? null : entry.base_version + 1)
                    return {}

                case 'network':
                    return unanswered({ status: 0, code: 'network', errors: [] })

                case 'conflict':
                    if (entry.kind === 'create' && rules.conflictIsArchive(outcome.conflict)) {
                        return createdThenArchived(tx, entry, outcome.conflict)
                    }
                    if (alreadyApplied(entry, outcome.conflict)) {
                        if (entry.kind === 'archive') {
                            await archived(tx, entry, outcome.conflict.current.version)
                            return {}
                        }
                        return adopt(tx, entry, outcome.conflict.current)
                    }
                    // The freshest copy of a live row is worth keeping: it
                    // is what a discard goes back to.
                    // Not for a restore: its 409 can equally describe a row
                    // that is live again or one archived once more, and a
                    // discard must leave an archived row archived.
                    if (!rules.conflictIsArchive(outcome.conflict) && entry.kind !== 'unarchive') {
                        await tables(tx, entry.entity).server.put(outcome.conflict.current)
                    }
                    return park({ state: 'conflict', conflict: outcome.conflict, error: null } as Partial<OutboxEntry>)

                case 'http':
                    switch (classify(outcome.error)) {
                        case 'unauthorized':
                            paused = true
                            return park({ state: 'unauthorized', error: outcome.error })
                        case 'server':
                        case 'network':
                            waits.set(entry.id, timer.now() + delay(entry.attempts + 1))
                            return unanswered(outcome.error)
                        default:
                            // Validation, forbidden, not found, a 409 that is not
                            // a conflict: the server understood and said
                            // no. Sending the same thing again would get the
                            // same no.
                            return park({ state: 'failed', error: outcome.error })
                    }
            }
        })
    }

    // ── hydration ───────────────────────────────────────────────────────────

    async function applyServerState(tx: SyncTx, server: ServerState) {
        await tx.teams.clear()
        await tx.projects.clear()
        for (const team of server.teams) await tx.teams.put(team)
        for (const project of server.projects) await tx.projects.put(project)

        // A row with anything in the outbox is the user's until that is
        // resolved: its row on screen is left exactly as it is.
        const dirty = new Set((await tx.outbox.all()).map((entry) => entry.entity_id))
        for (const entity of Object.keys(server.rows) as EntityName[]) {
            const { rows, server: copies } = tables(tx, entity)
            const listed = new Set<string>()
            for (const row of server.rows[entity]) {
                listed.add(row.id)
                await copies.put(row)
                if (!dirty.has(row.id)) await rows.put(row)
            }

            // Gone from a complete list means archived somewhere else. With
            // unsent changes it stays, and sending them is what reports the
            // archive (409).
            const known = [...(await copies.all()), ...(await rows.all())]
            for (const row of known) {
                if (listed.has(row.id) || dirty.has(row.id)) continue
                await copies.delete(row.id)
                await rows.delete(row.id)
            }
        }
    }

    async function runHydration() {
        hydrateWanted = false
        hydration = 'running'
        notify()

        let applied = false
        try {
            const server = await Promise.race([remote.listEverything(), halted])
            if (!server || !isRunning()) return
            await db.write((tx) => applyServerState(tx, server))
            applied = true
        } catch (error) {
            if (!(error instanceof ListFailure)) throw error
            if (error.kind === 'unauthorized') paused = true
            else hydrationFailure = error.kind === 'network' ? 'network' : 'server'
        } finally {
            if (applied) {
                hydrated = true
                hydrationFailure = null
                hydrateFailures = 0
            } else {
                hydrateFailures += 1
                hydrateRetryAt = timer.now() + delay(hydrateFailures)
            }
            hydration = applied ? 'done' : 'failed'
            const waiters = hydrateWaiters
            hydrateWaiters = []
            for (const resolve of waiters) resolve(applied)
            if (isRunning()) notify()
        }
    }

    function hydrate(): Promise<boolean> {
        if (!isRunning()) return Promise.resolve(false)
        hydrateWanted = true
        const done = new Promise<boolean>((resolve) => hydrateWaiters.push(resolve))
        kick()
        return done
    }

    // ── the change feed ─────────────────────────────────────────────────────

    // The server's copy is what a frame is compared with and what it replaces.
    // A row with entries in the outbox is the user's until those are
    // resolved - the same rule hydration follows - so only its server copy
    // moves: the row on screen stays as it is, and a later discard goes back to
    // the newest state rather than the one we last heard. Its entries are not
    // touched either: a base version that is now stale must still reach the
    // server and come back as the 409 that LAM-71 shows.
    async function applyOne(tx: SyncTx, { entity, type, row }: AnyEvent): Promise<boolean> {
        const id = row.id
        const { rows, server: copies } = tables(tx, entity)
        const server = await copies.get(id)
        const dirty = (await tx.outbox.forEntity(id)).length > 0

        if (type === 'archived') {
            if (server && row.version < server.version) return false
            buried.set(id, Math.max(row.version, buried.get(id) ?? 0))
            if (!server && !(await rows.get(id))) return false
            await copies.delete(id)
            // With unsent changes the row stays, and sending them is what
            // reports the archive (409).
            if (!dirty) await rows.delete(id)
            return true
        }

        // An unversioned entity's frames are all at version 1: there is nothing
        // to compare with the server's copy, so a frame is an upsert. The buried
        // check still holds - a deleted id is never used again.
        if (server && !rulesFor(entity).unversioned && row.version <= server.version) return false
        if (row.version <= (buried.get(id) ?? 0)) return false
        buried.delete(id)
        await copies.put(row)
        if (!dirty) await rows.put(row)
        return true
    }

    async function applyQueuedEvents() {
        while (remoteQueue.length > 0 && isRunning()) {
            const batch = remoteQueue
            remoteQueue = []
            let changed = false
            for (const item of batch) {
                let applied = false
                try {
                    applied = await db.write((tx) => applyOne(tx, item.event))
                } catch (error) {
                    // One bad write must not stop the rest; the next hydration
                    // repairs whatever it would have done.
                    console.error('could not apply a remote change', error)
                }
                changed ||= applied
                item.resolve(applied)
            }
            if (changed && isRunning()) notify()
        }
    }

    function applyRemote(frame: unknown): Promise<boolean> {
        const event = remote.parseEvent(frame)
        if (!event || !isRunning()) return Promise.resolve(false)
        const done = new Promise<boolean>((resolve) => remoteQueue.push({ event, resolve }))
        kick()
        return done
    }

    // ── the worker ──────────────────────────────────────────────────────────

    // The oldest entry that may be sent now: at the head of its entity's queue
    // (FIFO per entity - a parked head blocks that one and no other),
    // pending, and not waiting out a backoff. Marked in flight inside the same
    // transaction that chose it, so a concurrent edit either lands before it is
    // chosen or sees that it is on the wire.
    function pickNext(): Promise<OutboxEntry | null> {
        return db.write(async (tx) => {
            const now = timer.now()
            const headSeen = new Set<string>()
            for (const head of await tx.outbox.all()) {
                if (headSeen.has(head.entity_id)) continue
                headSeen.add(head.entity_id)
                if (head.state !== 'pending') continue
                if ((waits.get(head.id) ?? 0) > now) continue

                let entry = head
                if (entry.kind !== 'create' && entry.base_version === null) {
                    // Only possible if the entry it was queued behind vanished
                    // without answering. The server's copy is the best base.
                    const server = await tables(tx, entry.entity).server.get(entry.entity_id)
                    if (server) {
                        entry = { ...entry, base_version: server.version }
                        await tx.outbox.put(entry)
                    }
                }
                inFlight = entry.id
                return entry
            }
            return null
        })
    }

    const canSend = () =>
        isRunning() &&
        !paused &&
        !hydrateWanted &&
        connectivity.isOnline() &&
        timer.now() >= networkRetryAt

    // A new engine means a session that works: whatever an earlier run parked
    // for a 401 (the tab was closed, or reloaded, before the user signed in)
    // is theirs to send now.
    let unparkWanted = true

    // What a send may read besides its entry (see SendContext).
    const sendContext = (entity: EntityName) => ({
        server: (id: string) => db.write((tx) => tables(tx, entity).server.get(id)),
        rows: () => db.write((tx) => tables(tx, entity).rows.all()),
    })

    async function pass() {
        if (unparkWanted) {
            unparkWanted = false
            await unparkUnauthorized()
        }
        // Attempted even when the browser says it is offline: the failure is
        // what tells the screen "could not load" instead of "still loading".
        if (hydrateWanted) await runHydration()
        // Also when nothing can be sent: the feed is not blocked by a pause or
        // by being offline, only by a request actually on the wire.
        await applyQueuedEvents()

        while (canSend()) {
            const entry = await pickNext()
            if (!entry) break
            try {
                const outcome = await Promise.race([remote.send(entry, sendContext(entry.entity)), halted])
                // Stopped while it was on the wire: the answer is not recorded.
                // The entry stays pending, exactly as if the response was lost.
                if (!outcome || !isRunning()) return
                const change = await settle(entry, outcome)
                inFlight = null
                notify(change)
                await applyQueuedEvents()
            } finally {
                // Also on the early return and on a throw.
                inFlight = null
            }
        }
        scheduleWake()
    }

    // One pass at a time. A kick during a pass asks for one more afterwards, so
    // nothing queued while it was busy is left waiting for the next event.
    function kick() {
        if (!isRunning()) return
        if (working) {
            again = true
            return
        }
        working = (async () => {
            try {
                do {
                    again = false
                    await pass()
                } while (again && isRunning())
            } catch (error) {
                console.error('the sync engine hit an unexpected error', error)
            } finally {
                working = null
            }
        })()
    }

    function scheduleWake() {
        if (wake !== null) timer.clear(wake)
        wake = null
        if (!isRunning() || paused) return

        const now = timer.now()
        const times = [...waits.values(), networkRetryAt]
        if (hydration === 'failed') times.push(hydrateRetryAt)
        const next = Math.min(...times.filter((time) => time > now))
        if (!Number.isFinite(next)) return

        wake = timer.set(() => {
            wake = null
            if (hydration === 'failed' && timer.now() >= hydrateRetryAt) hydrateWanted = true
            kick()
        }, next - now)
    }

    async function idle() {
        while (working) await working
    }

    // ── resolving parked entries ────────────────────────────────────────────

    async function retry(entryId: number): Promise<boolean> {
        if (!isRunning() || entryId === inFlight) return false
        const found = await db.write(async (tx) => {
            const entry = await tx.outbox.get(entryId)
            if (!entry || entryId === inFlight) return false
            await tx.outbox.put({
                ...entry,
                // "Mine wins" is still conditional: it names the version the
                // conflict showed, so a third writer in the gap is caught too.
                base_version: entry.conflict ? entry.conflict.current.version : entry.base_version,
                state: 'pending',
                attempts: 0,
                error: null,
                conflict: null,
            })
            // A retried archive hides its row again while it is on the wire.
            await rebuild(tx, entry.entity, entry.entity_id)
            return true
        })
        if (found) {
            waits.delete(entryId)
            notify()
            kick()
        }
        return found
    }

    // Drops `entry` and everything queued behind it, and puts the row back to
    // the server's copy. Shared by discard and keepAsNew, which differ only in
    // what they do first.
    async function dropFrom(tx: SyncTx, entry: OutboxEntry) {
        for (const queued of await tx.outbox.forEntity(entry.entity_id)) {
            if (queued.id < entry.id) continue
            waits.delete(queued.id)
            await tx.outbox.delete(queued.id)
        }
        // The server's copy of an archived row is not something to go
        // back to: it is gone, and the row goes with it.
        if (entry.conflict && rulesFor(entry.entity).conflictIsArchive(entry.conflict)) {
            await tables(tx, entry.entity).server.delete(entry.entity_id)
        }
        await rebuild(tx, entry.entity, entry.entity_id)
    }

    async function discard(entryId: number): Promise<boolean> {
        if (!isRunning() || entryId === inFlight) return false
        const found = await db.write(async (tx) => {
            const entry = await tx.outbox.get(entryId)
            if (!entry || entryId === inFlight) return false
            await dropFrom(tx, entry)
            return true
        })
        if (found) {
            notify()
            kick()
        }
        return found
    }

    async function keepAsNew(entryId: number): Promise<string | null> {
        if (!isRunning() || entryId === inFlight) return null
        const created = await db.write(async (tx) => {
            const entry = await tx.outbox.get(entryId)
            if (!entry || entryId === inFlight) return null
            if ((entry.kind !== 'update' && entry.kind !== 'unarchive') || entry.state !== 'conflict') return null
            // The row is the user's version: the server's copy with every
            // entry of theirs replayed on top, the ones behind the conflict
            // included. It has to be read before `dropFrom` rewrites it.
            const mine = await tables(tx, entry.entity).rows.get(entry.entity_id)
            if (!mine) return null

            const rules = rulesFor(entry.entity)
            const id = newId(rules.tempPrefix)
            await tx.outbox.add({
                kind: 'create',
                entity: entry.entity,
                entity_id: id,
                // The title as the user left it: a copy is not marked as one.
                payload: rules.copyOf(mine),
                // A new one is a new request: it must not replay the one
                // this was a conflict with.
                idempotency_key: newKey(),
                base_version: null,
                ...blank(),
            } as never)
            await rebuild(tx, entry.entity, id)
            await dropFrom(tx, entry)
            return id
        })
        if (created) {
            notify()
            kick()
        }
        return created
    }

    function unparkUnauthorized() {
        return db.write(async (tx) => {
            for (const entry of await tx.outbox.all()) {
                if (entry.state !== 'unauthorized') continue
                await tx.outbox.put({ ...entry, state: 'pending', error: null })
            }
        })
    }

    async function resume() {
        if (!isRunning()) return
        paused = false
        await unparkUnauthorized()
        if (hydration === 'failed') hydrateWanted = true
        notify()
        kick()
    }

    // Forgets every backoff. The same thing coming back online does, for the
    // person who knows better than the browser that the network is back.
    function retryNow() {
        if (!isRunning()) return
        networkRetryAt = 0
        waits.clear()
        if (hydration === 'failed') hydrateWanted = true
        kick()
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    function start() {
        if (phase !== 'new') throw new Error('a sync engine starts once; make a new one')
        phase = 'running'
        // Back online is the best moment to try everything again, whatever
        // each entry was waiting for.
        offOnline = connectivity.onOnline(retryNow)
        hydrateWanted = true
        kick()
    }

    async function stop() {
        if (phase === 'stopped') return
        phase = 'stopped'
        offOnline()
        if (wake !== null) timer.clear(wake)
        wake = null
        halt()
        await idle()
        // Anyone still waiting on a hydration that will now never run.
        for (const resolve of hydrateWaiters) resolve(false)
        hydrateWaiters = []
        for (const item of remoteQueue) item.resolve(false)
        remoteQueue = []
    }

    return {
        start,
        stop,
        idle,
        hydrate,
        status: () => ({ hydration, hydrated, paused, hydrationFailure }),
        create,
        update,
        archive,
        unarchive,
        createTicket: (ticket) => create('ticket', ticket),
        updateTicket: (id, patch) => update('ticket', id, patch),
        archiveTicket: (id) => archive('ticket', id),
        unarchiveTicket: (ticket) => unarchive('ticket', ticket),
        createStatus: (status) => create('status', status),
        updateStatus: (id, patch) => update('status', id, patch),
        deleteStatus: (id, moveTo) => archive('status', id, { move_to: moveTo }),
        createDocument: (document) => create('document', document),
        updateDocument: (id, patch) => update('document', id, patch),
        archiveDocument: (id) => archive('document', id),
        unarchiveDocument: (document) => unarchive('document', document),
        retry,
        discard,
        keepAsNew,
        resume,
        retryNow,
        applyRemote,
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}
