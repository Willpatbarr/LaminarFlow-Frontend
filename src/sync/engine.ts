import type { SyncDb, SyncTx } from './db'
import { createRemote, ListFailure, type Outcome, type ServerState, type SyncApi } from './remote'
import {
    fieldsOf,
    newTempId,
    type EntryError,
    type NewTicket,
    type OutboxEntry,
    type Ticket,
    type TicketConflict,
    type TicketFields,
} from './types'

/*
╔═ engine.ts ═══════════════════════════════════════════════════════════════════════════
║  sync · the rules: what a user action writes locally, and how it reaches the server
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      createSyncEngine   start/stop, hydrate, the three ticket writes, retry/discard/resume
║      Timer, Connectivity   the two things it needs from the outside world
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      store.ts (the app), engine tests, the real-backend integration test (LAM-72)
╚═══════════════════════════════════════════════════════════════════════════════════════
*/
// No Solid and no DOM in here, on purpose: everything it touches arrives as an
// argument, so a test can hand it a fake clock and a fake network status and
// run it in plain Node.
//
// THE MODEL. The row on screen is always "the server's copy, with the outbox
// entries for that ticket replayed on top" (`rebuild`). A user action only ever
// appends to (or amends) the outbox and rebuilds; an answer from the server
// only ever replaces the server's copy, removes the entry it answers, and
// rebuilds. Nothing else writes a ticket row, which is why an optimistic edit
// cannot be lost by a refresh and a refresh cannot be lost by an edit.
//
// ONE WORKER. Hydration and sending both happen inside a single loop (`pass`),
// one request at a time. They therefore never overlap, and that is what makes
// "this ticket is missing from the server's list, remove it" safe: no create
// can be answered between the list being read and being applied.

export type Timer = {
    now(): number
    set(fn: () => void, ms: number): unknown
    clear(handle: unknown): void
}

export type Connectivity = {
    isOnline(): boolean
    /** Calls `fn` each time the network comes back. Returns the unsubscribe. */
    onOnline(fn: () => void): () => void
}

export const systemTimer: Timer = {
    now: () => Date.now(),
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export const alwaysOnline: Connectivity = { isOnline: () => true, onOnline: () => () => {} }

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
    /** Makes the temporary id for a ticket created locally. */
    newId?: () => string
}

export type EngineStatus = {
    /** How the most recent hydration went. */
    hydration: 'idle' | 'running' | 'done' | 'failed'
    /** True once any hydration has succeeded since `start()`. */
    hydrated: boolean
    /** True after a 401: nothing is sent until `resume()`. */
    paused: boolean
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
    createTicket(ticket: NewTicket): Promise<Ticket>
    /** Resolves false if there is no such local ticket. A patch that changes
     *  nothing queues nothing. */
    updateTicket(id: string, patch: Partial<TicketFields>): Promise<boolean>
    archiveTicket(id: string): Promise<boolean>
    /** Sends a parked entry again. For a conflict this means "mine wins": it is
     *  resent against the server's current version. False if there is no such
     *  entry or it is on the wire. */
    retry(entryId: number): Promise<boolean>
    /** Drops an entry and everything queued behind it for the same ticket (it
     *  was all built on top of it), and puts the local row back to the
     *  server's copy. False if there is no such entry or it is on the wire. */
    discard(entryId: number): Promise<boolean>
    /** After a 401 has been dealt with (the user signed in again): un-parks
     *  every `unauthorized` entry and carries on. */
    resume(): Promise<void>
    subscribe(listener: (change: SyncChange) => void): () => void
}

function sameFields(a: TicketFields, b: TicketFields): boolean {
    return (
        a.title === b.title &&
        a.description === b.description &&
        a.status_id === b.status_id &&
        a.assignee_id === b.assignee_id
    )
}

export function createSyncEngine(deps: EngineDeps): SyncEngine {
    const { db, accountId } = deps
    const remote = createRemote(deps.api)
    const timer = deps.timer ?? systemTimer
    const connectivity = deps.connectivity ?? alwaysOnline
    const backoff = deps.backoff ?? DEFAULT_BACKOFF
    const newId = deps.newId ?? newTempId

    let phase: 'new' | 'running' | 'stopped' = 'new'
    let paused = false
    let hydration: EngineStatus['hydration'] = 'idle'
    let hydrated = false

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

    // The only function that writes `tickets`. See THE MODEL above.
    async function rebuild(tx: SyncTx, ticketId: string): Promise<Ticket | null> {
        let row: Ticket | null = (await tx.serverTickets.get(ticketId)) ?? null
        const existing = await tx.tickets.get(ticketId)

        for (const entry of await tx.outbox.forTicket(ticketId)) {
            if (entry.kind === 'create') {
                row = {
                    id: ticketId,
                    ...entry.payload,
                    version: 0,
                    updated_at: entry.created_at,
                    updated_by: accountId,
                }
            } else if (entry.kind === 'update') {
                // No server copy to start from (it was dropped while this edit
                // was parked): the row as it stands is the next best base. An
                // unsent edit never makes its row disappear.
                const base = row ?? existing
                if (base) {
                    row = {
                        ...base,
                        ...entry.payload,
                        updated_at: entry.created_at,
                        updated_by: accountId,
                    }
                }
            } else {
                row = null
            }
        }

        if (row) await tx.tickets.put(row)
        else await tx.tickets.delete(ticketId)
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
        if (entry.kind === 'archive') return false
        return entry.attempts === 0 || entry.state !== 'pending'
    }

    async function createTicket(ticket: NewTicket): Promise<Ticket> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const id = newId()
        const row = await db.write(async (tx) => {
            await tx.outbox.add({
                kind: 'create',
                ticket_id: id,
                payload: { ...fieldsOf(ticket), project_id: ticket.project_id },
                base_version: null,
                ...blank(),
            })
            return rebuild(tx, id)
        })
        notify()
        kick()
        return row!
    }

    async function updateTicket(id: string, patch: Partial<TicketFields>): Promise<boolean> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const queued = await db.write(async (tx) => {
            const local = await tx.tickets.get(id)
            if (!local) return null
            const next = { ...fieldsOf(local), ...patch }
            if (sameFields(local, next)) return 'unchanged'

            const entries = await tx.outbox.forTicket(id)
            const last = entries.at(-1)
            if (last && last.kind !== 'archive' && canFold(last)) {
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
                const server = await tx.serverTickets.get(id)
                await tx.outbox.add({
                    kind: 'update',
                    ticket_id: id,
                    payload: next,
                    // Behind another entry there is no version to name yet:
                    // that entry's answer fills it in (`adopt`).
                    base_version: last ? null : (server?.version ?? null),
                    ...blank(),
                })
            }
            await rebuild(tx, id)
            return 'queued'
        })
        if (queued === 'queued') {
            notify()
            kick()
        }
        return queued !== null
    }

    async function archiveTicket(id: string): Promise<boolean> {
        if (!isRunning()) throw new Error('the sync engine is not running')
        const found = await db.write(async (tx) => {
            if (!(await tx.tickets.get(id))) return false
            const entries = await tx.outbox.forTicket(id)
            const only = entries.length === 1 ? entries[0] : undefined
            if (only && only.kind === 'create' && only.attempts === 0 && only.id !== inFlight) {
                // The server has never heard of this ticket, so there is
                // nothing to archive there: the create is simply withdrawn.
                await tx.outbox.delete(only.id)
            } else {
                const server = await tx.serverTickets.get(id)
                await tx.outbox.add({
                    kind: 'archive',
                    ticket_id: id,
                    payload: null,
                    base_version: entries.length > 0 ? null : (server?.version ?? null),
                    ...blank(),
                })
            }
            await rebuild(tx, id)
            return true
        })
        if (found) {
            notify()
            kick()
        }
        return found
    }

    // ── answers from the server ─────────────────────────────────────────────

    // The server has this ticket at `server` because of `entry`. Entries queued
    // behind it were made on top of it, so they now name its version - and its
    // id, when the entry was the create and the id until now was temporary.
    async function adopt(tx: SyncTx, entry: OutboxEntry, server: Ticket): Promise<SyncChange> {
        const from = entry.ticket_id
        await tx.outbox.delete(entry.id)
        for (const later of await tx.outbox.forTicket(from)) {
            await tx.outbox.put({ ...later, ticket_id: server.id, base_version: server.version })
        }
        if (from !== server.id) await tx.tickets.delete(from)
        await tx.serverTickets.put(server)
        await rebuild(tx, server.id)
        return from === server.id ? {} : { swap: { from, to: server.id } }
    }

    async function forget(tx: SyncTx, ticketId: string) {
        for (const entry of await tx.outbox.forTicket(ticketId)) {
            waits.delete(entry.id)
            await tx.outbox.delete(entry.id)
        }
        await tx.serverTickets.delete(ticketId)
        await tx.tickets.delete(ticketId)
    }

    // A 409 that is really a success: the server is already where this entry
    // wanted it. An archive of a ticket that is archived, whoever did it; or an
    // update refused because of a change that is ours and identical to what we
    // sent - the first attempt landed and only its response was lost. "Ours"
    // alone is not enough: the same user editing in another tab is a real
    // conflict, and adopting it would silently drop this edit.
    function alreadyApplied(entry: OutboxEntry, conflict: TicketConflict): boolean {
        if (entry.kind === 'archive') return conflict.code === 'ticket_archived'
        return (
            entry.kind === 'update' &&
            conflict.code === 'ticket_conflict' &&
            conflict.changed_by?.account_id === accountId &&
            sameFields(conflict.current, entry.payload)
        )
    }

    async function settle(sent: OutboxEntry, outcome: Outcome): Promise<SyncChange> {
        if (outcome.type === 'network') {
            networkFailures += 1
            networkRetryAt = timer.now() + delay(networkFailures)
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

            const park = async (change: Partial<OutboxEntry>) => {
                await tx.outbox.put({ ...entry, ...change } as OutboxEntry)
                return {}
            }
            const unanswered = (error: EntryError) =>
                park({ attempts: entry.attempts + 1, error })

            switch (outcome.type) {
                case 'ok':
                    waits.delete(entry.id)
                    if (outcome.ticket) return adopt(tx, entry, outcome.ticket)
                    await forget(tx, entry.ticket_id)
                    return {}

                case 'network':
                    return unanswered({ status: 0, code: 'network', errors: [] })

                case 'conflict':
                    if (alreadyApplied(entry, outcome.conflict)) {
                        if (entry.kind === 'archive') {
                            await forget(tx, entry.ticket_id)
                            return {}
                        }
                        return adopt(tx, entry, outcome.conflict.current)
                    }
                    // The freshest copy of a live ticket is worth keeping: it
                    // is what a discard goes back to.
                    if (outcome.conflict.code === 'ticket_conflict') {
                        await tx.serverTickets.put(outcome.conflict.current)
                    }
                    return park({ state: 'conflict', conflict: outcome.conflict, error: null })

                case 'http':
                    if (outcome.error.status === 401) {
                        paused = true
                        return park({ state: 'unauthorized', error: outcome.error })
                    }
                    if (outcome.error.status >= 500) {
                        waits.set(entry.id, timer.now() + delay(entry.attempts + 1))
                        return unanswered(outcome.error)
                    }
                    // 422, and every other 4xx: the server understood and said
                    // no. Sending the same thing again would get the same no.
                    return park({ state: 'failed', error: outcome.error })
            }
        })
    }

    // ── hydration ───────────────────────────────────────────────────────────

    async function applyServerState(tx: SyncTx, server: ServerState) {
        await tx.teams.clear()
        await tx.projects.clear()
        await tx.statuses.clear()
        for (const team of server.teams) await tx.teams.put(team)
        for (const project of server.projects) await tx.projects.put(project)
        for (const status of server.statuses) await tx.statuses.put(status)

        // A ticket with anything in the outbox is the user's until that is
        // resolved: its row on screen is left exactly as it is.
        const dirty = new Set((await tx.outbox.all()).map((entry) => entry.ticket_id))
        const listed = new Set<string>()
        for (const ticket of server.tickets) {
            listed.add(ticket.id)
            await tx.serverTickets.put(ticket)
            if (!dirty.has(ticket.id)) await tx.tickets.put(ticket)
        }

        // Gone from a complete list means archived somewhere else. With unsent
        // changes it stays, and sending them is what reports the archive (409).
        const known = [...(await tx.serverTickets.all()), ...(await tx.tickets.all())]
        for (const ticket of known) {
            if (listed.has(ticket.id) || dirty.has(ticket.id)) continue
            await tx.serverTickets.delete(ticket.id)
            await tx.tickets.delete(ticket.id)
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
            if (error.status === 401) paused = true
        } finally {
            if (applied) {
                hydrated = true
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

    // ── the worker ──────────────────────────────────────────────────────────

    // The oldest entry that may be sent now: at the head of its ticket's queue
    // (FIFO per ticket - a parked head blocks that ticket and no other),
    // pending, and not waiting out a backoff. Marked in flight inside the same
    // transaction that chose it, so a concurrent edit either lands before it is
    // chosen or sees that it is on the wire.
    function pickNext(): Promise<OutboxEntry | null> {
        return db.write(async (tx) => {
            const now = timer.now()
            const headSeen = new Set<string>()
            for (const head of await tx.outbox.all()) {
                if (headSeen.has(head.ticket_id)) continue
                headSeen.add(head.ticket_id)
                if (head.state !== 'pending') continue
                if ((waits.get(head.id) ?? 0) > now) continue

                let entry = head
                if (entry.kind !== 'create' && entry.base_version === null) {
                    // Only possible if the entry it was queued behind vanished
                    // without answering. The server's copy is the best base.
                    const server = await tx.serverTickets.get(entry.ticket_id)
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

    async function pass() {
        // Attempted even when the browser says it is offline: the failure is
        // what tells the screen "could not load" instead of "still loading".
        if (hydrateWanted) await runHydration()

        while (canSend()) {
            const entry = await pickNext()
            if (!entry) break
            try {
                const outcome = await Promise.race([remote.send(entry), halted])
                // Stopped while it was on the wire: the answer is not recorded.
                // The entry stays pending, exactly as if the response was lost.
                if (!outcome || !isRunning()) return
                const change = await settle(entry, outcome)
                inFlight = null
                notify(change)
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
            return true
        })
        if (found) {
            waits.delete(entryId)
            notify()
            kick()
        }
        return found
    }

    async function discard(entryId: number): Promise<boolean> {
        if (!isRunning() || entryId === inFlight) return false
        const found = await db.write(async (tx) => {
            const entry = await tx.outbox.get(entryId)
            if (!entry || entryId === inFlight) return false
            for (const queued of await tx.outbox.forTicket(entry.ticket_id)) {
                if (queued.id < entry.id) continue
                waits.delete(queued.id)
                await tx.outbox.delete(queued.id)
            }
            // The server's copy of an archived ticket is not something to go
            // back to: the ticket is gone, and the row goes with it.
            if (entry.conflict?.code === 'ticket_archived') {
                await tx.serverTickets.delete(entry.ticket_id)
            }
            await rebuild(tx, entry.ticket_id)
            return true
        })
        if (found) {
            notify()
            kick()
        }
        return found
    }

    async function resume() {
        if (!isRunning()) return
        paused = false
        await db.write(async (tx) => {
            for (const entry of await tx.outbox.all()) {
                if (entry.state !== 'unauthorized') continue
                await tx.outbox.put({ ...entry, state: 'pending', error: null })
            }
        })
        if (hydration === 'failed') hydrateWanted = true
        notify()
        kick()
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    function start() {
        if (phase !== 'new') throw new Error('a sync engine starts once; make a new one')
        phase = 'running'
        offOnline = connectivity.onOnline(() => {
            // Back online is the best moment to try everything again, whatever
            // each entry was waiting for.
            networkRetryAt = 0
            waits.clear()
            if (hydration === 'failed') hydrateWanted = true
            kick()
        })
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
    }

    return {
        start,
        stop,
        idle,
        hydrate,
        status: () => ({ hydration, hydrated, paused }),
        createTicket,
        updateTicket,
        archiveTicket,
        retry,
        discard,
        resume,
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}
