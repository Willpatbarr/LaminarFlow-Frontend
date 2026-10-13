import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
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

it('renders the shell in its loading state, not the login screen, until /auth/me answers', async () => {
    let answer!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => (answer = resolve))
    stubFetch({ 'GET /api/v1/auth/me': () => pending })
    const history = memoryHistory('/')
    const Router = createAppRouter(history)
    const { refresh } = await import('@/features/auth')

    render(() => <Router />)
    const asking = refresh()

    expect(session.status).toBe('unknown')

    // The rail is drawn as a placeholder: its own busy state and message, and
    // nothing to click.
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const rail = nav.closest('aside') as HTMLElement
    expect(rail).toHaveAttribute('aria-busy', 'true')
    expect(within(rail).getByRole('status')).toHaveTextContent('Loading navigation')
    expect(within(rail).queryByRole('link')).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()

    // The routed page is in its own loading state: exactly one status in the
    // main area, and no tickets, no ticket links, no "new ticket" to press.
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('status')).toHaveTextContent('Loading tickets')
    expect(main.getAllByRole('status')).toHaveLength(1)
    expect(main.queryByRole('link')).not.toBeInTheDocument()
    expect(main.getByRole('button', { name: 'New ticket' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
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

    // The rail has its user and its links, and the page has moved on to its own
    // state (nothing has been synced here, so that is its loading state until
    // the first list lands).
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(rail).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('link', { name: 'Tickets' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
    expect(history.get()).toBe('/')
})
