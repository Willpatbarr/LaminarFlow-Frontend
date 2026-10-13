import { describe, expect, it } from 'vitest'

import { classify, classifyStatus, isTransient, type FailureKind } from './errors'
import { ApiProblem } from './problem'

describe('classifyStatus', () => {
    it.each<[number, FailureKind]>([
        [0, 'network'],
        [400, 'validation'],
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [405, 'rejected'],
        [408, 'server'],
        [409, 'conflict'],
        [410, 'not_found'],
        [412, 'conflict'],
        [413, 'rejected'],
        [415, 'rejected'],
        [422, 'validation'],
        [425, 'server'],
        [429, 'server'],
        [500, 'server'],
        [502, 'server'],
        [503, 'server'],
        [504, 'server'],
        [599, 'server'],
    ])('%i is %s', (status, kind) => {
        expect(classifyStatus(status)).toBe(kind)
    })
})

describe('classify', () => {
    it('reads the status of an ApiProblem, whatever its code', () => {
        expect(classify(new ApiProblem(422, 'password_too_short', []))).toBe('validation')
        expect(classify(new ApiProblem(409, 'email_taken', []))).toBe('conflict')
        expect(classify(new ApiProblem(401, 'invalid_login', []))).toBe('unauthorized')
        expect(classify(new ApiProblem(500, 'unknown', []))).toBe('server')
    })

    it('reads a Response and an entry error the same way', () => {
        expect(classify(new Response(null, { status: 503 }))).toBe('server')
        expect(classify({ status: 0, code: 'network', errors: [] })).toBe('network')
        expect(classify({ status: 403, code: 'forbidden', errors: [] })).toBe('forbidden')
    })

    it('calls anything that is not an API answer a network failure', () => {
        expect(classify(new TypeError('Failed to fetch'))).toBe('network')
        expect(classify(new DOMException('aborted', 'AbortError'))).toBe('network')
        expect(classify('boom')).toBe('network')
        expect(classify(null)).toBe('network')
        expect(classify(undefined)).toBe('network')
        expect(classify({ status: 'nope' })).toBe('network')
    })
})

describe('isTransient', () => {
    it('is true for what the same request may get past later, and only that', () => {
        const kinds: FailureKind[] = [
            'validation',
            'unauthorized',
            'forbidden',
            'not_found',
            'conflict',
            'server',
            'network',
            'rejected',
        ]
        expect(kinds.filter(isTransient)).toEqual(['server', 'network'])
    })
})
