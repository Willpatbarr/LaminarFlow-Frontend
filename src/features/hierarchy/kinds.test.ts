import { describe, expect, it } from 'vitest'

import { fromSearch, toSearch } from '../tickets/listView/config'
import { formatDay, groupSprints, localToday, progressOf, scopeConfig } from './kinds'

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

describe('groupSprints', () => {
    const sprint = (name: string, start_date: string | null, end_date: string | null) => ({ name, start_date, end_date })
    const names = (rows: { name: string }[]) => rows.map((row) => row.name)
    const today = '2026-10-29'

    it('puts a sprint that starts or ends today in Current', () => {
        const groups = groupSprints(
            [sprint('starts', '2026-10-29', '2026-11-05'), sprint('ends', '2026-10-20', '2026-10-29'), sprint('one day', '2026-10-29', '2026-10-29')],
            today,
        )
        expect(names(groups.current).toSorted()).toEqual(['ends', 'one day', 'starts'])
        expect(groups.upcoming.length + groups.past.length + groups.undated.length).toBe(0)
    })

    it('splits upcoming from past at the day boundary', () => {
        const groups = groupSprints([sprint('tomorrow', '2026-10-30', '2026-11-10'), sprint('yesterday', '2026-10-15', '2026-10-28')], today)
        expect(names(groups.upcoming)).toEqual(['tomorrow'])
        expect(names(groups.past)).toEqual(['yesterday'])
    })

    it('gives sprints with no dates their own group, and treats one date as open on the other side', () => {
        const groups = groupSprints(
            [sprint('none', null, null), sprint('start only, begun', '2026-10-01', null), sprint('start only, later', '2026-12-01', null), sprint('end only, over', null, '2026-10-01'), sprint('end only, ahead', null, '2026-12-01')],
            today,
        )
        expect(names(groups.undated)).toEqual(['none'])
        expect(names(groups.current).toSorted()).toEqual(['end only, ahead', 'start only, begun'])
        expect(names(groups.upcoming)).toEqual(['start only, later'])
        expect(names(groups.past)).toEqual(['end only, over'])
    })

    it('orders Past newest first and Upcoming soonest first', () => {
        const groups = groupSprints(
            [sprint('a', '2026-01-01', '2026-01-14'), sprint('b', '2026-02-01', '2026-02-14'), sprint('c', '2027-02-01', '2027-02-14'), sprint('d', '2027-01-01', '2027-01-14')],
            today,
        )
        expect(names(groups.past)).toEqual(['b', 'a'])
        expect(names(groups.upcoming)).toEqual(['d', 'c'])
    })
})

describe('localToday', () => {
    it("is the local calendar day, not UTC's", () => {
        expect(localToday(new Date(2026, 9, 29, 23, 59))).toBe('2026-10-29')
        expect(localToday(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
    })
})
