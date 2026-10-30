import { describe, expect, it } from 'vitest'

import { keyAction, matchTargets, SHOWN } from './linkSuggest'

const key = (k: string, extra: object = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...extra })

describe('keyAction', () => {
    it('moves down and up, wrapping at both ends', () => {
        expect(keyAction(key('ArrowDown'), 0, 3)).toEqual({ move: 1 })
        expect(keyAction(key('ArrowDown'), 2, 3)).toEqual({ move: 0 })
        expect(keyAction(key('ArrowUp'), 1, 3)).toEqual({ move: 0 })
        expect(keyAction(key('ArrowUp'), 0, 3)).toEqual({ move: 2 })
    })

    it('picks on Enter and Tab', () => {
        expect(keyAction(key('Enter'), 0, 1)).toBe('pick')
        expect(keyAction(key('Tab'), 0, 1)).toBe('pick')
    })

    it('does nothing with no options, with a modifier, mid-composition, or on other keys', () => {
        expect(keyAction(key('Enter'), 0, 0)).toBe('none')
        expect(keyAction(key('Tab'), 0, 0)).toBe('none')
        expect(keyAction(key('ArrowDown'), 0, 0)).toBe('none')
        expect(keyAction(key('Enter', { shiftKey: true }), 0, 2)).toBe('none')
        expect(keyAction(key('Enter', { metaKey: true }), 0, 2)).toBe('none')
        expect(keyAction(key('Enter', { isComposing: true }), 0, 2)).toBe('none')
        expect(keyAction(key('a'), 0, 2)).toBe('none')
        expect(keyAction(key('Escape'), 0, 2)).toBe('none')
    })
})

describe('matchTargets', () => {
    const all = [
        { kind: 'ticket' as const, id: '1', title: 'Ship the chips' },
        { kind: 'document' as const, id: '2', title: 'Launch RUNBOOK' },
        { kind: 'project' as const, id: '3', title: 'Atlas' },
    ]
    it('matches a part of the title, ignoring case and keeping the order given', () => {
        expect(matchTargets(all, 'runb').map((t) => t.id)).toEqual(['2'])
        expect(matchTargets(all, ' A ').map((t) => t.id)).toEqual(['2', '3'])
    })
    it('lists everything for an empty query, up to the limit', () => {
        expect(matchTargets(all, '')).toHaveLength(3)
        expect(matchTargets(all, '', 2)).toHaveLength(2)
        const many = Array.from({ length: SHOWN + 5 }, (_, i) => ({ kind: 'ticket' as const, id: String(i), title: 'T' }))
        expect(matchTargets(many, 't')).toHaveLength(SHOWN)
    })
    it('is empty when nothing matches', () => {
        expect(matchTargets(all, 'zzz')).toEqual([])
    })
})
