import { memoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import { afterEach, expect, it, vi } from 'vitest'

import { session } from '@/features/auth'
import { ok, stubFetch } from '@/testing/fetch'

import { createAppRouter } from './router'

// Its own file because the session store is module state that only ever moves
// away from `unknown`: this is the one test that must start before any answer
// has arrived, and vitest gives each file a fresh module.
afterEach(() => {
    vi.unstubAllGlobals()
})

it('renders the shell with a placeholder, not the login screen, until /auth/me answers', async () => {
    let answer!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => (answer = resolve))
    stubFetch({ 'GET /api/v1/auth/me': () => pending })
    const history = memoryHistory('/')
    const Router = createAppRouter(history)
    const { refresh } = await import('@/features/auth')

    render(() => <Router />)
    const asking = refresh()

    expect(session.status).toBe('unknown')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tickets' })).not.toBeInTheDocument()
    expect(history.get()).toBe('/')

    answer(
        ok({
            account_id: 'acc-1',
            via: 'session',
            email: 'ada@example.com',
            display_name: 'Ada Lovelace',
            workspace_id: 'ws-1',
            permissions: [],
        }),
    )
    await asking

    // The session placeholder has given way to the tickets screen. That screen
    // has a loading state of its own (nothing has been synced here), so "no
    // status at all" is no longer the thing to assert.
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
    expect(history.get()).toBe('/')
})
