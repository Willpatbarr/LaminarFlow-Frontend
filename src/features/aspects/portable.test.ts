import { describe, expect, it } from 'vitest'

import { exportFileName, parsePortable } from './portable'

const file = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ format_version: 1, name: 'Brief', fields: [{ label: 'Goal', position: 2 }, { label: 'Risks', position: 1 }], ...over })
const message = (text: string) => {
    const parsed = parsePortable(text)
    return parsed.ok ? undefined : parsed.message
}

describe('parsePortable', () => {
    it('accepts a file and orders fields by position', () => {
        const parsed = parsePortable(file())
        expect(parsed).toEqual({
            ok: true,
            file: { format_version: 1, name: 'Brief', fields: [{ label: 'Risks', position: 1 }, { label: 'Goal', position: 2 }] },
        })
    })

    it('tolerates a $schema pointer', () => {
        expect(parsePortable(file({ $schema: 'https://example.com/x.json' })).ok).toBe(true)
    })

    it('accepts an empty field list', () => {
        expect(parsePortable(file({ fields: [] })).ok).toBe(true)
    })

    it.each([
        ['not json', '{nope', 'not valid JSON'],
        ['an array', '[]', 'expected a JSON object'],
        ['a version this reader lacks', file({ format_version: 2 }), 'format_version: 2 is not supported'],
        ['no version', JSON.stringify({ name: 'x', fields: [] }), 'format_version: missing'],
        ['a blank name', file({ name: '  ' }), 'name: must not be empty'],
        ['a long name', file({ name: 'x'.repeat(101) }), 'name: must be at most 100'],
        ['an unknown key', file({ color: 'red' }), 'color: not part of'],
        ['an unknown field key', file({ fields: [{ label: 'a', position: 1, id: 'x' }] }), 'fields[0].id: not part of'],
        ['a blank label', file({ fields: [{ label: 'ok', position: 1 }, { label: '', position: 2 }] }), 'fields[1].label: must not be empty'],
        ['a bad position', file({ fields: [{ label: 'a', position: -1 }] }), 'fields[0].position'],
        ['too many fields', file({ fields: Array.from({ length: 101 }, (_, i) => ({ label: 'f', position: i })) }), 'at most 100'],
    ])('refuses %s', (_name, text, expected) => {
        expect(message(text)).toContain(expected)
    })
})

describe('exportFileName', () => {
    it('makes a readable filename from the type name', () => {
        expect(exportFileName('Design Brief')).toBe('design-brief.aspect-type.json')
        expect(exportFileName('  Café / Notes! ')).toBe('cafe-notes.aspect-type.json')
        expect(exportFileName('日本語')).toBe('aspect-type.aspect-type.json')
    })
})
