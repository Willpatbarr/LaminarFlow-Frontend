import {
    openDB,
    type DBSchema,
    type IDBPDatabase,
    type IDBPObjectStore,
    type IDBPTransaction,
    type StoreNames,
} from 'idb'

import {
    newIdempotencyKey,
    type Board,
    type Doc,
    type EntityName,
    type EntityRows,
    type NewOutboxEntry,
    type OutboxEntry,
    type Project,
    type Status,
    type Team,
    type Ticket,
} from './types'

/*
╔═ db.ts ═══════════════════════════════════════════════════════════════════════════════
║  sync · the IndexedDB database, and nothing that decides what goes in it
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      openSyncDb     open (and create, or upgrade) the database
║      SyncDb         read a snapshot, run a write transaction, key-value meta, clear
║      SyncTx         the tables as one write transaction sees them
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      engine.ts (all writes), store.ts (opens it, reads snapshots)
╚═══════════════════════════════════════════════════════════════════════════════════════
*/

// `tickets` is what the screen shows: the server's copy with the user's unsent
// edits on top. `server_tickets` is the server's copy alone. Keeping both is
// what lets a discarded edit put the row back, and lets a refresh from the
// server land without touching a row the user is still editing. Every entity
// the engine carries has such a pair (`documents` / `server_documents`, ...),
// named in `ENTITY_STORES`; the outbox is one table for all of them.
interface Schema extends DBSchema {
    meta: { key: string; value: unknown }
    teams: { key: string; value: Team }
    projects: { key: string; value: Project }
    statuses: { key: string; value: Status }
    tickets: { key: string; value: Ticket }
    server_tickets: { key: string; value: Ticket }
    documents: { key: string; value: Doc }
    server_documents: { key: string; value: Doc }
    server_statuses: { key: string; value: Status }
    boards: { key: string; value: Board }
    server_boards: { key: string; value: Board }
    outbox: { key: number; value: OutboxEntry; indexes: { entity_id: string } }
}

/** The two tables each entity keeps: what the screen shows, and the server's copy. */
const ENTITY_STORES = {
    ticket: { rows: 'tickets', server: 'server_tickets' },
    document: { rows: 'documents', server: 'server_documents' },
    status: { rows: 'statuses', server: 'server_statuses' },
    board: { rows: 'boards', server: 'server_boards' },
} as const satisfies Record<EntityName, { rows: keyof Schema; server: keyof Schema }>

const STORES = [
    'meta',
    'teams',
    'projects',
    'statuses',
    'tickets',
    'server_tickets',
    'documents',
    'server_documents',
    'server_statuses',
    'boards',
    'server_boards',
    'outbox',
] as const satisfies StoreNames<Schema>[]

type WriteTx = IDBPTransaction<Schema, typeof STORES, 'readwrite'>

type RowStore =
    | 'teams'
    | 'projects'
    | 'statuses'
    | 'tickets'
    | 'server_tickets'
    | 'documents'
    | 'server_documents'
    | 'server_statuses'
    | 'boards'
    | 'server_boards'

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
    /** One entity's entries, oldest first. Ids are unique across entities, so
     *  the id alone names the queue. */
    forEntity(entityId: string): Promise<OutboxEntry[]>
    add(entry: NewOutboxEntry): Promise<OutboxEntry>
    put(entry: OutboxEntry): Promise<void>
    delete(id: number): Promise<void>
}

export type SyncTx = {
    teams: Table<Team>
    projects: Table<Project>
    statuses: Table<Status>
    serverStatuses: Table<Status>
    tickets: Table<Ticket>
    serverTickets: Table<Ticket>
    documents: Table<Doc>
    serverDocuments: Table<Doc>
    boards: Table<Board>
    serverBoards: Table<Board>
    /** The pair of tables of one entity, for code that works on any of them. */
    entity<N extends EntityName>(name: N): EntityTables<EntityRows[N]>
    outbox: OutboxTable
}

export type EntityTables<Row> = {
    /** What the screen shows: the server's copy with unsent changes on top. */
    rows: Table<Row>
    /** The server's copy alone. */
    server: Table<Row>
}

export type Snapshot = {
    teams: Team[]
    projects: Project[]
    statuses: Status[]
    tickets: Ticket[]
    documents: Doc[]
    boards: Board[]
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

// 1  the first schema.
// 2  a `create` entry carries the `idempotency_key` every attempt sends (LAM-76).
// 3  any entity goes through the outbox (LAM-125): an entry names its `entity`
//    and its `entity_id` (was `ticket_id`), and documents get their tables.
// 4  statuses are an entity too (LAM-95): `statuses` is what the screen shows
//    and `server_statuses` the server's copy. Rows already in `statuses` have
//    no `version`; the next hydration rewrites every one.
// 5  boards are an entity too (LAM-107): `boards` / `server_boards`. Tickets
//    gain `position`; the ones already on disk get 0 here and the next
//    hydration rewrites every one.
export const DB_VERSION = 5

export type OpenOptions = {
    /** Makes the key for a create entry found without one. */
    newKey?: () => string
}

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

type OldStore = IDBPObjectStore<Schema, StoreNames<Schema>[], 'outbox', 'versionchange'>

// Entries are read and rewritten as they were stored, which is not the shape
// the rest of this file types them as: that is the point of a migration.
type Stored = Record<string, unknown>

async function migrateKeys(store: OldStore, newKey: () => string) {
    for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
        const entry = cursor.value as unknown as Stored
        if (entry.kind === 'create' && !entry.idempotency_key) {
            await cursor.update({ ...entry, idempotency_key: newKey() } as unknown as OutboxEntry)
        }
    }
}

async function migrateEntities(store: OldStore) {
    for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
        const { ticket_id, ...rest } = cursor.value as unknown as Stored
        if (ticket_id === undefined) continue
        await cursor.update({ ...rest, entity: 'ticket', entity_id: ticket_id } as unknown as OutboxEntry)
    }
}

type AnyStore = { openCursor(): Promise<{ value: unknown; update(value: never): Promise<unknown>; continue(): Promise<any> } | null> }

async function migratePositions(store: AnyStore) {
    for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
        const ticket = cursor.value as Stored
        if (typeof ticket.position !== 'number') await cursor.update({ ...ticket, position: 0 } as never)
    }
}

function outboxTable(tx: WriteTx): OutboxTable {
    const store = tx.objectStore('outbox')
    return {
        get: (id) => store.get(id),
        // Keys are auto-incremented numbers and getAll returns in key order, so
        // both lists come back oldest first without sorting.
        all: () => store.getAll(),
        forEntity: (entityId) => store.index('entity_id').getAll(entityId),
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

export async function openSyncDb(
    name: string = DB_NAME,
    options: OpenOptions = {},
): Promise<SyncDb> {
    const newKey = options.newKey ?? newIdempotencyKey
    const db: IDBPDatabase<Schema> = await openDB<Schema>(name, DB_VERSION, {
        upgrade(upgrading, oldVersion, _newVersion, transaction) {
            if (oldVersion < 1) {
                upgrading.createObjectStore('meta')
                upgrading.createObjectStore('teams', { keyPath: 'id' })
                upgrading.createObjectStore('projects', { keyPath: 'id' })
                upgrading.createObjectStore('statuses', { keyPath: 'id' })
                upgrading.createObjectStore('tickets', { keyPath: 'id' })
                upgrading.createObjectStore('server_tickets', { keyPath: 'id' })
                upgrading
                    .createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
                    .createIndex('ticket_id' as 'entity_id', 'ticket_id')
            }
            if (oldVersion < 3) {
                upgrading.createObjectStore('documents', { keyPath: 'id' })
                upgrading.createObjectStore('server_documents', { keyPath: 'id' })
                // The queue is keyed by entity now. Every entry already stored
                // is a ticket's. The index is replaced before the entries are
                // rewritten, and rewriting them is what puts them in it.
                const outbox = transaction.objectStore('outbox')
                outbox.deleteIndex('ticket_id' as 'entity_id')
                outbox.createIndex('entity_id', 'entity_id')
            }
            if (oldVersion < 4) upgrading.createObjectStore('server_statuses', { keyPath: 'id' })
            if (oldVersion < 5) {
                upgrading.createObjectStore('boards', { keyPath: 'id' })
                upgrading.createObjectStore('server_boards', { keyPath: 'id' })
            }
            // One chain, one step after another: each step is a cursor over the
            // same store and they must not interleave.
            const steps: ((store: OldStore) => Promise<void>)[] = []
            if (oldVersion >= 1 && oldVersion < 2) {
                // Creates queued before keys existed get one here, in the
                // upgrade transaction, so no entry is ever read without one.
                // One that had already been sent and lost its answer cannot be
                // deduplicated against that earlier attempt (it carried no
                // key); that is the one duplicate this cannot prevent.
                steps.push((store) => migrateKeys(store, newKey))
            }
            if (oldVersion >= 1 && oldVersion < 3) steps.push(migrateEntities)
            if (oldVersion >= 1 && oldVersion < 5) {
                steps.push((_outbox) => migratePositions(transaction.objectStore('tickets')))
                steps.push((_outbox) => migratePositions(transaction.objectStore('server_tickets')))
            }
            if (steps.length > 0) {
                const store = transaction.objectStore('outbox')
                steps
                    .reduce((done, step) => done.then(() => step(store)), Promise.resolve())
                    .catch(() => transaction.abort())
            }
        },
    })

    return {
        async snapshot() {
            const tx = db.transaction(['teams', 'projects', 'statuses', 'tickets', 'documents', 'boards', 'outbox'])
            const [teams, projects, statuses, tickets, documents, boards, outbox] = await Promise.all([
                tx.objectStore('teams').getAll(),
                tx.objectStore('projects').getAll(),
                tx.objectStore('statuses').getAll(),
                tx.objectStore('tickets').getAll(),
                tx.objectStore('documents').getAll(),
                tx.objectStore('boards').getAll(),
                tx.objectStore('outbox').getAll(),
            ])
            await tx.done
            return { teams, projects, statuses, tickets, documents, boards, outbox }
        },

        async write(fn) {
            const tx = db.transaction(STORES, 'readwrite')
            try {
                const result = await fn({
                    teams: table(tx, 'teams'),
                    projects: table(tx, 'projects'),
                    statuses: table(tx, 'statuses'),
                    serverStatuses: table(tx, 'server_statuses'),
                    tickets: table(tx, 'tickets'),
                    serverTickets: table(tx, 'server_tickets'),
                    documents: table(tx, 'documents'),
                    serverDocuments: table(tx, 'server_documents'),
                    boards: table(tx, 'boards'),
                    serverBoards: table(tx, 'server_boards'),
                    entity: (name) => {
                        const stores = ENTITY_STORES[name]
                        return { rows: table(tx, stores.rows), server: table(tx, stores.server) } as never
                    },
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
