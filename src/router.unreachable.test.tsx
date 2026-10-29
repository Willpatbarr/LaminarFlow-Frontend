import { memoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { session } from '@/features/auth'
import { ok, stubFetch } from '@/testing/fetch'

import { createAppRouter } from './router'

// Its own file for the same reason as router.pending.test.tsx: the session
// store only moves away from `unknown`, and this has to begin there.
afterEach(() => {
    vi.unstubAllGlobals()
})

it("shows a 'can't reach the server' state with a working Retry when the first /auth/me fails", async () => {
    let up = false
    stubFetch({
        'GET /api/v1/auth/me': () => {
            if (!up) throw new TypeError('Failed to fetch')
            return ok({
                account_id: 'acc-1',
                via: 'session',
                email: 'ada@example.com',
                display_name: 'Ada Lovelace',
                workspace_id: 'ws-1',
                permissions: [],
            })
        },
        'POST /api/v1/teams/list': () => ok({ items: [], next_cursor: null, has_more: false }),
        'POST /api/v1/projects/list': () => ok({ items: [], next_cursor: null, has_more: false }),
        'POST /api/v1/tickets/list': () => ok({ items: [], next_cursor: null, has_more: false }),
        'POST /api/v1/documents/list': () => ok({ items: [], next_cursor: null, has_more: false }),
        'POST /api/v1/comments/list': () => ok({ items: [], next_cursor: null, has_more: false }),
    })
    const history = memoryHistory('/')
    const Router = createAppRouter(history)
    const { refresh } = await import('@/features/auth')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(() => <Router />)
    await refresh().catch(() => {})

    // Not a placeholder forever, and not the login screen either.
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent("Can't reach the server")
    expect(notice).not.toHaveTextContent('Loading')
    expect(session.status).toBe('unknown')
    expect(history.get()).toBe('/')
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Still no answer.')).toBeInTheDocument()

    up = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
    expect(screen.queryByText("Can't reach the server")).not.toBeInTheDocument()
    expect(session.status).toBe('authenticated')
    expect(session.loadFailure).toBeNull()
})
