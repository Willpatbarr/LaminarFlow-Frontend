import { memoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh, session } from '@/features/auth'
import { ok, problem, stubFetch } from '@/testing/fetch'

import { createAppRouter } from './router'

const me = {
    account_id: 'acc-1',
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ['ticket:write'],
}

const loggedOut = () => problem(401, 'unauthorized')

// The real route tree, started at `url`. The history is returned so a test can
// read where the app ended up without poking at router internals.
function mount(url: string) {
    const history = memoryHistory(url)
    const Router = createAppRouter(history)
    render(() => <Router />)
    return history
}

// The store is module state: every test starts from "the server says nobody".
async function startAnonymous() {
    stubFetch({ 'GET /api/v1/auth/me': loggedOut })
    await refresh()
}

async function startSignedIn() {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
    await refresh()
}

async function signIn() {
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('protected routes', () => {
    beforeEach(startAnonymous)

    it('sends an anonymous deep link to login, then back to it after signing in', async () => {
        const history = mount('/missing/42?tab=comments')

        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
        expect(history.get()).toBe('/login?returnTo=%2Fmissing%2F42%3Ftab%3Dcomments')
        // Nothing of the app shell is shown to someone who is not signed in.
        expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()

        stubFetch({
            'POST /api/v1/auth/login': () => ok({ account_id: 'acc-1' }),
            'GET /api/v1/auth/me': () => ok(me),
        })
        await signIn()

        expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
        expect(history.get()).toBe('/missing/42?tab=comments')
    })

    it('keeps the plain login URL when the user was only heading home', async () => {
        const history = mount('/')

        await screen.findByRole('heading', { name: 'Sign in' })
        expect(history.get()).toBe('/login')
    })

    it('ignores an absolute returnTo after login', async () => {
        const history = mount('/login?returnTo=https%3A%2F%2Fevil.example')
        await screen.findByRole('heading', { name: 'Sign in' })

        stubFetch({
            'POST /api/v1/auth/login': () => ok({ account_id: 'acc-1' }),
            'GET /api/v1/auth/me': () => ok(me),
        })
        await signIn()

        expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
        expect(history.get()).toBe('/')
    })

    it('ignores a protocol-relative returnTo after login', async () => {
        const history = mount('/login?returnTo=%2F%2Fevil.example')
        await screen.findByRole('heading', { name: 'Sign in' })

        stubFetch({
            'POST /api/v1/auth/login': () => ok({ account_id: 'acc-1' }),
            'GET /api/v1/auth/me': () => ok(me),
        })
        await signIn()

        await screen.findByRole('heading', { name: 'Tickets' })
        expect(history.get()).toBe('/')
    })

    it('carries returnTo across to sign-up', async () => {
        mount('/login?returnTo=%2Fmissing%2F42')

        const link = await screen.findByRole('link', { name: 'Sign up' })

        expect(link).toHaveAttribute('href', '/signup?returnTo=%2Fmissing%2F42')
    })
})

describe('login screens when already signed in', () => {
    beforeEach(startSignedIn)

    it('send /login to home', async () => {
        const history = mount('/login')

        expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
        expect(history.get()).toBe('/')
    })

    it('send /login to a valid returnTo', async () => {
        const history = mount('/login?returnTo=%2Fmissing%2F42')

        expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
        expect(history.get()).toBe('/missing/42')
    })

    it('send /signup to home, and refuse an off-site returnTo there too', async () => {
        const history = mount('/signup?returnTo=https%3A%2F%2Fevil.example')

        expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
        expect(history.get()).toBe('/')
    })
})

describe('app shell', () => {
    beforeEach(startSignedIn)

    it('shows the signed-in user and a link to every section', async () => {
        mount('/')

        await screen.findByRole('heading', { name: 'Tickets' })
        const nav = screen.getByRole('navigation', { name: 'Main' })
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
        expect(nav.querySelectorAll('a')).toHaveLength(6)
        expect(screen.getByRole('link', { name: 'Epics' })).toHaveAttribute('href', '/epics')
        expect(screen.getByRole('link', { name: 'Sprints' })).toHaveAttribute('href', '/sprints')
        expect(screen.getByRole('link', { name: 'Milestones' })).toHaveAttribute('href', '/milestones')
        expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
        expect(screen.getByRole('link', { name: 'Views' })).toHaveAttribute('href', '/views')
        expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/')
        expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('aria-current', 'page')
    })
})

describe('section routes', () => {
    beforeEach(startSignedIn)

    it.each([
        ['/documents', 'Documents'],
        ['/views', 'Views'],
    ])('%s is reachable by URL', async (url, heading) => {
        mount(url)

        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    })

    // The document page waits for the store (none is running here), so it is
    // reached when its way back is there; the page itself is documents.test.tsx.
    it('/documents/d1 is reachable by URL', async () => {
        mount('/documents/d1')

        expect(await screen.findByRole('link', { name: '← Documents' })).toBeInTheDocument()
    })
})

describe('logout', () => {
    beforeEach(startSignedIn)

    it('clears the session and lands on login', async () => {
        const history = mount('/')
        await screen.findByRole('heading', { name: 'Tickets' })
        stubFetch({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) })

        await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }))

        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
        expect(session.status).toBe('anonymous')
        expect(session.me).toBeNull()
        expect(history.get()).toBe('/login')
    })

    it('still ends at login, without a returnTo, when the request fails with a network error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const history = mount('/missing/42')
        await screen.findByRole('heading', { name: 'Page not found' })
        stubFetch({
            'POST /api/v1/auth/logout': () => {
                throw new TypeError('Failed to fetch')
            },
        })

        await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }))

        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
        await vi.waitFor(() => expect(history.get()).toBe('/login'))
        expect(session.status).toBe('anonymous')
        expect(session.me).toBeNull()
    })
})
