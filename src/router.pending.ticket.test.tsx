import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import { afterEach, expect, it, vi } from 'vitest'

import { session } from '@/features/auth'
import { stubFetch } from '@/testing/fetch'

import { createAppRouter } from './router'

// router.pending.test.tsx for a deep link: its own file because the session
// store only moves away from `unknown`.
afterEach(() => {
    vi.unstubAllGlobals()
})

it('draws the ticket page\'s placeholder, not "not found" and not the login screen, while the session is unknown', () => {
    stubFetch({ 'GET /api/v1/auth/me': () => new Promise<Response>(() => {}) })
    const history = memoryHistory('/tickets/t-1')
    const Router = createAppRouter(history)

    render(() => <Router />)

    expect(session.status).toBe('unknown')
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('status')).toHaveTextContent('Loading ticket')
    expect(main.getAllByRole('status')).toHaveLength(1)
    expect(main.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
    expect(main.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(history.get()).toBe('/tickets/t-1')
})

it('says nothing at an unknown URL until the session has answered', () => {
    stubFetch({ 'GET /api/v1/auth/me': () => new Promise<Response>(() => {}) })
    const history = memoryHistory('/nowhere')
    const Router = createAppRouter(history)

    render(() => <Router />)

    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
    expect(history.get()).toBe('/nowhere')
})
