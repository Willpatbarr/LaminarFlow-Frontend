import type { Ticket } from '@/sync'

import type { ListViewConfig } from '../tickets/listView/config'

/*
┌─ hierarchy ─────────────────────────────────────
│  the three things a ticket can be filed under, and what each page needs to know about them (LAM-105)
├─ out ───────────────────────────────────────────
│      KINDS, Kind, KindInfo      one entry per kind: words, path, the ticket field it matches
│      scopeConfig(kind, id)      the list view config that selects one item's tickets
│      progressOf(tickets, doneStatusIds)   { done, total, percent }
│      formatDay(date)            "2026-03-01" → "1 Mar 2026"
*/
// Epics, sprints and milestones are pages of the same shape: a name, a few
// fields, and the tickets filed under it. A ticket is filed under none of them
// unless someone says so, and that is normal (Master Spec 3.2): nothing here
// treats a missing parent as a gap.

export type Kind = 'epic' | 'sprint' | 'milestone'

export type KindInfo = {
    kind: Kind
    singular: string
    plural: string
    /** The list page; the detail page is `${path}/:id`. */
    path: string
    /** The ticket filter field (the backend's vocabulary) that selects its tickets. */
    field: Kind
    /** The columns its ticket list shows: the one it is filed under is redundant. */
    columns: string[]
}

export const KINDS: Record<Kind, KindInfo> = {
    epic: { kind: 'epic', singular: 'epic', plural: 'epics', path: '/epics', field: 'epic', columns: ['status', 'assignee', 'sprint'] },
    sprint: { kind: 'sprint', singular: 'sprint', plural: 'sprints', path: '/sprints', field: 'sprint', columns: ['status', 'assignee', 'epic'] },
    milestone: {
        kind: 'milestone',
        singular: 'milestone',
        plural: 'milestones',
        path: '/milestones',
        field: 'milestone',
        columns: ['status', 'assignee', 'epic'],
    },
}

/** The list view config that selects the tickets filed under one item: the same
 *  `ListViewConfig` the ticket list is driven by (LAM-106), so what a page
 *  shows is what that filter would show on the list. */
export function scopeConfig(kind: Kind, id: string): ListViewConfig {
    return {
        filter: { op: 'and', conditions: [{ field: KINDS[kind].field, op: 'eq', value: id }] },
        columns: KINDS[kind].columns,
    }
}

export type Progress = { done: number; total: number; percent: number }

/** How many of the tickets are in a status of the `done` category. No tickets
 *  is 0 of 0, not an error. */
export function progressOf(tickets: Pick<Ticket, 'status_id'>[], doneStatusIds: ReadonlySet<string>): Progress {
    const total = tickets.length
    const done = tickets.filter((ticket) => ticket.status_id !== null && doneStatusIds.has(ticket.status_id)).length
    return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A calendar day as the server sends it (`YYYY-MM-DD`), in words. Read as text,
 *  never as a Date: a day has no time zone, and `new Date('2026-03-01')` is
 *  UTC midnight, which is the evening before in the Americas. */
export function formatDay(date: string | null): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
    if (!match) return ''
    return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}
