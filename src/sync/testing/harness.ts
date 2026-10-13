import 'fake-indexeddb/auto'

import createClient from 'openapi-fetch'

import type { paths } from '@/api/schema'
import { ok } from '@/testing/fetch'

import { openSyncDb, type SyncDb } from '../db'
import { createSyncEngine, type Connectivity, type EngineDeps, type Timer } from '../engine'
import type { Ticket } from '../types'

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
    const connectivity: Connectivity = {
        isOnline: () => online,
        onOnline(fn) {
            listeners.add(fn)
            return () => listeners.delete(fn)
        },
    }
    return {
        connectivity,
        goOffline() {
            online = false
        },
        goOnline() {
            online = true
            for (const fn of listeners) fn()
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
        version: 1,
        updated_at: '2025-12-31T00:00:00Z',
        updated_by: 'acc-other',
        ...overrides,
    }
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

export const PROJECT = { id: 'p-1', team_id: 'team-1', name: 'Launch', board_id: null, columns: [] }

export function page(items: unknown[], next_cursor: string | null = null) {
    return ok({ items, next_cursor, has_more: next_cursor !== null })
}

/** The three list routes, answering with one team, one project and `tickets`. */
export function listRoutes(tickets: Ticket[] = []) {
    return {
        'POST /api/v1/teams/list': () => page([TEAM]),
        'POST /api/v1/projects/list': () => page([PROJECT]),
        'POST /api/v1/tickets/list': () => page(tickets),
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
