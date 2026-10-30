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
│      localToday(now?)           the user's local calendar day, YYYY-MM-DD
│      groupSprints(sprints, today)   { current, upcoming, past, undated } (LAM-162)
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

/** The user's own calendar day (not UTC's) as `YYYY-MM-DD`: "today" for a sprint
 *  is the day on the user's wall clock. */
export function localToday(now: Date = new Date()): string {
    const two = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

export type SprintGroups<T> = { current: T[]; upcoming: T[]; past: T[]; undated: T[] }

/** Sorts sprints into Current (start ≤ today ≤ end, both ends inclusive, so a
 *  sprint ending today is still current), Upcoming (starts after today), Past
 *  (ended before today) and undated (neither date). A sprint with only one date
 *  is open on the other side. Days are compared as `YYYY-MM-DD` text. Current and
 *  Upcoming run soonest first; Past newest first. */
export function groupSprints<T extends { start_date?: string | null; end_date?: string | null }>(
    sprints: readonly T[],
    today: string,
): SprintGroups<T> {
    const groups: SprintGroups<T> = { current: [], upcoming: [], past: [], undated: [] }
    const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null)
    for (const sprint of sprints) {
        const start = day(sprint.start_date)
        const end = day(sprint.end_date)
        if (!start && !end) groups.undated.push(sprint)
        else if (start && start > today) groups.upcoming.push(sprint)
        else if (end && end < today) groups.past.push(sprint)
        else groups.current.push(sprint)
    }
    const key = (sprint: T) => day(sprint.start_date) ?? day(sprint.end_date) ?? ''
    const endKey = (sprint: T) => day(sprint.end_date) ?? day(sprint.start_date) ?? ''
    groups.current.sort((a, b) => endKey(a).localeCompare(endKey(b)))
    groups.upcoming.sort((a, b) => key(a).localeCompare(key(b)))
    groups.past.sort((a, b) => endKey(b).localeCompare(endKey(a)))
    return groups
}
