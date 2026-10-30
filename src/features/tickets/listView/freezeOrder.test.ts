import { describe, expect, it } from 'vitest'

import { ticket } from '@/sync/testing/harness'

import { freezeOrder } from './freezeOrder'
import { buildGroups } from './group'
import { sortTickets, type Lookups } from './evaluate'

const lookups: Lookups = {
    statuses: [
        { id: 's-todo', team_id: 't', name: 'To Do', color: '', position: 1, category: 'not_started', version: 1 },
        { id: 's-done', team_id: 't', name: 'Done', color: '', position: 2, category: 'done', version: 1 },
    ],
    epics: [],
    milestones: [],
    sprints: [],
    labels: [],
}

const at = (n: number) => `2026-10-29T10:00:0${n}.000Z`
const a = ticket({ id: 'a', title: 'A', status_id: 's-todo', updated_at: at(3) })
const b = ticket({ id: 'b', title: 'B', status_id: 's-todo', updated_at: at(2) })
const c = ticket({ id: 'c', title: 'C', status_id: 's-todo', updated_at: at(1) })

const sorted = (rows: typeof a[]) => sortTickets(rows, undefined, lookups)
const ids = (rows: { id: string }[]) => rows.map((row) => row.id)
const find = (rows: typeof a[]) => (id: string) => rows.find((row) => row.id === id)

describe('freezeOrder', () => {
    it('shows the fresh order when not frozen', () => {
        const shown = freezeOrder([], sorted([c, a, b]), find([a, b, c]), false)
        expect(ids(shown.rows)).toEqual(['a', 'b', 'c'])
        expect(shown.held).toBe(0)
    })

    it('keeps the order when a row is edited, and shows its new values', () => {
        const before = freezeOrder([], sorted([a, b, c]), find([a, b, c]), false)
        const edited = { ...c, title: 'C edited', updated_at: at(9) }
        const now = [a, b, edited]
        const frozen = freezeOrder(before.rows, sorted(now), find(now), true)
        expect(sorted(now)[0].id).toBe('c')
        expect(ids(frozen.rows)).toEqual(['a', 'b', 'c'])
        expect(frozen.rows[2].ticket.title).toBe('C edited')
        expect(frozen.rows.some((row) => row.gone)).toBe(false)
    })

    it('re-sorts on unfreeze', () => {
        const before = freezeOrder([], sorted([a, b, c]), find([a, b, c]), false)
        const now = [a, b, { ...c, updated_at: at(9) }]
        const frozen = freezeOrder(before.rows, sorted(now), find(now), true)
        const thawed = freezeOrder(frozen.rows, sorted(now), find(now), false)
        expect(ids(thawed.rows)).toEqual(['c', 'a', 'b'])
    })

    it('keeps an archived row in place, dimmed, so no other row shifts', () => {
        const before = freezeOrder([], sorted([a, b, c]), find([a, b, c]), false)
        const now = [a, c]
        const frozen = freezeOrder(before.rows, sorted(now), find(now), true)
        expect(ids(frozen.rows)).toEqual(['a', 'b', 'c'])
        expect(frozen.rows.map((row) => row.gone)).toEqual([false, true, false])
        expect(frozen.rows[1].ticket.title).toBe('B')
        // It is gone for good once the list thaws.
        expect(ids(freezeOrder(frozen.rows, sorted(now), find(now), false).rows)).toEqual(['a', 'c'])
    })

    it('keeps a row edited out of the filter in place, with its new values', () => {
        const before = freezeOrder([], sorted([a, b, c]), find([a, b, c]), false)
        const moved = { ...b, status_id: 's-done' }
        const frozen = freezeOrder(before.rows, sorted([a, c]), find([a, moved, c]), true)
        expect(ids(frozen.rows)).toEqual(['a', 'b', 'c'])
        expect(frozen.rows[1]).toMatchObject({ gone: true, ticket: { status_id: 's-done' } })
    })

    it('holds new rows back and counts them', () => {
        const before = freezeOrder([], sorted([a, b]), find([a, b]), false)
        const fresh = ticket({ id: 'n', title: 'New', updated_at: at(8) })
        const frozen = freezeOrder(before.rows, sorted([a, b, fresh]), find([a, b, fresh]), true)
        expect(ids(frozen.rows)).toEqual(['a', 'b'])
        expect(frozen.held).toBe(1)
    })

    it('keeps a row in the group it was placed in when its status changes', () => {
        const before = freezeOrder([], sorted([a, b, c]), find([a, b, c]), false)
        const moved = { ...b, status_id: 's-done', updated_at: at(9) }
        const now = [a, moved, c]
        const frozen = freezeOrder(before.rows, sorted(now), find(now), true)
        const groups = buildGroups(frozen.rows.map((row) => row.placed), 'status', lookups, 'me')
        expect(groups.map((g) => [g.key, ids(g.tickets)])).toEqual([['s-todo', ['a', 'b', 'c']]])
        expect(frozen.rows[1].ticket.status_id).toBe('s-done')
    })
})

describe('freezeOrder with a ticket the store edits in place', () => {
    it('places a row by what it was when the list froze', () => {
        const live = { ...b }
        const before = freezeOrder([], sorted([a, live, c]), find([a, live, c]), false)
        const first = freezeOrder(before.rows, sorted([a, live, c]), find([a, live, c]), true)
        live.status_id = 's-done' // the store mutates the same object
        const frozen = freezeOrder(first.rows, sorted([a, live, c]), find([a, live, c]), true)
        expect(frozen.rows[1].placed.status_id).toBe('s-todo')
        expect(frozen.rows[1].ticket.status_id).toBe('s-done')
    })
})
