import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'

import type { NewOutboxEntry, OutboxEntry, Project, Status, Team, Ticket } from './types'

/*
╔═ db.ts ═══════════════════════════════════════════════════════════════════════════════
║  sync · the IndexedDB database, and nothing that decides what goes in it
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      openSyncDb     open (and create) the database
║      SyncDb         read a snapshot, run a write transaction, key-value meta, clear
║      SyncTx         the tables as one write transaction sees them
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      engine.ts (all writes), store.ts (opens it, reads snapshots)
╚═══════════════════════════════════════════════════════════════════════════════════════
*/

// `tickets` is what the screen shows: the server's copy with the user's unsent
// edits on top. `server_tickets` is the server's copy alone. Keeping both is
// what lets a discarded edit put the row back, and lets a refresh from the
// server land without touching a row the user is still editing.
interface Schema extends DBSchema {
    meta: { key: string; value: unknown }
    teams: { key: string; value: Team }
    projects: { key: string; value: Project }
    statuses: { key: string; value: Status }
    tickets: { key: string; value: Ticket }
    server_tickets: { key: string; value: Ticket }
    outbox: { key: number; value: OutboxEntry; indexes: { ticket_id: string } }
}

const STORES = [
    'meta',
    'teams',
    'projects',
    'statuses',
    'tickets',
    'server_tickets',
    'outbox',
] as const satisfies StoreNames<Schema>[]

type WriteTx = IDBPTransaction<Schema, typeof STORES, 'readwrite'>

type RowStore = 'teams' | 'projects' | 'statuses' | 'tickets' | 'server_tickets'

export type Table<Row> = {
    get(id: string): Promise<Row | undefined>
    all(): Promise<Row[]>
    put(row: Row): Promise<void>
    delete(id: string): Promise<void>
    clear(): Promise<void>
}

export type OutboxTable = {
    get(id: number): Promise<OutboxEntry | undefined>
    /** Every entry, oldest first. */
    all(): Promise<OutboxEntry[]>
    /** One ticket's entries, oldest first. */
    forTicket(ticketId: string): Promise<OutboxEntry[]>
    add(entry: NewOutboxEntry): Promise<OutboxEntry>
    put(entry: OutboxEntry): Promise<void>
    delete(id: number): Promise<void>
}

export type SyncTx = {
    teams: Table<Team>
    projects: Table<Project>
    statuses: Table<Status>
    tickets: Table<Ticket>
    serverTickets: Table<Ticket>
    outbox: OutboxTable
}

export type Snapshot = {
    teams: Team[]
    projects: Project[]
    statuses: Status[]
    tickets: Ticket[]
    outbox: OutboxEntry[]
}

export type SyncDb = {
    /** Everything the screens read, from one consistent point in time. */
    snapshot(): Promise<Snapshot>
    /** Runs `fn` in ONE read-write transaction over every table: all of it
     *  lands or none does, and no other write interleaves. Inside `fn`, await
     *  only the transaction's own operations - IndexedDB commits a transaction
     *  the moment it is left idle, so awaiting anything else (a fetch, a
     *  timer) ends it early. */
    write<T>(fn: (tx: SyncTx) => Promise<T>): Promise<T>
    getMeta<T>(key: string): Promise<T | undefined>
    setMeta(key: string, value: unknown): Promise<void>
    /** Empties every table, meta included. The database itself stays open. */
    clear(): Promise<void>
    close(): void
}

export const DB_NAME = 'laminarflow'

function table<Name extends RowStore>(tx: WriteTx, name: Name): Table<Schema[Name]['value']> {
    const store = tx.objectStore(name)
    return {
        get: (id) => store.get(id),
        all: () => store.getAll(),
        put: async (row) => {
            await store.put(row)
        },
        delete: (id) => store.delete(id),
        clear: () => store.clear(),
    }
}

function outboxTable(tx: WriteTx): OutboxTable {
    const store = tx.objectStore('outbox')
    return {
        get: (id) => store.get(id),
        // Keys are auto-incremented numbers and getAll returns in key order, so
        // both lists come back oldest first without sorting.
        all: () => store.getAll(),
        forTicket: (ticketId) => store.index('ticket_id').getAll(ticketId),
        add: async (entry) => {
            // The key path is `id` and the store auto-increments, so the entry
            // is stored with the id IndexedDB hands back.
            const id = await store.add(entry as OutboxEntry)
            return { ...entry, id } as OutboxEntry
        },
        put: async (entry) => {
            await store.put(entry)
        },
        delete: (id) => store.delete(id),
    }
}

export async function openSyncDb(name: string = DB_NAME): Promise<SyncDb> {
    const db: IDBPDatabase<Schema> = await openDB<Schema>(name, 1, {
        upgrade(upgrading) {
            upgrading.createObjectStore('meta')
            upgrading.createObjectStore('teams', { keyPath: 'id' })
            upgrading.createObjectStore('projects', { keyPath: 'id' })
            upgrading.createObjectStore('statuses', { keyPath: 'id' })
            upgrading.createObjectStore('tickets', { keyPath: 'id' })
            upgrading.createObjectStore('server_tickets', { keyPath: 'id' })
            upgrading
                .createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
                .createIndex('ticket_id', 'ticket_id')
        },
    })

    return {
        async snapshot() {
            const tx = db.transaction(['teams', 'projects', 'statuses', 'tickets', 'outbox'])
            const [teams, projects, statuses, tickets, outbox] = await Promise.all([
                tx.objectStore('teams').getAll(),
                tx.objectStore('projects').getAll(),
                tx.objectStore('statuses').getAll(),
                tx.objectStore('tickets').getAll(),
                tx.objectStore('outbox').getAll(),
            ])
            await tx.done
            return { teams, projects, statuses, tickets, outbox }
        },

        async write(fn) {
            const tx = db.transaction(STORES, 'readwrite')
            try {
                const result = await fn({
                    teams: table(tx, 'teams'),
                    projects: table(tx, 'projects'),
                    statuses: table(tx, 'statuses'),
                    tickets: table(tx, 'tickets'),
                    serverTickets: table(tx, 'server_tickets'),
                    outbox: outboxTable(tx),
                })
                await tx.done
                return result
            } catch (error) {
                // A throw from `fn` must not leave half of it committed.
                try {
                    tx.abort()
                } catch {
                    // Already finished or aborted; nothing left to undo.
                }
                await tx.done.catch(() => {})
                throw error
            }
        },

        async getMeta<T>(key: string) {
            return (await db.get('meta', key)) as T | undefined
        },

        async setMeta(key, value) {
            await db.put('meta', value, key)
        },

        async clear() {
            const tx = db.transaction(STORES, 'readwrite')
            await Promise.all(STORES.map((store) => tx.objectStore(store).clear()))
            await tx.done
        },

        close() {
            db.close()
        },
    }
}
