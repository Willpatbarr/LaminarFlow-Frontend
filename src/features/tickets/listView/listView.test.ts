import { describe, expect, it } from 'vitest'

import { ticket } from '@/sync/testing/harness'

import { DEFAULT_GROUP, fromSearch, toSearch, visibleColumns, type ListViewConfig } from './config'
import { matches, sortTickets, type Lookups } from './evaluate'
import { emptyModel, fromGroup, toGroup } from './filterModel'
import { buildGroups } from './group'
import { scoped } from './serverRun'

const lookups: Lookups = {
    statuses: [
        { id: 's-todo', team_id: 't', name: 'To Do', color: '', position: 1, category: 'not_started', version: 1 },
        { id: 's-done', team_id: 't', name: 'Done', color: '', position: 2, category: 'done', version: 1 },
    ],
    epics: [
        { id: 'e-b', project_id: 'p-1', name: 'Billing', description: '', version: 1 },
        { id: 'e-a', project_id: 'p-1', name: 'Auth', description: '', version: 1 },
    ],
    milestones: [],
    sprints: [],
    labels: [],
}

describe('the URL codec', () => {
    it('round-trips a full config', () => {
        const config: ListViewConfig = {
            filter: { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-todo'] }] },
            group: 'epic',
            sort: [
                { field: 'title', desc: true },
                { field: 'updated_at', desc: false },
            ],
            columns: ['title', 'epic'],
        }
        const { config: back, collapsed } = fromSearch(toSearch(config, ['e-a']))
        expect(back).toEqual(config)
        expect(collapsed).toEqual(['e-a'])
    })

    it('is grouped by status when the link says nothing, and ungrouped only when it says so', () => {
        expect(fromSearch(new URLSearchParams('')).config.group).toBe(DEFAULT_GROUP)
        expect(toSearch({ group: 'status' }).toString()).toBe('')
        expect(toSearch({}).get('group')).toBe('none')
        expect(fromSearch(toSearch({})).config.group).toBeUndefined()
    })

    it('drops what the backend would refuse instead of trusting it', () => {
        const params = new URLSearchParams({
            filter: JSON.stringify({ op: 'and', conditions: [{ field: 'status', op: 'contains', value: 'x' }] }),
            group: 'label',
            sort: 'nope,title:sideways,title:desc',
            columns: 'status,status,bogus,epic',
        })
        const { config } = fromSearch(params)
        expect(config.filter).toBeUndefined()
        expect(config.group).toBe(DEFAULT_GROUP)
        expect(config.sort).toEqual([{ field: 'title', desc: true }])
        expect(config.columns).toEqual(['status', 'epic'])
    })

    it('ignores a filter that is not JSON, too deep or empty', () => {
        expect(fromSearch(new URLSearchParams({ filter: '{nope' })).config.filter).toBeUndefined()
        expect(fromSearch(new URLSearchParams({ filter: '{"op":"and"}' })).config.filter).toBeUndefined()
        let deep: object = { op: 'and', conditions: [{ field: 'title', op: 'is_null' }] }
        for (let i = 0; i < 6; i++) deep = { op: 'and', groups: [deep] }
        expect(fromSearch(new URLSearchParams({ filter: JSON.stringify(deep) })).config.filter).toBeUndefined()
    })

    it('always shows the title first, whatever was chosen', () => {
        expect(visibleColumns({})).toEqual(['title', 'status', 'assignee'])
        expect(visibleColumns({ columns: ['epic', 'title', 'label'] })).toEqual(['title', 'epic', 'label'])
    })
})

describe('the filter bar model', () => {
    it('writes the filter language and reads it back', () => {
        const model = emptyModel()
        model.text = ' pay '
        model.picks.status = { ids: ['s-todo'], none: true }
        model.picks.label = { ids: [], none: true }
        const group = toGroup(model)
        expect(group).toEqual({
            op: 'and',
            conditions: [
                { field: 'title', op: 'contains', value: 'pay' },
                { field: 'label', op: 'is_null' },
            ],
            groups: [
                {
                    op: 'or',
                    conditions: [
                        { field: 'status', op: 'in', value: ['s-todo'] },
                        { field: 'status', op: 'is_null' },
                    ],
                },
            ],
        })
        expect(fromGroup(group)).toEqual({ ...model, text: 'pay' })
    })

    it('has no filter when nothing is chosen, and leaves a filter it did not write alone', () => {
        expect(toGroup(emptyModel())).toBeUndefined()
        expect(fromGroup({ op: 'or', conditions: [{ field: 'status', op: 'eq', value: 'x' }] })).toBeNull()
        expect(fromGroup({ op: 'and', conditions: [{ field: 'version', op: 'gt', value: 2 }] })).toBeNull()
        expect(
            fromGroup({ op: 'and', conditions: [{ field: 'status', op: 'eq', value: 'x' }] })?.picks.status.ids,
        ).toEqual(['x'])
    })
})

describe('the local run', () => {
    const a = ticket({
        id: 'a',
        title: 'Fix Login',
        status_id: 's-todo',
        epic_id: 'e-a',
        label_ids: ['l-1'],
        updated_at: '2026-01-02T00:00:00Z',
    })
    const b = ticket({
        id: 'b',
        title: 'Billing page',
        status_id: 's-done',
        epic_id: 'e-b',
        assignee_id: 'me',
        updated_at: '2026-01-03T00:00:00Z',
    })
    const c = ticket({ id: 'c', title: 'Zebra', status_id: null, updated_at: '2026-01-01T00:00:00Z' })
    const run = (group: Parameters<typeof matches>[1]) => [a, b, c].filter((t) => matches(t, group)).map((t) => t.id)

    it('filters like the server does', () => {
        expect(run(undefined)).toEqual(['a', 'b', 'c'])
        expect(run({ op: 'and', conditions: [{ field: 'title', op: 'contains', value: 'LOGIN' }] })).toEqual(['a'])
        expect(run({ op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-todo', 's-done'] }] })).toEqual([
            'a',
            'b',
        ])
        // NULL is never "not equal".
        expect(run({ op: 'and', conditions: [{ field: 'status', op: 'neq', value: 's-todo' }] })).toEqual(['b'])
        expect(run({ op: 'and', conditions: [{ field: 'status', op: 'is_null' }] })).toEqual(['c'])
        expect(run({ op: 'and', conditions: [{ field: 'label', op: 'in', value: ['l-1'] }] })).toEqual(['a'])
        expect(run({ op: 'and', conditions: [{ field: 'label', op: 'is_null' }] })).toEqual(['b', 'c'])
        expect(
            run({ op: 'and', conditions: [{ field: 'updated_at', op: 'gte', value: '2026-01-02T00:00:00Z' }] }),
        ).toEqual(['a', 'b'])
        expect(
            run({
                op: 'or',
                conditions: [{ field: 'assignee', op: 'eq', value: 'me' }],
                groups: [{ op: 'and', conditions: [{ field: 'title', op: 'eq', value: 'Zebra' }] }],
            }),
        ).toEqual(['b', 'c'])
    })

    it('does not hide a ticket over a field it does not hold', () => {
        expect(
            run({ op: 'and', conditions: [{ field: 'created_at', op: 'lt', value: '2000-01-01T00:00:00Z' }] }),
        ).toEqual(['a', 'b', 'c'])
    })

    it('sorts, nulls last either way, by what a person sees', () => {
        const ids = (sort: Parameters<typeof sortTickets>[1]) => sortTickets([a, b, c], sort, lookups).map((t) => t.id)
        expect(ids(undefined)).toEqual(['b', 'a', 'c'])
        expect(ids([{ field: 'title', desc: false }])).toEqual(['b', 'a', 'c'])
        expect(ids([{ field: 'title', desc: true }])).toEqual(['c', 'a', 'b'])
        expect(ids([{ field: 'epic', desc: false }])).toEqual(['a', 'b', 'c'])
        expect(ids([{ field: 'epic', desc: true }])).toEqual(['b', 'a', 'c'])
        expect(ids([{ field: 'status', desc: false }])).toEqual(['a', 'b', 'c'])
    })

    it('groups by a field in that field’s order, the empty bucket last', () => {
        const titles = (field: string) =>
            buildGroups([c, b, a], field, lookups, 'me').map((g) => `${g.title}:${g.tickets.map((t) => t.id)}`)
        expect(titles('status')).toEqual(['To Do:a', 'Done:b', 'No status:c'])
        expect(titles('epic')).toEqual(['Auth:a', 'Billing:b', 'No epic:c'])
        expect(titles('assignee')).toEqual(['You:b', 'Unassigned:c,a'])
        expect(buildGroups([a, b], undefined, lookups, 'me')).toHaveLength(1)
        expect(buildGroups([], undefined, lookups, 'me')).toEqual([])
    })
})

describe('the server run', () => {
    it('narrows the filter to the project without nesting a second level when it can', () => {
        const project = { field: 'project', op: 'eq', value: 'p-1' }
        const own = { field: 'title', op: 'contains', value: 'x' }
        expect(scoped('p-1', { op: 'and', conditions: [own] })).toEqual({
            op: 'and',
            conditions: [project, own],
            groups: undefined,
        })
        expect(scoped('p-1', { op: 'or', conditions: [own] })).toEqual({
            op: 'and',
            conditions: [project],
            groups: [{ op: 'or', conditions: [own] }],
        })
    })
})
