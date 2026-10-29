import { describe, expect, it } from 'vitest'

import { cpLength, cpOffsetOfIndex, cpSlice, indexOfCpOffset } from './offsets'

describe('code point offsets', () => {
    it('counts an emoji outside the BMP as one, where length says two', () => {
        expect('a😀b'.length).toBe(4)
        expect(cpLength('a😀b')).toBe(3)
        expect(cpLength('👨‍👩‍👧')).toBe(5) // a ZWJ family is five code points
    })

    it('slices by code points', () => {
        expect(cpSlice('a😀b😀c', 1, 4)).toBe('😀b😀')
        expect(cpSlice('a😀b', 2, 3)).toBe('b')
        expect(cpSlice('abc', 1, 1)).toBe('')
        expect(cpSlice('abc', 1, 99)).toBe('bc')
    })

    it('converts between UTF-16 indexes and offsets', () => {
        const text = '😀😀x'
        expect(cpOffsetOfIndex(text, 4)).toBe(2)
        expect(indexOfCpOffset(text, 2)).toBe(4)
        expect(indexOfCpOffset(text, 99)).toBe(text.length)
    })

    it('treats a lone surrogate as one character', () => {
        expect(cpLength('\ud83d')).toBe(1)
    })
})
