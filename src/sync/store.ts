import { createMemo, createRoot, createStore, flush, reconcile } from 'solid-js'

import { api as appApi } from '@/api/client'
import { classify } from '@/api/errors'
import { toProblem } from '@/api/problem'

import { DB_NAME, openSyncDb, type SyncDb } from './db'
import { sortStatuses } from './entities/status'
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
    Board,
    BoardEntry,
    BoardFields,
    Doc,
    DocFields,
    Epic,
    Label,
    LabelEntry,
    LabelFields,
    Milestone,
    MilestoneEntry,
    MilestoneFields,
    Sprint,
    SprintEntry,
    SprintFields,
    EntityCreates,
    EpicEntry,
    EpicFields,
    NewDoc,
    NewStatus,
    NewTicket,
    OutboxEntry,
    Project,
    SavedView,
    SavedViewEntry,
    SavedViewFields,
    NewSavedView,
    Status,
    StatusEntry,
    StatusFields,
    Team,
    Ticket,
    TicketEntry,
    DocEntry,
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
║      createTicket, updateTicket, archiveTicket, unarchiveTicket   the only way a screen changes a ticket
║      createStatus, updateStatus, deleteStatus, statusesForTeam, statusHead   the same, for statuses (LAM-95)
║      createLabel, updateLabel, deleteLabel, labelsForTeam, labelHead   the same, for labels (LAM-104)
║      createEpic/Sprint/Milestone, update…, delete…, epicById, sprintById, milestoneById, epicHead…   write and read them (LAM-105)
║      epicsForProject, sprintsForProject, milestonesForProject, labelsForProject   what a ticket can be filed under (LAM-103)
║      savedViewById, savedViewsForTeam, canEditSavedView, savedViewHead,
║      createSavedView, updateSavedView, deleteSavedView   saved list and board views (LAM-118)
║      boardById, boardsForProject, boardHead, updateBoard   boards and their columns (LAM-107)
║      documentById, documentSyncState, documentHead, createDocument, updateDocument,
║      archiveDocument, unarchiveDocument           the same, for documents (LAM-125)
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
    boards: Board[]
    /** The things a ticket is filed under (LAM-103). Read-only here. */
    epics: Epic[]
    sprints: Sprint[]
    milestones: Milestone[]
    labels: Label[]
    /** The account's own private views and its teams' shared ones (LAM-118). */
    savedViews: SavedView[]
    /** Every ticket, as the user should see it: unsent edits included. */
    tickets: Ticket[]
    /** Every document, as the user should see it: unsent edits included. */
    documents: Doc[]
    /** Oldest first. Empty means everything has reached the server. */
    outbox: OutboxEntry[]
    /** The project the user last picked, if it still exists. */
    projectId: string | null
    /** Temporary id -> the id the server gave that ticket or document, for this session. */
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
        boards: [],
        epics: [],
        sprints: [],
        milestones: [],
        labels: [],
        savedViews: [],
        tickets: [],
        documents: [],
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
            const row =
                draft.tickets.find((ticket) => ticket.id === from) ??
                draft.documents.find((document) => document.id === from)
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
            reconcile(snapshot.boards, 'id')(draft.boards)
            reconcile(snapshot.epics, 'id')(draft.epics)
            reconcile(snapshot.sprints, 'id')(draft.sprints)
            reconcile(snapshot.milestones, 'id')(draft.milestones)
            reconcile(snapshot.labels, 'id')(draft.labels)
            reconcile(snapshot.savedViews, 'id')(draft.savedViews)
            reconcile(snapshot.tickets, 'id')(draft.tickets)
            reconcile(snapshot.documents, 'id')(draft.documents)
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

/** The id to use now for a ticket or document that may have been created under
 *  a temporary one. Any other id comes back unchanged. */
export function resolveId(id: string): string {
    return state.aliases[id] ?? id
}

export const resolveTicketId = resolveId

export function documentById(id: string): Doc | undefined {
    const resolved = resolveId(id)
    return state.documents.find((document) => document.id === resolved)
}

export function ticketById(id: string): Ticket | undefined {
    const resolved = resolveTicketId(id)
    return state.tickets.find((ticket) => ticket.id === resolved)
}

/** The statuses of the project's team, in board order. */
export function statusesForProject(projectId: string): Status[] {
    const project = state.projects.find((candidate) => candidate.id === projectId)
    if (!project) return []
    return statusesForTeam(project.team_id)
}

/** The board with this id, as the screen should show it. */
export function boardById(id: string): Board | undefined {
    return state.boards.find((board) => board.id === id)
}

/** A project's boards, oldest first (the API's order, and so the default board first). */
export function boardsForProject(projectId: string): Board[] {
    return state.boards.filter((board) => board.project_id === projectId)
}

const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** A project's epics, by name: for the epic picker. */
export function epicsForProject(projectId: string): Epic[] {
    return state.epics.filter((epic) => epic.project_id === projectId).toSorted(byName)
}

/** A project's sprints, by name. */
export function sprintsForProject(projectId: string): Sprint[] {
    return state.sprints.filter((sprint) => sprint.project_id === projectId).toSorted(byName)
}

/** A project's milestones, by name. */
export function milestonesForProject(projectId: string): Milestone[] {
    return state.milestones.filter((milestone) => milestone.project_id === projectId).toSorted(byName)
}

/** The labels of the project's team, by name. */
export function labelsForProject(projectId: string): Label[] {
    const project = state.projects.find((candidate) => candidate.id === projectId)
    if (!project) return []
    return state.labels.filter((label) => label.team_id === project.team_id).toSorted(byName)
}

/** One epic, sprint or milestone by id (a temporary id works until the server
 *  answers and for as long after). */
export function epicById(id: string): Epic | undefined {
    const resolved = resolveId(id)
    return state.epics.find((epic) => epic.id === resolved)
}
export function sprintById(id: string): Sprint | undefined {
    const resolved = resolveId(id)
    return state.sprints.find((sprint) => sprint.id === resolved)
}
export function milestoneById(id: string): Milestone | undefined {
    const resolved = resolveId(id)
    return state.milestones.find((milestone) => milestone.id === resolved)
}

/** A team's labels, by name: for the settings list. */
export function labelsForTeam(teamId: string): Label[] {
    return state.labels.filter((label) => label.team_id === teamId).toSorted(byName)
}

/** The saved view with this id (a temporary one included), as the screen should show it. */
export function savedViewById(id: string): SavedView | undefined {
    const resolved = resolveId(id)
    return state.savedViews.find((view) => view.id === resolved)
}

/** A team's saved views, by name: the sidebar's list. The server already left
 *  out other people's private ones. */
export function savedViewsForTeam(teamId: string): SavedView[] {
    return state.savedViews.filter((view) => view.team_id === teamId).toSorted(byName)
}

/** Whether `accountId` may rename, re-save or delete the view: its owner, or
 *  anybody on the team for a view with no owner. */
export function canEditSavedView(view: SavedView, accountId: string): boolean {
    return view.owner_account_id === null || view.owner_account_id === accountId
}

/** A team's statuses, in board order. */
export function statusesForTeam(teamId: string): Status[] {
    return sortStatuses(state.statuses.filter((status) => status.team_id === teamId))
}

// One pass over the outbox instead of one per row. The first entry seen for an
// entity is the head of its queue, and the head is the one that decides: it is
// the only one that can be parked. Ids are unique across entities, so one map
// serves them all.
const queueHeads = createRoot(() =>
    createMemo(() => {
        const heads = new Map<string, OutboxEntry>()
        for (const entry of state.outbox) {
            if (!heads.has(entry.entity_id)) heads.set(entry.entity_id, entry)
        }
        return heads
    }),
)

/** `synced` when nothing is waiting for this ticket, otherwise why it waits. */
export function ticketSyncState(id: string): TicketSyncState {
    return ticketHead(id)?.state ?? 'synced'
}

/** The entry at the head of this ticket's queue - the one that is waiting,
 *  failing or parked - or undefined when the ticket is in sync. Its `error`
 *  says what the last attempt got; its `payload` is what the user asked for. */
export function ticketHead(id: string): TicketEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'ticket' ? head : undefined
}

/** The entry at the head of this status's queue, or undefined when it is in
 *  sync. A failed or parked one carries the server's reason in `error`. */
export function statusHead(id: string): StatusEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'status' ? head : undefined
}

/** The entry at the head of this label's queue, or undefined when it is in
 *  sync. A failed one carries the server's reason in `error`. */
export function labelHead(id: string): LabelEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'label' ? head : undefined
}

/** The entry at the head of this epic's, sprint's or milestone's queue, or
 *  undefined when it is in sync. A failed one carries the server's reason. */
export function epicHead(id: string): EpicEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'epic' ? head : undefined
}
export function sprintHead(id: string): SprintEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'sprint' ? head : undefined
}
export function milestoneHead(id: string): MilestoneEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'milestone' ? head : undefined
}

/** The entry at the head of this saved view's queue, or undefined when it is in
 *  sync. A failed one carries the server's reason in `error`. */
export function savedViewHead(id: string): SavedViewEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'saved_view' ? head : undefined
}

/** The entry at the head of this board's queue, or undefined when it is in sync. */
export function boardHead(id: string): BoardEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'board' ? head : undefined
}

/** `synced` when nothing is waiting for this document, otherwise why it waits. */
export function documentSyncState(id: string): TicketSyncState {
    return documentHead(id)?.state ?? 'synced'
}

/** The entry at the head of this document's queue, or undefined when it is in
 *  sync. As `ticketHead`. */
export function documentHead(id: string): DocEntry | undefined {
    const head = queueHeads().get(resolveId(id))
    return head?.entity === 'document' ? head : undefined
}

/** True for a ticket whose archive the server refused or collided with. The row
 *  is kept for it (see `rebuild` in the engine) so that its page can say so;
 *  this is what tells a list that such a row is not an ordinary one. */
export function archiveOnHold(id: string): boolean {
    const head = ticketHead(id)
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

// A row read from the store holds arrays (`label_ids`, `sprint_ids`) that are
// reactive proxies, which IndexedDB cannot clone. Whatever a screen hands to a
// write is copied to plain data first.
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

// An epic, sprint, milestone or label made a moment ago is named by a temporary
// id until the server answers, and the caller may be holding that id after the
// swap. Naming the real one keeps the ticket from waiting for ever on an id that
// no longer exists.
function filedUnder<T extends Partial<Pick<TicketFields, 'epic_id' | 'milestone_id' | 'label_ids' | 'sprint_ids'>>>(fields: T): T {
    const out = { ...fields }
    if (out.epic_id) out.epic_id = resolveId(out.epic_id)
    if (out.milestone_id) out.milestone_id = resolveId(out.milestone_id)
    if (out.label_ids) out.label_ids = out.label_ids.map(resolveId)
    if (out.sprint_ids) out.sprint_ids = out.sprint_ids.map(resolveId)
    return out
}

export async function createTicket(ticket: NewTicket): Promise<Ticket> {
    const created = await running().engine.createTicket(filedUnder(plain(ticket)))
    await caughtUp()
    return created
}

export async function updateTicket(id: string, patch: Partial<TicketFields>): Promise<boolean> {
    const found = await running().engine.updateTicket(resolveTicketId(id), filedUnder(plain(patch)))
    await caughtUp()
    return found
}

export async function archiveTicket(id: string): Promise<boolean> {
    const found = await running().engine.archiveTicket(resolveTicketId(id))
    await caughtUp()
    return found
}

/** Undoes an archive. Pass the ticket as it was before it was archived. Resolves
 *  with the ticket's id (new, if the archive had withdrawn an unsent create),
 *  or null when there was nothing to undo. */
export async function unarchiveTicket(ticket: Ticket): Promise<string | null> {
    const id = await running().engine.unarchiveTicket(plain({ ...ticket, id: resolveTicketId(ticket.id) }))
    await caughtUp()
    return id
}

/** Makes a label. Resolves with the row under its temporary id, which a ticket
 *  can be given at once: the engine sends the label first and swaps the id. */
export async function createLabel(label: { team_id: string } & LabelFields): Promise<Label> {
    const created = await running().engine.createLabel(label)
    await caughtUp()
    return created
}

export async function updateLabel(id: string, patch: Partial<LabelFields>): Promise<boolean> {
    const found = await running().engine.updateLabel(resolveId(id), patch)
    await caughtUp()
    return found
}

/** Deletes a label. It leaves every ticket that had it. */
export async function deleteLabel(id: string): Promise<boolean> {
    const found = await running().engine.deleteLabel(resolveId(id))
    await caughtUp()
    return found
}

/** Makes an epic. Resolves with the row under its temporary id, which a ticket
 *  can be given at once: the engine sends the epic first and swaps the id. */
export async function createEpic(epic: EntityCreates['epic']): Promise<Epic> {
    const created = await running().engine.createEpic(epic)
    await caughtUp()
    return created
}

export async function updateEpic(id: string, patch: Partial<EpicFields>): Promise<boolean> {
    const found = await running().engine.updateEpic(resolveId(id), patch)
    await caughtUp()
    return found
}

/** Deletes an epic. Its tickets stay, filed under nothing. */
export async function deleteEpic(id: string): Promise<boolean> {
    const found = await running().engine.deleteEpic(resolveId(id))
    await caughtUp()
    return found
}

/** Makes a sprint. Resolves with the row under its temporary id, which a ticket
 *  can be given at once: the engine sends the sprint first and swaps the id. */
export async function createSprint(sprint: EntityCreates['sprint']): Promise<Sprint> {
    const created = await running().engine.createSprint(sprint)
    await caughtUp()
    return created
}

export async function updateSprint(id: string, patch: Partial<SprintFields>): Promise<boolean> {
    const found = await running().engine.updateSprint(resolveId(id), patch)
    await caughtUp()
    return found
}

/** Deletes a sprint. Its tickets stay, filed under nothing. */
export async function deleteSprint(id: string): Promise<boolean> {
    const found = await running().engine.deleteSprint(resolveId(id))
    await caughtUp()
    return found
}

/** Makes a milestone. Resolves with the row under its temporary id, which a ticket
 *  can be given at once: the engine sends the milestone first and swaps the id. */
export async function createMilestone(milestone: EntityCreates['milestone']): Promise<Milestone> {
    const created = await running().engine.createMilestone(milestone)
    await caughtUp()
    return created
}

export async function updateMilestone(id: string, patch: Partial<MilestoneFields>): Promise<boolean> {
    const found = await running().engine.updateMilestone(resolveId(id), patch)
    await caughtUp()
    return found
}

/** Deletes a milestone. Its tickets stay, filed under nothing. */
export async function deleteMilestone(id: string): Promise<boolean> {
    const found = await running().engine.deleteMilestone(resolveId(id))
    await caughtUp()
    return found
}

/** Saves a view. Resolves with the row under its temporary id; the engine
 *  sends it and swaps the id. */
export async function createSavedView(view: NewSavedView): Promise<SavedView> {
    const created = await running().engine.create('saved_view', plain(view))
    await caughtUp()
    return created
}

export async function updateSavedView(id: string, patch: Partial<SavedViewFields>): Promise<boolean> {
    const found = await running().engine.update('saved_view', resolveId(id), plain(patch))
    await caughtUp()
    return found
}

export async function deleteSavedView(id: string): Promise<boolean> {
    const found = await running().engine.archive('saved_view', resolveId(id))
    await caughtUp()
    return found
}

export async function createStatus(status: NewStatus): Promise<Status> {
    const created = await running().engine.createStatus(status)
    await caughtUp()
    return created
}

export async function updateStatus(id: string, patch: Partial<StatusFields>): Promise<boolean> {
    const found = await running().engine.updateStatus(resolveId(id), patch)
    await caughtUp()
    return found
}

/** Deletes a status, moving the tickets that still use it to `moveTo` (a status
 *  of the same team). Pass null only when there is no other status. */
export async function deleteStatus(id: string, moveTo: string | null): Promise<boolean> {
    const found = await running().engine.deleteStatus(resolveId(id), moveTo === null ? null : resolveId(moveTo))
    await caughtUp()
    return found
}

/** Changes a board: its name, or its columns (a rename, hide or show, a new
 *  order, a new set of statuses). `patch.columns` replaces them all. */
export async function updateBoard(id: string, patch: Partial<BoardFields>): Promise<boolean> {
    // Plain copies: the columns usually come from the store, whose arrays are
    // proxies that IndexedDB cannot clone.
    const columns = patch.columns?.map((column) => ({
        id: column.id,
        name: column.name,
        position: column.position,
        is_visible: column.is_visible,
        status_ids: [...column.status_ids],
    }))
    const found = await running().engine.updateBoard(id, columns ? { ...patch, columns } : patch)
    await caughtUp()
    return found
}

export async function createDocument(document: NewDoc): Promise<Doc> {
    const created = await running().engine.createDocument(document)
    await caughtUp()
    return created
}

export async function updateDocument(id: string, patch: Partial<DocFields>): Promise<boolean> {
    const found = await running().engine.updateDocument(resolveId(id), patch)
    await caughtUp()
    return found
}

export async function archiveDocument(id: string): Promise<boolean> {
    const found = await running().engine.archiveDocument(resolveId(id))
    await caughtUp()
    return found
}

/** Undoes an archive. Pass the document as it was before it was archived. As
 *  `unarchiveTicket`. */
export async function unarchiveDocument(document: Doc): Promise<string | null> {
    const id = await running().engine.unarchiveDocument({ ...document, id: resolveId(document.id) })
    await caughtUp()
    return id
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
