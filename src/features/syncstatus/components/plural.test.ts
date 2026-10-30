import { describe, expect, it } from 'vitest'

import { changes, tickets } from './plural'

describe('plural', () => {
    it('says "1 ticket" and "2 tickets"', () => {
        expect(tickets(0)).toBe('0 tickets')
        expect(tickets(1)).toBe('1 ticket')
        expect(tickets(2)).toBe('2 tickets')
    })

    it('says "1 change" and "3 changes"', () => {
        expect(changes(1)).toBe('1 change')
        expect(changes(3)).toBe('3 changes')
    })
})
