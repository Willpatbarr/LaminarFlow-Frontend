import { describe, expect, it } from 'vitest'

import { absoluteTime, relativeTime } from './relativeTime'

const NOW = Date.parse('2026-03-10T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('relativeTime', () => {
    it('says "just now" for the first moments, and for a clock slightly behind the server', () => {
        expect(relativeTime(ago(5 * SECOND), NOW)).toBe('just now')
        expect(relativeTime(ago(-10 * SECOND), NOW)).toBe('just now')
    })

    it('counts minutes, then hours, then days, in the browser\'s own words', () => {
        expect(relativeTime(ago(MINUTE), NOW)).toBe('1 minute ago')
        expect(relativeTime(ago(2 * MINUTE + 10 * SECOND), NOW)).toBe('2 minutes ago')
        expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59 minutes ago')
        expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago')
        expect(relativeTime(ago(50 * HOUR), NOW)).toBe('2 days ago')
    })

    it('does not fall over on a timestamp it cannot read', () => {
        expect(relativeTime('yesterday-ish', NOW)).toBe('a while ago')
        expect(absoluteTime('yesterday-ish')).toBe('yesterday-ish')
    })
})
