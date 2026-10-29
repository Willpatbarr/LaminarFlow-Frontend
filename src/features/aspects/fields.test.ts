import { describe, expect, it } from 'vitest'

import { bodyForConversion, orderedFields } from './fields'

const f = (id: string, label: string, position: number) => ({ id, label, position })

describe('orderedFields', () => {
    it('orders by position, then label', () => {
        const type = { fields: [f('c', 'Zed', 2), f('b', 'Beta', 1), f('a', 'Alpha', 1)] }
        expect(orderedFields(type).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    })

    it('has none for a missing type or a null field list', () => {
        expect(orderedFields(null)).toEqual([])
        expect(orderedFields({ fields: null })).toEqual([])
    })

    it('does not reorder the type it was given', () => {
        const type = { fields: [f('b', 'B', 2), f('a', 'A', 1)] }
        orderedFields(type)
        expect(type.fields[0]?.id).toBe('b')
    })
})

describe('bodyForConversion', () => {
    it('puts the text under the first field and nothing else', () => {
        const type = { fields: [f('late', 'Late', 5), f('first', 'First', 1)] }
        expect(bodyForConversion('hello', type)).toEqual({ first: 'hello' })
    })

    it('is null when the type has no fields', () => {
        expect(bodyForConversion('hello', { fields: [] })).toBeNull()
        expect(bodyForConversion('hello', { fields: null })).toBeNull()
    })
})
