import { createMemo, createRoot, createStore, flush, reconcile } from 'solid-js'

import { api as appApi } from '@/api/client'
import { classify } from '@/api/errors'
import { toProblem } from '@/api/problem'

import { DB_NAME, openSyncDb, type SyncDb } from './db'
import {
    createSyncEngine,
    type Connectivity,
    type EngineStatus,
    type SyncChange,
    type SyncEngine,
    type Timer,
} from './engine'
import type { SyncApi } from './remote'
import {
    browserVisibility,
    createSocket,
    realtimeUrl,
    type ConnectionState,
    type RealtimeSocket,
    type SocketBackoff,
    type SocketClass,
    type Visibility,
} from './socket'
import type {
    NewTicket,
    OutboxEntry,
    Project,
    Status,
    Team,
    Ticket,
    TicketFields,
    TicketSyncState,
} from './types'

/*
╔═ store.ts ════════════════════════════════════════════════════════════════════════════
║  sync · what the screens read and call
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      sync                 reactive { teams, projects, statuses, tickets, outbox, … }
║      isLoading, loadFailed, needsSetup      which of the three "no list yet" cases this is
║      currentProject, selectProject          the project picker's state, remembered
║      ticketById, resolveTicketId, statusesForProject, ticketSyncState, parkedEntries
║      createTicket, updateTicket, archiveTicket   the only way a screen changes a ticket
║      retry, discard, keepAsNew, resume, rehydrate   for the error and conflict screens
║      resumeFor, retryNow                         after a re-login (same account only); skip the backoff
║      ticketHead, archiveOnHold, unsyncedCount    a ticket's queue head; whether its archive is parked; how many changes are unsent
║      createTeam, createProject                   first-run setup; online only
║      startSync, stopSync, wipeLocalData          lifecycle (called from session.ts)
║      sync.connection                              the change feed's state, for the indicator
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      features/tickets, and later the error (LAM-70) and conflict (LAM-71) screens
╚═══════════════════════════════════════════════════════════════════════════════════════
*/
// A mirror, not a second source of truth: every array here is a read of
// IndexedDB taken after the engine reported a change. Nothing writes this store
// except `refresh` below, so it cannot disagree with the database for longer
// than one read takes.

export type SyncState = {
    /** An engine is running for the signed-in account. */
    active: boolean
    /** The first read of the local database has landed. */
    loaded: boolean
    hydration: EngineStatus['hydration']
    hydrated: boolean
    /** The server answered 401; nothing is being sent until `resume()`. */
    paused: boolean
    /** The last list failed for a reason a retry may fix. */
    hydrationFailure: EngineStatus['hydrationFailure']
    /** The change feed (WebSocket). `offline` also means "not running". */
    connection: ConnectionState
    teams: Team[]
    projects: Project[]
    statuses: Status[]
    /** Every ticket, as the user should see it: unsent edits included. */
    tickets: Ticket[]
    /** Oldest first. Empty means everything has reached the server. */
    outbox: OutboxEntry[]
    /** The project the user last picked, if it still exists. */
    projectId: string | null
    /** Temporary id -> the id the server gave that ticket, for this session. */
    aliases: Record<string, string>
}

function empty(): SyncState {
    return {
        active: false,
        loaded: false,
        hydration: 'idle',
        hydrated: false,
        paused: false,
        hydrationFailure: null,
        connection: 'offline',
        teams: [],
        projects: [],
        statuses: [],
        tickets: [],
        outbox: [],
        projectId: null,
        aliases: {},
    }
}

const [state, setState] = createStore<SyncState>(empty())

/** Read-only from outside, like `session`: writes go through the functions. */
export const sync: Readonly<SyncState> = state

type Running = {
    accountId: string
    db: SyncDb
    engine: SyncEngine
    socket: RealtimeSocket
    api: SyncApi
    off: () => void
}

let current: Running | null = null

// ── mirroring the database ──────────────────────────────────────────────────

let latestRead = 0
let reading: Promise<void> = Promise.resolve()

function refresh(running: Running, change: SyncChange): Promise<void> {
    const mine = ++latestRead
    const status = running.engine.status()

    setState((draft) => {
        draft.hydration = status.hydration
        draft.hydrated = status.hydrated
        draft.paused = status.paused
        draft.hydrationFailure = status.hydrationFailure
        // The id swap is applied to the row in place, before the read below:
        // the row keeps its identity, so its DOM (and a field being typed in)
        // survives, and `reconcile` then matches it by its new id.
        if (change.swap) {
            const { from, to } = change.swap
            draft.aliases[from] = to
            const row = draft.tickets.find((ticket) => ticket.id === from)
            if (row) row.id = to
        }
    })
    flush()

    reading = running.db.snapshot().then((snapshot) => {
        // A newer read is on its way, or the engine this belongs to is gone:
        // applying this one would put stale rows back.
        if (mine !== latestRead || current !== running) return
        setState((draft) => {
            draft.loaded = true
            reconcile(snapshot.teams, 'id')(draft.teams)
            reconcile(snapshot.projects, 'id')(draft.projects)
            reconcile(snapshot.statuses, 'id')(draft.statuses)
            reconcile(snapshot.tickets, 'id')(draft.tickets)
            reconcile(snapshot.outbox, 'id')(draft.outbox)
        })
        flush()
    })
    return reading
}

// Resolves once the store shows everything written so far. A write function
// awaits this before it returns, so its caller can read the store on the next
// line and see its own write.
async function caughtUp() {
    let seen: Promise<void>
    do {
        seen = reading
        await seen
    } while (seen !== reading)
}

function running(): Running {
    if (!current) throw new Error('sync is not running: nobody is signed in')
    return current
}

// ── lifecycle ───────────────────────────────────────────────────────────────

const browserConnectivity: Connectivity = {
    isOnline: () => navigator.onLine,
    onOnline(fn) {
        window.addEventListener('online', fn)
        return () => window.removeEventListener('online', fn)
    },
    onOffline(fn) {
        window.addEventListener('offline', fn)
        return () => window.removeEventListener('offline', fn)
    },
}

export type StartOptions = {
    api?: SyncApi
    timer?: Timer
    connectivity?: Connectivity
    dbName?: string
    /** For tests: a fake WebSocket class, and the other things the socket would
     *  otherwise take from the browser. The timer and connectivity above are
     *  shared with the engine. */
    socket?: {
        url?: string
        WebSocketImpl?: SocketClass
        visibility?: Visibility
        random?: () => number
        backoff?: SocketBackoff
        helloTimeoutMs?: number
    }
}

// Start, stop and wipe each touch the database connection, and each is async.
// Running them strictly one after another is what makes "log out, then log in
// as someone else" safe however fast it happens.
let lifecycle: Promise<unknown> = Promise.resolve()

function inOrder<T>(step: () => Promise<T>): Promise<T> {
    const next = lifecycle.then(step, step)
    lifecycle = next.catch(() => {})
    return next
}

const META_ACCOUNT = 'account_id'
const META_PROJECT = 'last_project_id'

async function halt() {
    if (!current) return
    const stopping = current
    // First, so no frame is handed to an engine that is on its way out.
    stopping.socket.stop()
    await stopping.engine.stop()
    stopping.off()
    current = null
    stopping.db.close()
    // The mirror is emptied too: the next account must not see these rows for
    // even one frame.
    setState(reconcile(empty(), 'id'))
    flush()
}

/** Opens the local database for `accountId` and starts syncing. A database
 *  left behind by a different account is emptied first. */
export function startSync(accountId: string, options: StartOptions = {}): Promise<void> {
    return inOrder(async () => {
        if (current?.accountId === accountId) return
        await halt()

        const db = await openSyncDb(options.dbName ?? DB_NAME)
        if ((await db.getMeta<string>(META_ACCOUNT)) !== accountId) {
            await db.clear()
            await db.setMeta(META_ACCOUNT, accountId)
        }
        const api = options.api ?? appApi
        const engine = createSyncEngine({
            db,
            api,
            accountId,
            timer: options.timer,
            connectivity: options.connectivity ?? browserConnectivity,
        })
        const connectivity = options.connectivity ?? browserConnectivity
        const socketOptions = options.socket ?? {}
        const socket = createSocket({
            url: socketOptions.url ?? realtimeUrl(),
            WebSocketImpl: socketOptions.WebSocketImpl,
            timer: options.timer,
            connectivity,
            visibility: socketOptions.visibility ?? browserVisibility,
            random: socketOptions.random,
            backoff: socketOptions.backoff,
            helloTimeoutMs: socketOptions.helloTimeoutMs,
            onEvent: (frame) => void engine.applyRemote(frame),
            onOpen: ({ first }) => {
                // Delivery is best-effort and there is no replay: whatever was
                // missed while the socket was down is only found by listing
                // again. The first `hello` is the exception when the first
                // hydration has not finished - it is that list. (One that
                // finished before the socket was live may have missed
                // something in between, so that one lists again.)
                const { hydration } = engine.status()
                if (first && (hydration === 'idle' || hydration === 'running')) return
                void engine.hydrate()
            },
            onStateChange: (connection) => {
                setState((draft) => {
                    draft.connection = connection
                })
                flush()
            },
        })
        const started: Running = { accountId, db, engine, socket, api, off: () => {} }
        started.off = engine.subscribe((change) => {
            // A 401 anywhere (a send, a list) parks the engine; a socket opened
            // now would be refused too. `resume()` brings it back.
            socket.setPaused(engine.status().paused)
            void refresh(started, change)
        })
        current = started

        const projectId = (await db.getMeta<string>(META_PROJECT)) ?? null
        setState((draft) => {
            draft.active = true
            draft.projectId = projectId
        })
        // What is already on disk is shown before the server is asked.
        await refresh(started, {})
        engine.start()
        // After the engine, so the first `hello` can tell whether the first
        // hydration is still going.
        socket.start()
    })
}

/** Stops syncing and empties the reactive store. The database is left as it
 *  is: an expired session is not a reason to throw away unsent work. */
export function stopSync(): Promise<void> {
    return inOrder(halt)
}

/** Stops syncing and empties the local database. For logout: the next person
 *  to use this browser must find nothing of the last one's. */
export function wipeLocalData(dbName: string = DB_NAME): Promise<void> {
    return inOrder(async () => {
        await halt()
        const db = await openSyncDb(dbName)
        try {
            await db.clear()
        } finally {
            db.close()
        }
    })
}

// ── reads ───────────────────────────────────────────────────────────────────

/** Nothing to show yet and no answer yet: the screens draw their skeletons for
 *  this. False as soon as the database has been read and holds anything, so a
 *  warm reload shows its data without waiting for the server - keep it that
 *  way, a skeleton over data already on disk is a flash. */
export function isLoading(): boolean {
    if (!state.active || !state.loaded) return true
    return state.projects.length === 0 && !state.hydrated && state.hydration !== 'failed'
}

/** Nothing on disk and the server could not be reached. */
export function loadFailed(): boolean {
    return state.loaded && state.projects.length === 0 && !state.hydrated && state.hydration === 'failed'
}

/** The server has answered and this account has no project at all. */
export function needsSetup(): boolean {
    return state.loaded && state.hydrated && state.projects.length === 0
}

/** The picked project, or the first by name when nothing (valid) is picked. */
export function currentProject(): Project | null {
    const picked = state.projects.find((project) => project.id === state.projectId)
    if (picked) return picked
    return state.projects.toSorted((a, b) => a.name.localeCompare(b.name))[0] ?? null
}

export async function selectProject(projectId: string): Promise<void> {
    setState((draft) => {
        draft.projectId = projectId
    })
    flush()
    await current?.db.setMeta(META_PROJECT, projectId)
}

/** The id to use now for a ticket that may have been created under a
 *  temporary one. Any other id comes back unchanged. */
export function resolveTicketId(id: string): string {
    return state.aliases[id] ?? id
}

export function ticketById(id: string): Ticket | undefined {
    const resolved = resolveTicketId(id)
    return state.tickets.find((ticket) => ticket.id === resolved)
}

/** The statuses of the project's team, in board order. */
export function statusesForProject(projectId: string): Status[] {
    const project = state.projects.find((candidate) => candidate.id === projectId)
    if (!project) return []
    return state.statuses
        .filter((status) => status.team_id === project.team_id)
        .toSorted((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

// One pass over the outbox instead of one per row. The first entry seen for a
// ticket is the head of its queue, and the head is the one that decides: it is
// the only one that can be parked.
const queueHeads = createRoot(() =>
    createMemo(() => {
        const heads = new Map<string, OutboxEntry>()
        for (const entry of state.outbox) {
            if (!heads.has(entry.ticket_id)) heads.set(entry.ticket_id, entry)
        }
        return heads
    }),
)

/** `synced` when nothing is waiting for this ticket, otherwise why it waits. */
export function ticketSyncState(id: string): TicketSyncState {
    return queueHeads().get(resolveTicketId(id))?.state ?? 'synced'
}

/** The entry at the head of this ticket's queue - the one that is waiting,
 *  failing or parked - or undefined when the ticket is in sync. Its `error`
 *  says what the last attempt got; its `payload` is what the user asked for. */
export function ticketHead(id: string): OutboxEntry | undefined {
    return queueHeads().get(resolveTicketId(id))
}

/** True for a ticket whose archive the server refused or collided with. The row
 *  is kept for it (see `rebuild` in the engine) so that its page can say so;
 *  this is what tells a list that such a row is not an ordinary one. */
export function archiveOnHold(id: string): boolean {
    const head = queueHeads().get(resolveTicketId(id))
    return head?.kind === 'archive' && (head.state === 'conflict' || head.state === 'failed')
}

/** How many changes have not reached the server: one per outbox entry. */
export function unsyncedCount(): number {
    return state.outbox.length
}

/** Entries that will not go anywhere on their own: failed, conflict,
 *  unauthorized. Oldest first. */
export function parkedEntries(): OutboxEntry[] {
    return state.outbox.filter((entry) => entry.state !== 'pending')
}

// ── writes ──────────────────────────────────────────────────────────────────
// Each resolves once the database AND this store show the change.

export async function createTicket(ticket: NewTicket): Promise<Ticket> {
    const created = await running().engine.createTicket(ticket)
    await caughtUp()
    return created
}

export async function updateTicket(id: string, patch: Partial<TicketFields>): Promise<boolean> {
    const found = await running().engine.updateTicket(resolveTicketId(id), patch)
    await caughtUp()
    return found
}

export async function archiveTicket(id: string): Promise<boolean> {
    const found = await running().engine.archiveTicket(resolveTicketId(id))
    await caughtUp()
    return found
}

export async function retry(entryId: number): Promise<boolean> {
    const found = await running().engine.retry(entryId)
    await caughtUp()
    return found
}

export async function discard(entryId: number): Promise<boolean> {
    const found = await running().engine.discard(entryId)
    await caughtUp()
    return found
}

/** Resolves a conflicted edit by keeping the user's version as a new ticket in
 *  the same project and dropping the original change (as `discard`). Resolves
 *  with the new ticket's id, to navigate to; null if nothing could be done. */
export async function keepAsNew(entryId: number): Promise<string | null> {
    const id = await running().engine.keepAsNew(entryId)
    await caughtUp()
    return id
}

export async function resume(): Promise<void> {
    await running().engine.resume()
    await caughtUp()
}

/** After a 401 the user signed in as the SAME account: un-parks what waited for
 *  it. Does nothing if the engine now running belongs to someone else - the old
 *  account's entries must never be sent under a new session - so it is safe to
 *  call without knowing whether the account changed. */
export function resumeFor(accountId: string): Promise<void> {
    return inOrder(async () => {
        if (current?.accountId !== accountId) return
        await current.engine.resume()
        await caughtUp()
    })
}

/** Skips every backoff and tries the network now. */
export function retryNow(): void {
    current?.engine.retryNow()
}

/** Asks the server for everything again. Resolves true if it was applied. */
export async function rehydrate(): Promise<boolean> {
    const applied = await running().engine.hydrate()
    await caughtUp()
    return applied
}

// ── first-run setup ─────────────────────────────────────────────────────────
// Not outbox mutations: a team and a project are needed before there is
// anything to work on offline, so these go straight to the API and throw an
// `ApiProblem` when it says no. The lists are then read back from the server,
// which is also how the new team's seeded statuses arrive.

// The direct calls cannot park anything the way the engine does, but a 401 on
// one of them means the same thing as on a send, and the session banner is
// how the user hears it. Whoever ties sync to the session registers here.
const unauthorizedListeners = new Set<() => void>()

/** Calls `fn` whenever a direct (non-outbox) call is answered 401. Returns the
 *  function that unregisters it. */
export function onUnauthorized(fn: () => void): () => void {
    unauthorizedListeners.add(fn)
    return () => {
        unauthorizedListeners.delete(fn)
    }
}

function directFailure(response: Response, error: unknown): never {
    if (classify(response) === 'unauthorized') {
        for (const listener of unauthorizedListeners) listener()
    }
    throw toProblem(response, error)
}

export async function createTeam(workspaceId: string, name: string): Promise<Team> {
    const active = running()
    const { data, error, response } = await active.api.POST('/api/v1/teams', {
        body: { workspace_id: workspaceId, name, bare: false },
    })
    if (!data) directFailure(response, error)
    await rehydrate()
    return { id: data.id, workspace_id: data.workspace_id, name: data.name }
}

export async function createProject(teamId: string, name: string): Promise<Project> {
    const active = running()
    const { data, error, response } = await active.api.POST('/api/v1/projects', {
        body: { team_id: teamId, name, bare: false },
    })
    if (!data) directFailure(response, error)
    await rehydrate()
    await selectProject(data.id)
    return { id: data.id, team_id: data.team_id, name: data.name }
}
