import { describe, expect, it } from 'vitest'

import { toSearch } from '../listView/config'
import { boardSearch, configOf, isChanged, toSavedConfig, viewUrl } from './savedView'

const FILTER = { op: 'and' as const, conditions: [{ field: 'status', op: 'in', value: ['s-todo'] }] }
const list = { id: 'sv-1', layout: 'list' as const, board_id: null, config: { filter: FILTER, group: 'epic', sort: [{ field: 'title', desc: true }] } }
const board = { id: 'sv-2', layout: 'board' as const, board_id: 'b-1', config: { filter: FILTER } }

describe('viewUrl', () => {
    it('opens a list view as the list URL of its config, naming the view', () => {
        const [path, query] = viewUrl(list).split('?')
        const params = new URLSearchParams(query)

        expect(path).toBe('/')
        expect(params.get('view')).toBe('sv-1')
        expect(params.get('group')).toBe('epic')
        expect(params.get('sort')).toBe('title:desc')
        expect(JSON.parse(params.get('filter')!)).toEqual(FILTER)
    })

    it('says "ungrouped" out loud for a view saved with no group', () => {
        const params = new URLSearchParams(viewUrl({ ...list, config: {} }).split('?')[1])

        expect(params.get('group')).toBe('none')
    })

    it('opens a board view on its board, with only the filter', () => {
        const [path, query] = viewUrl({ ...board, config: { ...board.config, group: 'epic', columns: ['title'] } }).split('?')
        const params = new URLSearchParams(query)

        expect(path).toBe('/boards/b-1')
        expect([...params.keys()].toSorted()).toEqual(['filter', 'view'])
    })
})

describe('configOf', () => {
    it('treats null sort and columns as none', () => {
        expect(configOf({ layout: 'list', config: { group: 'status', sort: null, columns: null } })).toEqual({ group: 'status' })
    })

    it('drops what this client cannot show', () => {
        expect(configOf({ layout: 'list', config: { sort: [{ field: 'nope', desc: false }], columns: ['title', 'nope'] } })).toEqual({
            columns: ['title'],
        })
    })
})

describe('toSavedConfig', () => {
    it('keeps a list\'s whole setup and a board\'s filter alone', () => {
        const current = { filter: FILTER, group: 'epic', sort: [{ field: 'title', desc: false }], columns: ['title', 'epic'] }

        expect(toSavedConfig(current, 'list')).toEqual(current)
        expect(toSavedConfig(current, 'board')).toEqual({ filter: FILTER })
    })

    it('leaves out an empty filter', () => {
        expect(toSavedConfig({ filter: { op: 'and' }, group: 'status' }, 'list')).toEqual({ group: 'status' })
    })
})

describe('isChanged', () => {
    it('is false for the setup the view saved, however the server ordered its keys', () => {
        const reordered = { ...list, config: { sort: [{ desc: true, field: 'title' }], group: 'epic', filter: { conditions: [{ value: ['s-todo'], op: 'in', field: 'status' }], op: 'and' as const } } }

        expect(isChanged(reordered, { filter: FILTER, group: 'epic', sort: [{ field: 'title', desc: true }] })).toBe(false)
    })

    it('is true when any part differs', () => {
        const same = { filter: FILTER, group: 'epic', sort: [{ field: 'title', desc: true }] }

        expect(isChanged(list, { ...same, group: 'status' })).toBe(true)
        expect(isChanged(list, { ...same, sort: undefined })).toBe(true)
        expect(isChanged(list, { ...same, columns: ['title', 'epic'] })).toBe(true)
        expect(isChanged(list, { ...same, filter: undefined })).toBe(true)
    })

    it('compares a board on its filter alone', () => {
        expect(isChanged(board, { filter: FILTER, group: 'epic' })).toBe(false)
        expect(isChanged(board, {})).toBe(true)
    })

    it('knows an ungrouped view from the default grouping', () => {
        expect(isChanged({ layout: 'list', config: {} }, { group: 'status' })).toBe(true)
        expect(isChanged({ layout: 'list', config: {} }, {})).toBe(false)
    })
})

describe('boardSearch', () => {
    it('carries the filter and the view, and no group', () => {
        const params = boardSearch(FILTER, 'sv-2')

        expect(params.get('view')).toBe('sv-2')
        expect(params.has('group')).toBe(false)
        expect(params.toString()).toContain(toSearch({ filter: FILTER }).get('filter') ? 'filter=' : '')
        expect(boardSearch(undefined).toString()).toBe('')
    })
})
