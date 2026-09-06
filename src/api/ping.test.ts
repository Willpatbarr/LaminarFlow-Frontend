import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPing } from './ping'

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('getPing', () => {
    it('returns the parsed body', async () => {
        const body = { message: 'pong', time: '2026-09-05T00:00:00Z' }
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))

        await expect(getPing()).resolves.toMatchObject({ message: 'pong' })
    })
})