import type { Client } from 'openapi-fetch'

import type { components, paths } from '@/api/schema'

import type { EntryError, OutboxEntry, Project, Status, Team, Ticket, TicketConflict } from './types'

/*
┌─ sync ──────────────────────────────────────────
│  the HTTP calls the engine makes, each reduced to an outcome it can switch on
├─ out ───────────────────────────────────────────
│      createRemote   send(entry) → Outcome, listEverything() → ServerState
│      SyncApi        the typed client it needs (src/api/client.ts in the app)
│      parseTicketEvent   one frame of the change feed → TicketEvent, or null
├─ example ───────────────────────────────────────
│      PUT answered 409 {code:"ticket_conflict", current:{…}}  →  { type: 'conflict', conflict }
*/

export type SyncApi = Client<paths>

export type Outcome =
    /** `ticket` is the server's copy; null after an archive, which has no body. */
    | { type: 'ok'; ticket: Ticket | null }
    /** No response at all: offline, DNS, a dropped connection. */
    | { type: 'network' }
    | { type: 'conflict'; conflict: TicketConflict }
    /** Any other non-2xx. The engine decides what each status means. */
    | { type: 'http'; error: EntryError }

export type ServerState = {
    teams: Team[]
    projects: Project[]
    statuses: Status[]
    tickets: Ticket[]
}

/** A list call that did not return a page. `status` 0 means no response. */
export class ListFailure extends Error {
    status: number
    constructor(status: number, code: string) {
        super(`could not list: ${status} ${code}`)
        this.name = 'ListFailure'
        this.status = status
    }
}

type TicketBody = components['schemas']['TicketBody']
type ProblemBody = Partial<components['schemas']['Error']>

function toTicket(body: TicketBody): Ticket {
    return {
        id: body.id,
        project_id: body.project_id,
        title: body.title,
        description: body.description,
        status_id: body.status_id,
        assignee_id: body.assignee_id,
        version: body.version,
        updated_at: body.updated_at,
        updated_by: body.updated_by,
    }
}

// The version exactly as the ETag carries it: the number in double quotes.
// Anything else (unquoted, weak, a list) is a 422 from the backend.
function ifMatch(version: number | null) {
    return version === null ? {} : { 'If-Match': `"${version}"` }
}

// The body is a string when the answer was not JSON at all (a proxy's 502
// page); the code then falls back to `unknown`, as `toProblem` does.
function toError(response: Response, body: unknown): EntryError {
    const problem: ProblemBody = typeof body === 'object' && body !== null ? body : {}
    return { status: response.status, code: problem.code ?? 'unknown', errors: problem.errors ?? [] }
}

// ── the change feed ─────────────────────────────────────────────────────────
// docs/realtime.md in the backend is the contract; the socket is not in the
// OpenAPI document, so these types are written out here.

export type TicketEventType =
    | 'ticket.created'
    | 'ticket.updated'
    | 'ticket.archived'
    | 'ticket.unarchived'

const EVENT_TYPES: readonly string[] = [
    'ticket.created',
    'ticket.updated',
    'ticket.archived',
    'ticket.unarchived',
]

export type TicketEvent = {
    type: TicketEventType
    /** The ticket after the change - the whole row, archive included. */
    ticket: Ticket
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isNullableString = (value: unknown): value is string | null => value === null || isString(value)

/** Reads one frame of the change feed. Null for anything that is not a ticket
 *  event this client understands: a type it has never heard of (the feed is
 *  additive within v1), a body missing a member, an `id` or `version` that
 *  disagrees with the ticket it carries. Never throws. */
export function parseTicketEvent(frame: unknown): TicketEvent | null {
    if (typeof frame !== 'object' || frame === null) return null
    const event = frame as Record<string, unknown>
    if (!isString(event.type) || !EVENT_TYPES.includes(event.type)) return null

    const body = event.ticket
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (
        !isString(row.id) ||
        !isString(row.project_id) ||
        !isString(row.title) ||
        !isString(row.description) ||
        !isNullableString(row.status_id) ||
        !isNullableString(row.assignee_id) ||
        !isString(row.updated_at) ||
        !isNullableString(row.updated_by) ||
        typeof row.version !== 'number' ||
        !Number.isInteger(row.version) ||
        row.version < 1
    ) {
        return null
    }
    // Both are documented to equal the ticket's own. If they do not, something
    // is wrong with the frame and a re-list will put it right.
    if (event.ticket_id !== row.id || event.version !== row.version) return null

    return {
        type: event.type as TicketEventType,
        ticket: toTicket(row as unknown as TicketBody),
    }
}

const PAGE = 200

type Page<Item> = { items: Item[] | null; next_cursor: string | null; has_more: boolean }

type PageResult<Item> = { data?: Page<Item>; error?: unknown; response: Response }

// Every list endpoint pages the same way, so one loop serves all three.
async function listAll<Item>(fetchPage: (cursor: string | undefined) => Promise<PageResult<Item>>) {
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

export function createRemote(api: SyncApi) {
    return {
        /** Everything this account can see, every page of it. Throws
         *  `ListFailure` if any page fails: half a list must never be mistaken
         *  for the whole one, because rows missing from it get removed. */
        async listEverything(): Promise<ServerState> {
            const teams = await listAll((cursor) =>
                api.POST('/api/v1/teams/list', { body: { limit: PAGE, cursor } }),
            )
            const projects = await listAll((cursor) =>
                api.POST('/api/v1/projects/list', { body: { limit: PAGE, cursor } }),
            )
            // Sorted on a field that never changes, so an edit made while the
            // pages are being read cannot move a ticket across a page boundary
            // and have it skipped.
            const tickets = await listAll((cursor) =>
                api.POST('/api/v1/tickets/list', {
                    body: { limit: PAGE, cursor, sort: [{ field: 'created_at', desc: false }] },
                }),
            )
            return {
                teams: teams.map((team) => ({
                    id: team.id,
                    workspace_id: team.workspace_id,
                    name: team.name,
                })),
                statuses: teams.flatMap((team) =>
                    (team.statuses ?? []).map((status) => ({
                        id: status.id,
                        team_id: team.id,
                        name: status.name,
                        color: status.color,
                        position: status.position,
                        category: status.category,
                    })),
                ),
                projects: projects.map((project) => ({
                    id: project.id,
                    team_id: project.team_id,
                    name: project.name,
                })),
                tickets: tickets.map(toTicket),
            }
        },

        /** Sends one outbox entry. Never throws: every way it can go is an Outcome. */
        async send(entry: OutboxEntry): Promise<Outcome> {
            let result: { data?: unknown; error?: unknown; response: Response }
            try {
                if (entry.kind === 'create') {
                    result = await api.POST('/api/v1/tickets', { body: entry.payload })
                } else if (entry.kind === 'update') {
                    result = await api.PUT('/api/v1/tickets/{id}', {
                        params: { path: { id: entry.ticket_id }, header: ifMatch(entry.base_version) },
                        body: entry.payload,
                    })
                } else {
                    result = await api.DELETE('/api/v1/tickets/{id}', {
                        params: { path: { id: entry.ticket_id }, header: ifMatch(entry.base_version) },
                    })
                }
            } catch {
                return { type: 'network' }
            }

            const { response } = result
            if (response.ok) {
                return { type: 'ok', ticket: result.data ? toTicket(result.data as TicketBody) : null }
            }
            const body = result.error as Partial<components['schemas']['TicketConflict']> | undefined
            if (response.status === 409 && body?.current && body.code) {
                return {
                    type: 'conflict',
                    conflict: {
                        code: body.code,
                        current: toTicket(body.current),
                        changed_by: body.changed_by ?? null,
                        changed_at: body.changed_at ?? body.current.updated_at,
                    },
                }
            }
            return { type: 'http', error: toError(response, result.error) }
        },
    }
}

export type Remote = ReturnType<typeof createRemote>
