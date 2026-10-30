import { describe, expect, it } from 'vitest'

import { hiddenCount } from './fitLabels'

// Three chips ending at 40, 84 and 130 (4px gaps), "+N" 24px wide.
const ENDS = [40, 84, 130]

describe('hiddenCount', () => {
    it('hides nothing when every chip fits, without room for a "+N"', () => {
        expect(hiddenCount(ENDS, 130, 24, 4)).toBe(0)
        expect(hiddenCount(ENDS, 400, 24, 4)).toBe(0)
    })

    it('hides the chips that do not fit and keeps room for the "+N"', () => {
        expect(hiddenCount(ENDS, 129, 24, 4)).toBe(1) // 84 + 4 + 24 = 112 fits, 130 + 28 does not
        expect(hiddenCount(ENDS, 111, 24, 4)).toBe(2) // 84 + 28 = 112 does not
        expect(hiddenCount(ENDS, 68, 24, 4)).toBe(2) // 40 + 28 = 68 fits
        expect(hiddenCount(ENDS, 67, 24, 4)).toBe(3)
    })

    it('hides everything into the "+N" when not even one chip fits', () => {
        expect(hiddenCount(ENDS, 30, 24, 4)).toBe(3)
    })

    it('does nothing before the line has a width or without chips', () => {
        expect(hiddenCount(ENDS, 0, 24, 4)).toBe(0)
        expect(hiddenCount([], 100, 24, 4)).toBe(0)
    })
})
