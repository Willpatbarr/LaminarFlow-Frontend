import { describe, expect, it } from 'vitest'

import { loginPathFor, safeReturnTo, withReturnTo } from './returnTo'

describe('safeReturnTo', () => {
    it.each([
        ['/', '/'],
        ['/tickets', '/tickets'],
        ['/tickets/42?tab=comments#latest', '/tickets/42?tab=comments#latest'],
        // A scheme-looking string later in the URL is still a path on this site.
        ['/redirect?to=https://evil.example', '/redirect?to=https://evil.example'],
    ])('accepts the same-origin path %s', (input, expected) => {
        expect(safeReturnTo(input)).toBe(expected)
    })

    it.each([
        ['an absolute URL', 'https://evil.example'],
        ['an absolute URL with a path', 'https://evil.example/tickets'],
        ['a protocol-relative URL', '//evil.example'],
        ['a protocol-relative URL with a path', '//evil.example/tickets'],
        ['a backslash host', '/\\evil.example'],
        ['a tab hidden inside the double slash', '/\t/evil.example'],
        ['a newline hidden inside the double slash', '/\n/evil.example'],
        ['javascript:', 'javascript:alert(1)'],
        ['JavaScript: in mixed case', 'JaVaScRiPt:alert(1)'],
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['a scheme with a leading space', ' https://evil.example'],
        ['a relative path with no slash', 'tickets'],
        ['an empty string', ''],
        ['a bare scheme-ish word', 'mailto:a@b.c'],
    ])('rejects %s', (_label, input) => {
        expect(safeReturnTo(input)).toBe('/')
    })

    it.each([undefined, null, 42, ['/tickets'], { a: 1 }])('rejects the non-string %j', (input) => {
        expect(safeReturnTo(input)).toBe('/')
    })

    it.each(['/login', '/signup', '/login/', '/login?returnTo=%2Ftickets', '/signup#top'])(
        'never returns to the auth screen %s',
        (input) => {
            expect(safeReturnTo(input)).toBe('/')
        },
    )

    it('does not mistake a longer path for an auth screen', () => {
        expect(safeReturnTo('/login-help')).toBe('/login-help')
        expect(safeReturnTo('/tickets/login')).toBe('/tickets/login')
    })
})

describe('loginPathFor and withReturnTo', () => {
    it('encodes the destination as a single query value', () => {
        expect(loginPathFor('/tickets?x=1&y=2')).toBe('/login?returnTo=%2Ftickets%3Fx%3D1%26y%3D2')
    })

    it('leaves the URL bare when the destination is home or not allowed', () => {
        expect(loginPathFor('/')).toBe('/login')
        expect(loginPathFor('https://evil.example')).toBe('/login')
        expect(loginPathFor('/login')).toBe('/login')
    })

    it('can target sign-up so a returnTo survives the switch between screens', () => {
        expect(withReturnTo('/signup', '/tickets')).toBe('/signup?returnTo=%2Ftickets')
    })
})
