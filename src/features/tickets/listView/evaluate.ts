import type { Epic, Milestone, Sprint, Status, Ticket } from '@/sync'

import { kindOf, type FilterCondition, type FilterGroup, type SortKey } from './config'

/*
┌─ tickets/listView ──────────────────────────────
│  evaluate: the filter language and sort run over the local store's tickets
├─ out ───────────────────────────────────────────
│      matches, sortTickets, Lookups
├─ example ───────────────────────────────────────
│      matches(ticket, { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-1'] }] })
*/
// The local-first half of "run the filter": the same LAM-58 conditions the
// server compiles to SQL, evaluated over the rows this device already holds, so
// the list answers at once and offline. The server run (serverRun.ts) then
// confirms it. They are meant to agree; where they cannot, this file says so:
//
//   - A field the local row does not carry (created_at) is treated as matching,
//     so the local pass never hides a ticket the server would show. The server
//     run narrows it.
//   - NULL behaves as in SQL: `neq` and `in` never match a ticket with no value
//     (use is_null for that), `contains` is a case-insensitive substring.

type Value = string | number | string[] | null | undefined

function valueOf(ticket: Ticket, field: string): Value {
    switch (field) {
        case 'title':
            return ticket.title
        case 'description':
            return ticket.description
        case 'project':
            return ticket.project_id
        case 'status':
            return ticket.status_id
        case 'assignee':
            return ticket.assignee_id
        case 'epic':
            return ticket.epic_id
        case 'milestone':
            return ticket.milestone_id
        case 'updated_at':
            return ticket.updated_at
        case 'version':
            return ticket.version
        case 'position':
            return ticket.position
        case 'label':
            return ticket.label_ids
        case 'sprint':
            return ticket.sprint_ids
        default:
            return undefined
    }
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value])

function compare(kind: string, a: string | number, b: unknown): number | null {
    if (kind === 'time') {
        const x = Date.parse(String(a))
        const y = Date.parse(String(b))
        return Number.isNaN(x) || Number.isNaN(y) ? null : x - y
    }
    if (kind === 'number') {
        const y = Number(b)
        return Number.isNaN(y) ? null : Number(a) - y
    }
    return a === b ? 0 : String(a) < String(b) ? -1 : 1
}

function test(ticket: Ticket, condition: FilterCondition): boolean {
    const kind = kindOf(condition.field)
    const value = valueOf(ticket, condition.field)
    if (!kind || value === undefined) return true

    if (kind === 'uuid_set') {
        const set = value as string[]
        switch (condition.op) {
            case 'is_null':
                return set.length === 0
            case 'is_not_null':
                return set.length > 0
            case 'neq':
                return !set.includes(String(condition.value))
            case 'eq':
                return set.includes(String(condition.value))
            case 'in':
                return asList(condition.value).some((v) => set.includes(String(v)))
            default:
                return false
        }
    }

    if (condition.op === 'is_null') return value === null
    if (condition.op === 'is_not_null') return value !== null
    if (value === null) return false
    const scalar = value as string | number

    switch (condition.op) {
        case 'contains':
            return String(scalar)
                .toLowerCase()
                .includes(String(condition.value ?? '').toLowerCase())
        case 'in':
            return asList(condition.value).some((v) => compare(kind, scalar, v) === 0)
        case 'eq':
            return compare(kind, scalar, condition.value) === 0
        case 'neq': {
            const result = compare(kind, scalar, condition.value)
            return result !== null && result !== 0
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
            const result = compare(kind, scalar, condition.value)
            if (result === null) return false
            return condition.op === 'gt'
                ? result > 0
                : condition.op === 'gte'
                  ? result >= 0
                  : condition.op === 'lt'
                    ? result < 0
                    : result <= 0
        }
        default:
            return false
    }
}

/** Whether the ticket satisfies the group. An empty group is no filter. */
export function matches(ticket: Ticket, group: FilterGroup | undefined): boolean {
    if (!group) return true
    const parts: boolean[] = [
        ...(group.conditions ?? []).map((condition) => test(ticket, condition)),
        ...(group.groups ?? []).map((inner) => matches(ticket, inner)),
    ]
    if (parts.length === 0) return true
    return group.op === 'or' ? parts.some(Boolean) : parts.every(Boolean)
}

/** The names the sort needs for fields that hold ids. */
export type Lookups = {
    statuses: Status[]
    epics: Epic[]
    milestones: Milestone[]
    sprints: Sprint[]
    labels: { id: string; name: string }[]
}

const byRecency = (a: Ticket, b: Ticket) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)

// What a ticket sorts by for one field. Null sorts last whichever way the key
// points, as on the server. Ids sort by the name a person sees, not the uuid:
// the server can only order by the uuid, which means nothing on screen, so this
// is the one place the local order is deliberately better than the server's.
function sortValue(ticket: Ticket, field: string, lookups: Lookups): string | number | null {
    const name = (rows: { id: string; name: string }[], id: string | null) =>
        id === null ? null : (rows.find((row) => row.id === id)?.name.toLowerCase() ?? id)
    switch (field) {
        case 'title':
            return ticket.title.toLowerCase()
        case 'status': {
            const status = lookups.statuses.find((s) => s.id === ticket.status_id)
            return status ? status.position : ticket.status_id ? Number.MAX_SAFE_INTEGER - 1 : null
        }
        case 'assignee':
            return ticket.assignee_id
        case 'epic':
            return name(lookups.epics, ticket.epic_id)
        case 'milestone':
            return name(lookups.milestones, ticket.milestone_id)
        case 'label':
        case 'sprint': {
            const ids = field === 'label' ? ticket.label_ids : ticket.sprint_ids
            const rows = field === 'label' ? lookups.labels : lookups.sprints
            return ids.length === 0
                ? null
                : ids
                      .map((id) => name(rows, id))
                      .toSorted()
                      .join(',')
        }
        case 'updated_at':
            return ticket.updated_at
        case 'position':
            return ticket.position
        default:
            return null
    }
}

function compareKey(a: Ticket, b: Ticket, key: SortKey, lookups: Lookups): number {
    const x = sortValue(a, key.field, lookups)
    const y = sortValue(b, key.field, lookups)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return key.desc ? -order : order
}

/** A sorted copy. No keys is the list's own order: newest change first. The id
 *  always breaks a tie, so the order never depends on how the rows arrived. */
export function sortTickets(tickets: Ticket[], sort: SortKey[] | undefined, lookups: Lookups): Ticket[] {
    if (!sort || sort.length === 0) return tickets.toSorted(byRecency)
    return tickets.toSorted((a, b) => {
        for (const key of sort) {
            const order = compareKey(a, b, key, lookups)
            if (order !== 0) return order
        }
        return a.id.localeCompare(b.id)
    })
}
