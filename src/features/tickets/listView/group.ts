import type { Status, Ticket } from '@/sync'

import { memberName } from '@/features/members/members'

import type { Lookups } from './evaluate'

/*
┌─ tickets/listView ──────────────────────────────
│  buildGroups: tickets split by the config's `group` field
├─ out ───────────────────────────────────────────
│      TicketGroup, buildGroups, UNGROUPED
├─ example ───────────────────────────────────────
│      buildGroups(tickets, 'epic', lookups, me)  →  [{ key: 'e-1', title: 'Checkout', … }, { key: 'none', title: 'No epic', … }]
*/
// The tickets arrive already filtered and sorted; grouping only deals them into
// buckets, so each group keeps the sort order. A group's own order is what its
// field means: statuses in board order, epics and milestones by name, "you"
// before "someone else", and the empty bucket last.

export type TicketGroup = {
    /** Stable across edits: an id, or `none`. Also what `collapsed` stores. */
    key: string
    title: string
    /** Set for a status group, so it can be drawn as the status pill. */
    status: Status | null
    tickets: Ticket[]
}

export const UNGROUPED = 'all'

type Bucket = { key: string; title: string; status: Status | null; order: string | number; none?: true }

export function buildGroups(
    tickets: Ticket[],
    field: string | undefined,
    lookups: Lookups,
    viewerId: string,
): TicketGroup[] {
    if (field === undefined) {
        return tickets.length === 0 ? [] : [{ key: UNGROUPED, title: 'Tickets', status: null, tickets }]
    }

    const bucketOf = (ticket: Ticket): Bucket => {
        switch (field) {
            case 'status': {
                const status = lookups.statuses.find((s) => s.id === ticket.status_id) ?? null
                return status
                    ? { key: status.id, title: status.name, status, order: status.position }
                    : { key: 'none', title: 'No status', status: null, order: 0, none: true }
            }
            case 'assignee': {
                const id = ticket.assignee_id
                if (id === null) return { key: 'none', title: 'Unassigned', status: null, order: 0, none: true }
                return id === viewerId
                    ? { key: id, title: 'You', status: null, order: '' }
                    : { key: id, title: memberName(id) ?? 'Someone else', status: null, order: memberName(id)?.toLowerCase() ?? '\uffff' + id }
            }
            case 'epic':
            case 'milestone': {
                const rows = field === 'epic' ? lookups.epics : lookups.milestones
                const id = field === 'epic' ? ticket.epic_id : ticket.milestone_id
                if (id === null) return { key: 'none', title: `No ${field}`, status: null, order: 0, none: true }
                const name = rows.find((row) => row.id === id)?.name ?? `Unknown ${field}`
                return { key: id, title: name, status: null, order: name.toLowerCase() }
            }
            default:
                return { key: UNGROUPED, title: 'Tickets', status: null, order: 0 }
        }
    }

    const buckets = new Map<string, { bucket: Bucket; tickets: Ticket[] }>()
    for (const ticket of tickets) {
        const bucket = bucketOf(ticket)
        const known = buckets.get(bucket.key)
        if (known) known.tickets.push(ticket)
        else buckets.set(bucket.key, { bucket, tickets: [ticket] })
    }

    const groups = [...buckets.values()].toSorted((a, b) => {
        if (a.bucket.none || b.bucket.none) return Number(!!a.bucket.none) - Number(!!b.bucket.none)
        const x = a.bucket.order
        const y = b.bucket.order
        if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1
        return String(x).localeCompare(String(y))
    })

    // Several different people are all "Someone else": number them so two
    // headings never read the same.
    let others = 0
    return groups.map(({ bucket, tickets: inGroup }) => ({
        key: bucket.key,
        title:
            field === 'assignee' && bucket.title === 'Someone else' && ++others > 1
                ? `Someone else (${others})`
                : bucket.title,
        status: bucket.status,
        tickets: inGroup,
    }))
}
