import { describe, expect, it } from 'vitest'

import { hueFor, isStarted } from './statusLook'

describe('hueFor', () => {
    it('maps the three seeded status colours to sheet hues', () => {
        expect(hueFor('#94a3b8')).toBe('slate')
        expect(hueFor('#3b82f6')).toBe('blue')
        expect(hueFor('#22c55e')).toBe('green')
    })

    it('finds the nearest hue for other colours, wrapping at red', () => {
        expect(hueFor('#ef4444')).toBe('rust')
        expect(hueFor('#e11d48')).toBe('rust')
        expect(hueFor('#f59e0b')).toBe('amber')
        expect(hueFor('#ea580c')).toBe('clay')
        expect(hueFor('#14b8a6')).toBe('teal')
        expect(hueFor('#8b5cf6')).toBe('violet')
    })

    it('falls back to slate for greys and for anything that is not a hex colour', () => {
        expect(hueFor('#808080')).toBe('slate')
        expect(hueFor('#000000')).toBe('slate')
        expect(hueFor('tomato')).toBe('slate')
        expect(hueFor('')).toBe('slate')
    })
})

describe('isStarted', () => {
    const status = (category: string) => ({
        id: 's',
        team_id: 't',
        name: 'x',
        color: '#000000',
        position: 1,
        category,
    })

    it('is a ring only for not_started', () => {
        expect(isStarted(status('not_started'))).toBe(false)
        expect(isStarted(status('in_progress'))).toBe(true)
        expect(isStarted(status('done'))).toBe(true)
    })
})
