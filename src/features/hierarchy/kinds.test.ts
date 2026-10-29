import { describe, expect, it } from 'vitest'

import { fromSearch, toSearch } from '../tickets/listView/config'
import { formatDay, progressOf, scopeConfig } from './kinds'

describe('progressOf', () => {
    it('counts the tickets in a done status, and is 0 of 0 for none', () => {
        const done = new Set(['s-done'])
        expect(progressOf([], done)).toEqual({ done: 0, total: 0, percent: 0 })
        expect(
            progressOf([{ status_id: 's-done' }, { status_id: 's-todo' }, { status_id: null }, { status_id: 's-done' }], done),
        ).toEqual({ done: 2, total: 4, percent: 50 })
    })
})

describe('formatDay', () => {
    it('reads the day as written, whatever the time zone', () => {
        expect(formatDay('2026-03-01')).toBe('1 Mar 2026')
        expect(formatDay(null)).toBe('')
    })
})

describe('scopeConfig', () => {
    it('is a list view config that survives the list\'s URL codec', () => {
        const config = scopeConfig('sprint', 'sp-1')
        expect(config.filter).toEqual({ op: 'and', conditions: [{ field: 'sprint', op: 'eq', value: 'sp-1' }] })
        expect(fromSearch(toSearch(config)).config.filter).toEqual(config.filter)
    })
})
