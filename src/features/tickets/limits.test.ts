import { describe, expect, it } from 'vitest'

import openapi from '../../../api/openapi.json?raw'

import { codePoints, descriptionCount, LIMITS, nameCount, overMessage, titleCount } from './limits'

type Schemas = Record<string, { properties?: Record<string, { maxLength?: number }> }>

// The contract the client was generated from, read as the file it is.
const schemas = (
    JSON.parse(openapi) as {
        components: { schemas: Schemas }
    }
).components.schemas

const maxLength = (schema: string, property: string) => schemas[schema]?.properties?.[property]?.maxLength

describe('the limits, against api/openapi.json', () => {
    // If this fails the backend changed a limit: update LIMITS, pull the
    // contract again with `npm run api:pull`, and look at what else the change touches.
    it.each([
        ['CreateTicketInputBody', 'title', 'ticketTitle'],
        ['UpdateTicketInputBody', 'title', 'ticketTitle'],
        ['CreateTicketInputBody', 'description', 'ticketDescription'],
        ['UpdateTicketInputBody', 'description', 'ticketDescription'],
        ['CreateTeamInputBody', 'name', 'name'],
        ['CreateProjectInputBody', 'name', 'name'],
    ] as const)('%s.%s is %s', (schema, property, limit) => {
        expect(maxLength(schema, property)).toBe(LIMITS[limit])
    })
})

describe('counting', () => {
    it('counts code points, the way the server does, not UTF-16 units', () => {
        expect('😀'.length).toBe(2)
        expect(codePoints('😀')).toBe(1)
        expect(codePoints('a😀é')).toBe(3)
        // 200 emoji are 400 UTF-16 units and exactly at the limit.
        expect(titleCount('😀'.repeat(200))).toEqual({ used: 200, max: 200 })
        expect(titleCount('😀'.repeat(201)).used).toBe(201)
    })

    it('counts a title as it would be sent, trimmed, and a description as typed', () => {
        expect(titleCount(`   ${'x'.repeat(200)}   `).used).toBe(200)
        expect(nameCount('  Core  ').used).toBe(4)
        expect(descriptionCount('  x  ').used).toBe(5)
    })

    it('says how far over, and nothing at or under the limit', () => {
        expect(overMessage('Title', { used: 200, max: 200 })).toBeUndefined()
        expect(overMessage('Title', { used: 212, max: 200 })).toBe(
            'Title can be at most 200 characters; this one is 12 over.',
        )
        expect(overMessage('Description', { used: 51_000, max: 50_000 })).toBe(
            'Description can be at most 50,000 characters; this one is 1,000 over.',
        )
    })
})
