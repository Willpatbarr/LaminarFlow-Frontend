import 'fake-indexeddb/auto'

import createClient from 'openapi-fetch'

import type { paths } from '@/api/schema'
import { ok } from '@/testing/fetch'

import { openSyncDb, type SyncDb } from '../db'
import { createSyncEngine, type Connectivity, type EngineDeps, type Timer } from '../engine'
import type { Visibility } from '../socket'
import type { Doc, Ticket } from '../types'

// Shared by the engine and store tests. Importing this file installs
// fake-indexeddb as the global `indexedDB`.

export const ME = 'acc-me'

/** A clock that only moves when the test says so. */
export function manualTimer(start = Date.parse('2026-01-01T00:00:00Z')) {
    let now = start
    let nextHandle = 1
    const pending = new Map<number, { at: number; fn: () => void }>()
    const timer: Timer = {
        now: () => now,
        set(fn, ms) {
            const handle = nextHandle++
            pending.set(handle, { at: now + ms, fn })
            return handle
        },
        clear(handle) {
            pending.delete(handle as number)
        },
    }
    return {
        timer,
        /** Moves the clock forward and fires whatever came due, in order. */
        advance(ms: number) {
            now += ms
            const due = [...pending].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)
            for (const [handle, t] of due) {
                pending.delete(handle)
                t.fn()
            }
        },
        /** How long until the next timer, or null when none is set. */
        nextDelay() {
            if (pending.size === 0) return null
            return Math.min(...[...pending.values()].map((t) => t.at)) - now
        },
    }
}

export function manualConnectivity(initiallyOnline = true) {
    let online = initiallyOnline
    const listeners = new Set<() => void>()
    const offlineListeners = new Set<() => void>()
    const connectivity: Connectivity = {
        isOnline: () => online,
        onOnline(fn) {
            listeners.add(fn)
            return () => listeners.delete(fn)
        },
        onOffline(fn) {
            offlineListeners.add(fn)
            return () => offlineListeners.delete(fn)
        },
    }
    return {
        connectivity,
        /** The browser's `offline` event: flips the status, then tells listeners. */
        goOffline() {
            online = false
            for (const fn of offlineListeners) fn()
        },
        goOnline() {
            online = true
            for (const fn of listeners) fn()
        },
    }
}

/** The tab coming back to the front, when the test says so. */
export function manualVisibility() {
    const listeners = new Set<() => void>()
    const visibility: Visibility = {
        onVisible(fn) {
            listeners.add(fn)
            return () => listeners.delete(fn)
        },
    }
    return {
        visibility,
        show() {
            for (const fn of listeners) fn()
        },
        /** How many listeners are still attached. */
        get listening() {
            return listeners.size
        },
    }
}

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: 't-1',
        project_id: 'p-1',
        title: 'Write the outbox',
        description: '',
        status_id: 's-todo',
        assignee_id: null,
        epic_id: null,
        milestone_id: null,
        label_ids: [],
        sprint_ids: [],
        position: 1024,
        version: 1,
        updated_at: '2025-12-31T00:00:00Z',
        updated_by: 'acc-other',
        ...overrides,
    }
}

export function doc(overrides: Partial<Doc> = {}): Doc {
    return {
        id: 'd-1',
        title: 'Design notes',
        type: 'normal',
        aspect_type_id: null,
        team_id: null,
        project_id: 'p-1',
        body: { content: 'Hello' },
        version: 1,
        created_at: '2025-12-30T00:00:00Z',
        updated_at: '2025-12-31T00:00:00Z',
        ...overrides,
    }
}

/** A document as the server sends it: `Doc` plus `archived_at`. */
export function docBody(overrides: Partial<Doc> & { archived_at?: string | null } = {}) {
    return { archived_at: null, ...doc(overrides), ...overrides }
}

export const TEAM = {
    id: 'team-1',
    workspace_id: 'ws-1',
    name: 'Core',
    aspect_types: [],
    statuses: [
        { id: 's-todo', name: 'To Do', color: '#94a3b8', position: 1, category: 'not_started' },
        { id: 's-doing', name: 'In Progress', color: '#3b82f6', position: 2, category: 'in_progress' },
        { id: 's-done', name: 'Done', color: '#22c55e', position: 3, category: 'done' },
    ],
}

/** The project's default board as the server sends it: one column per status. */
export const BOARD = {
    id: 'b-1',
    project_id: 'p-1',
    name: 'Launch board',
    group_by: 'status',
    columns: [
        { id: 'c-todo', board_id: 'b-1', name: 'To Do', position: 1, is_visible: true, status_ids: ['s-todo'] },
        { id: 'c-doing', board_id: 'b-1', name: 'In Progress', position: 2, is_visible: true, status_ids: ['s-doing'] },
        { id: 'c-done', board_id: 'b-1', name: 'Done', position: 3, is_visible: true, status_ids: ['s-done'] },
    ],
}

export const PROJECT = { id: 'p-1', team_id: 'team-1', name: 'Launch', board_id: null, columns: [] }

export function page(items: unknown[], next_cursor: string | null = null) {
    return ok({ items, next_cursor, has_more: next_cursor !== null })
}

/** The list routes, answering with one team, one project, `tickets`, `documents` and (none by default) `boards`, and the epics, sprints, milestones, labels and saved views in `hierarchy` (none by default). */
export function listRoutes(
    tickets: Ticket[] = [],
    documents: Doc[] = [],
    boards: unknown[] = [],
    hierarchy: { epics?: unknown[]; sprints?: unknown[]; milestones?: unknown[]; labels?: unknown[]; savedViews?: unknown[]; comments?: unknown[] } = {},
) {
    return {
        'POST /api/v1/epics/list': () => page(hierarchy.epics ?? []),
        'POST /api/v1/sprints/list': () => page(hierarchy.sprints ?? []),
        'POST /api/v1/milestones/list': () => page(hierarchy.milestones ?? []),
        'POST /api/v1/labels/list': () => page(hierarchy.labels ?? []),
        'POST /api/v1/saved-views/list': () => page(hierarchy.savedViews ?? []),
        'POST /api/v1/comments/list': () => page(hierarchy.comments ?? []),
        'POST /api/v1/boards/list': () => page(boards),
        'POST /api/v1/teams/list': () => page([TEAM]),
        'POST /api/v1/projects/list': () => page([PROJECT]),
        'POST /api/v1/tickets/list': () => page(tickets),
        'POST /api/v1/documents/list': () => page(documents.map((d) => docBody(d))),
    }
}

/** A response the test resolves when it chooses to. */
export function deferred<T = Response>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

let dbCount = 0

/** A fresh, empty database: each test gets its own name. */
export function freshDb(): Promise<SyncDb> {
    return openSyncDb(`test-${++dbCount}-${Math.random().toString(36).slice(2)}`)
}

// The same client the app uses, built the same way, so a test exercises the
// real request building and the stub answers at `fetch`.
export function testApi() {
    return createClient<paths>({
        baseUrl: location.origin,
        fetch: (request) => globalThis.fetch(request),
    })
}

export async function startEngine(overrides: Partial<EngineDeps> = {}) {
    const db = overrides.db ?? (await freshDb())
    const clock = manualTimer()
    const net = manualConnectivity()
    let ids = 0
    const engine = createSyncEngine({
        db,
        api: testApi(),
        accountId: ME,
        timer: clock.timer,
        connectivity: net.connectivity,
        newId: () => `tmp_${++ids}`,
        ...overrides,
    })
    engine.start()
    await engine.idle()
    return { engine, db, clock, net }
}
