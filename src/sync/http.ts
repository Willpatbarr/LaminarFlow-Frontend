import type { Client } from 'openapi-fetch'

import { classify, classifyStatus, type FailureKind } from '@/api/errors'
import type { components, paths } from '@/api/schema'

import type { EntryError, EntryKind } from './types'

/*
┌─ sync ──────────────────────────────────────────
│  what every entity's HTTP calls share: paging, the outcome of a send, If-Match
├─ out ───────────────────────────────────────────
│      SyncApi, Outcome, ListFailure
│      listAll, answer, ifMatch, toError, parseEvent, isString, isNullableString
├─ example ───────────────────────────────────────
│      PUT answered 409 {code:"ticket_conflict", current:{…}}  →  { type: 'conflict', conflict }
*/

export type SyncApi = Client<paths>

/** The client for ONE hydration pass: a list asked twice in the pass (teams,
 *  projects and each project's sprints are read by several entities) goes to the
 *  server once and every asker gets the same answer. Nothing outlives the pass:
 *  the next pass asks again, so a rename or a removal still comes through
 *  (LAM-164, LAM-149). */
export function oncePerPass(api: SyncApi): SyncApi {
    const answers = new Map<string, Promise<unknown>>()
    const post = (path: string, init?: { body?: unknown }) => {
        const key = `${path} ${JSON.stringify(init?.body ?? null)}`
        let answer = answers.get(key)
        if (!answer) {
            answer = (api.POST as (path: string, init?: unknown) => Promise<unknown>)(path, init)
            answers.set(key, answer)
        }
        return answer
    }
    return new Proxy(api, { get: (target, name) => (name === 'POST' ? post : Reflect.get(target, name)) })
}

export type Outcome<Row, Conflict> =
    /** `row` is the server's copy; null after an archive, which has no body. */
    | { type: 'ok'; row: Row | null }
    /** No response at all: offline, DNS, a dropped connection. */
    | { type: 'network' }
    | { type: 'conflict'; conflict: Conflict }
    /** Any other non-2xx. The engine decides what each status means. */
    | { type: 'http'; error: EntryError }

/** A list call that did not return a page. `status` 0 means no response, and
 *  `kind` is what the engine switches on. */
export class ListFailure extends Error {
    status: number
    kind: FailureKind
    constructor(status: number, code: string) {
        super(`could not list: ${status} ${code}`)
        this.name = 'ListFailure'
        this.status = status
        this.kind = classifyStatus(status)
    }
}

type ProblemBody = Partial<components['schemas']['Error']>

// The version exactly as the ETag carries it: the number in double quotes.
// Anything else (unquoted, weak, a list) is a 422 from the backend.
export function ifMatch(version: number | null) {
    return version === null ? {} : { 'If-Match': `"${version}"` }
}

// The body is a string when the answer was not JSON at all (a proxy's 502
// page); the code then falls back to `unknown`, as `toProblem` does.
export function toError(response: Response, body: unknown): EntryError {
    const problem: ProblemBody = typeof body === 'object' && body !== null ? body : {}
    return { status: response.status, code: problem.code ?? 'unknown', errors: problem.errors ?? [] }
}

export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNullableString = (value: unknown): value is string | null => value === null || isString(value)

const PAGE = 200

type Page<Item> = { items: Item[] | null; next_cursor: string | null; has_more: boolean }

type PageResult<Item> = { data?: Page<Item>; error?: unknown; response: Response }

/** The page size every list asks for. */
export const PAGE_SIZE = PAGE

// Every list endpoint pages the same way, so one loop serves all of them.
export async function listAll<Item>(fetchPage: (cursor: string | undefined) => Promise<PageResult<Item>>) {
    const items: Item[] = []
    let cursor: string | undefined
    for (;;) {
        let page: PageResult<Item>
        try {
            page = await fetchPage(cursor)
        } catch {
            throw new ListFailure(0, 'network')
        }
        if (!page.data) throw new ListFailure(page.response.status, toError(page.response, page.error).code)
        items.push(...(page.data.items ?? []))
        // `has_more` without a cursor would loop on the first page forever.
        if (!page.data.has_more || !page.data.next_cursor) return items
        cursor = page.data.next_cursor
    }
}

type Raw = { data?: unknown; error?: unknown; response: Response }

/** How one entity reads the server's answers. */
export type Codec<Row, Conflict> = {
    /** A success body to a row. */
    row(body: never): Row
    /** The body of a 409 to a conflict, or null when it is not the entity's. */
    conflict(body: never): Conflict | null
}

/** Sends one entry through `call` and reduces every way it can go to an
 *  Outcome. Never throws. The wire, which differs per entity, is `call`; what
 *  an answer means, which does not, is here. */
export async function answer<Row extends { version: number }, Conflict>(
    entry: { kind: EntryKind; base_version: number | null; payload: unknown },
    call: () => Promise<Raw>,
    codec: Codec<Row, Conflict>,
): Promise<Outcome<Row, Conflict>> {
    let result: Raw
    try {
        result = await call()
    } catch {
        return { type: 'network' }
    }

    const { response } = result
    if (response.ok && entry.kind === 'unarchive') {
        // 204: the restored row is the one the entry carries, at the version
        // the ETag names (the archived version plus one when the header is
        // somehow absent).
        const restored = entry.payload as Row
        const etag = Number(/^(?:W\/)?"(\d+)"$/.exec(response.headers.get('ETag') ?? '')?.[1])
        const version = Number.isInteger(etag) && etag > 0 ? etag : (entry.base_version ?? restored.version) + 1
        return { type: 'ok', row: { ...restored, version } }
    }
    if (response.ok) {
        return { type: 'ok', row: result.data ? codec.row(result.data as never) : null }
    }
    if (classify(response) === 'conflict' && typeof result.error === 'object' && result.error !== null) {
        const conflict = codec.conflict(result.error as never)
        if (conflict) return { type: 'conflict', conflict }
    }
    return { type: 'http', error: toError(response, result.error) }
}

export type EventType = 'created' | 'updated' | 'archived' | 'unarchived'

/** One change-feed frame about one row of one entity. */
export type RemoteEvent<N extends string, Row> = {
    entity: N
    type: EventType
    /** The row after the change - the whole row, archive included. */
    row: Row
}

const EVENT_TYPES: readonly string[] = ['created', 'updated', 'archived', 'unarchived']

/** Reads one `<prefix>.<type>` frame whose whole row sits under `<prefix>`.
 *  `readRow` checks the row's own members. Null for anything else: another
 *  prefix, a type this client has never heard of (the feed is additive within
 *  v1), a body missing a member, an `<prefix>_id` or `version` that disagrees
 *  with the row it carries. Never throws. */
export function parseEvent<N extends string, Row extends { id: string; version: number }>(
    frame: Record<string, unknown>,
    entity: N,
    readRow: (row: Record<string, unknown>) => Row | null,
): RemoteEvent<N, Row> | null {
    if (!isString(frame.type) || !frame.type.startsWith(`${entity}.`)) return null
    const type = frame.type.slice(entity.length + 1)
    if (!EVENT_TYPES.includes(type)) return null

    const body = frame[entity]
    if (typeof body !== 'object' || body === null) return null
    const row = readRow(body as Record<string, unknown>)
    if (!row) return null
    // Both are documented to equal the row's own. If they do not, something is
    // wrong with the frame and a re-list will put it right.
    if (frame[`${entity}_id`] !== row.id || frame.version !== row.version) return null

    return { entity, type: type as EventType, row }
}
