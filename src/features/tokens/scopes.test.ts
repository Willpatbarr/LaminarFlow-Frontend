import { describe, expect, it } from 'vitest'

import { ALL_PERMISSIONS } from '@/testing/permissions'

import { DANGEROUS_SCOPES, describeScope, layoutScopes, SCOPE_DESCRIPTIONS, SCOPE_GROUPS } from './scopes'

describe('scope descriptions', () => {
    // ALL_PERMISSIONS is the list /auth/me reports for a session (the API's
    // closed set). The OpenAPI types only say `string[]`, so this is the list
    // to keep in step: a new scope there fails here until it is described.
    it('describes every permission the API has', () => {
        for (const scope of ALL_PERMISSIONS) {
            expect(describeScope(scope), scope).toBeTruthy()
        }
    })

    it('has no description for a scope the API does not have', () => {
        expect(Object.keys(SCOPE_DESCRIPTIONS).sort()).toEqual([...ALL_PERMISSIONS].sort())
    })

    it('puts every permission in exactly one place', () => {
        const { groups, dangerous, other } = layoutScopes(ALL_PERMISSIONS)
        const placed = [
            ...groups.flatMap((g) => [g.read, g.write]).filter(Boolean),
            ...dangerous,
            ...other,
        ]
        expect([...placed].sort()).toEqual([...ALL_PERMISSIONS].sort())
        expect(other).toEqual([])
        expect(dangerous).toEqual(['account:delete'])
    })

    it('keeps a scope it does not know under other', () => {
        expect(layoutScopes(['ticket:read', 'export:read']).other).toEqual(['export:read'])
    })

    it('pairs read with write in each group, and keeps dangerous scopes out of them', () => {
        for (const g of SCOPE_GROUPS) {
            expect(g.read.endsWith(':read')).toBe(true)
            expect(g.write.endsWith(':write')).toBe(true)
        }
        for (const d of DANGEROUS_SCOPES) {
            expect(SCOPE_GROUPS.some((g) => g.read === d || g.write === d)).toBe(false)
        }
    })
})
