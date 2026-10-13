import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh, session } from '@/features/auth'
import { connectSyncToSession, sync, wipeLocalData } from '@/sync'
import { listRoutes, ME, page, TEAM, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'
import { ME_BODY, openApp, startAnonymous, type Routes } from '@/testing/app'

// A session that ends while the user is working: the page stays, the work
// stays, and signing in again picks up where it left off.

const OTHER_BODY = { ...ME_BODY, account_id: 'acc-2', email: 'grace@example.com', display_name: 'Grace Hopper' }

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

// A server whose cookie has expired until somebody logs in. `account` is who
// the next login signs in as.
function server(tickets = [ticket({ version: 3 })]) {
    const state = { signedIn: true, account: ME_BODY as object, puts: [] as { title: string }[] }
    const routes: Routes = {
        ...listRoutes(tickets),
        'GET /api/v1/auth/me': () => (state.signedIn ? ok(state.account) : problem(401, 'unauthorized')),
        'POST /api/v1/auth/login': () => {
            state.signedIn = true
            return ok({ account_id: (state.account as { account_id: string }).account_id })
        },
        'PUT /api/v1/tickets/t-1': async (request) => {
            const body = await bodyOf(request)
            state.puts.push(body)
            if (!state.signedIn) return problem(401, 'unauthorized')
            return ok(ticket({ ...body, version: 3 + state.puts.length, updated_by: ME }))
        },
    }
    return { state, routes }
}

async function expire(title = 'Edited while signed out') {
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Title')
    await user.clear(field)
    await user.type(field, title)
    await user.tab()
    return field
}

describe('the session ending mid-action', () => {
    it('keeps the page and the edit, shows the banner, and syncs after signing in as the same account', async () => {
        const { state, routes } = server()
        const history = await openApp('/tickets/t-1', routes)
        const user = userEvent.setup()
        state.signedIn = false
        const field = await expire()

        const banner = await screen.findByText(/You've been signed out/)
        expect(banner.closest('[role]')).toHaveAttribute('role', 'status')
        expect(banner).toHaveTextContent('Your changes are saved on this device and will sync when you sign back in.')
        // Nowhere else: same route, same screen, same text.
        expect(history.get()).toBe('/tickets/t-1')
        expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
        expect(field).toHaveValue('Edited while signed out')
        expect(session.status).toBe('authenticated')
        await waitFor(() => expect(sync.outbox).toMatchObject([{ state: 'unauthorized' }]))
        expect(await within(screen.getByRole('complementary')).findByRole('button', { name: 'Sign in to sync 1 change' })).toBeInTheDocument()
        expect(state.puts).toHaveLength(1)

        // The inline form: email is already there.
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        const email = screen.getByLabelText('Email')
        expect(email).toHaveValue('ada@example.com')
        expect(screen.getByLabelText('Password')).toHaveFocus()
        await user.type(screen.getByLabelText('Password'), 'correct horse battery')
        await user.keyboard('{Enter}')

        await waitFor(() => expect(screen.queryByText(/You've been signed out/)).not.toBeInTheDocument())
        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(state.puts).toHaveLength(2)
        expect(state.puts[1].title).toBe('Edited while signed out')
        expect(history.get()).toBe('/tickets/t-1')
        expect(field).toHaveValue('Edited while signed out')
        expect(session.expired).toBe(false)
        await waitFor(() =>
            expect(within(screen.getByRole('complementary')).queryByRole('button', { name: /change/ })).not.toBeInTheDocument(),
        )
    })

    it('shows a wrong password where the form is, and leaves the banner', async () => {
        const { state, routes } = server()
        await openApp('/tickets/t-1', {
            ...routes,
            'POST /api/v1/auth/login': () => problem(401, 'invalid_login'),
        })
        state.signedIn = false
        await expire()
        await screen.findByText(/You've been signed out/)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await user.type(screen.getByLabelText('Password'), 'wrong')
        await user.keyboard('{Enter}')

        expect(await screen.findByText('That email and password do not match.')).toBeInTheDocument()
        expect(screen.getByText(/You've been signed out/)).toBeInTheDocument()
        expect(sync.outbox).toMatchObject([{ state: 'unauthorized' }])
    })

    it('says so when the sign-in cannot reach the server', async () => {
        const { state, routes } = server()
        await openApp('/tickets/t-1', {
            ...routes,
            'POST /api/v1/auth/login': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        state.signedIn = false
        await expire()
        await screen.findByText(/You've been signed out/)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await user.type(screen.getByLabelText('Password'), 'whatever')
        await user.keyboard('{Enter}')

        expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    })

    it("as a different account: the old account's data is gone and its outbox is never sent", async () => {
        const { state, routes } = server()
        const history = await openApp('/tickets/t-1', {
            ...routes,
            // What the new account's lists hold.
            'POST /api/v1/tickets/list': () =>
                state.account === ME_BODY
                    ? page([ticket({ version: 3 })])
                    : page([ticket({ id: 't-9', title: "Grace's ticket", updated_by: 'acc-2' })]),
        })
        state.signedIn = false
        await expire()
        await screen.findByText(/You've been signed out/)
        expect(state.puts).toHaveLength(1)
        const user = userEvent.setup()

        state.account = OTHER_BODY
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        const email = screen.getByLabelText('Email')
        await user.clear(email)
        await user.type(email, 'grace@example.com')
        await user.type(screen.getByLabelText('Password'), 'correct horse battery')
        await user.keyboard('{Enter}')

        // Their own tickets, on the list, and none of Ada's edit anywhere.
        await waitFor(() => expect(history.get()).toBe('/'))
        expect(await screen.findByRole('link', { name: /Grace's ticket/ })).toBeInTheDocument()
        expect(screen.queryByText(/Edited while signed out/)).not.toBeInTheDocument()
        expect(sync.outbox).toEqual([])
        expect(sync.tickets.map((t) => t.title)).toEqual(["Grace's ticket"])
        expect(screen.queryByText(/You've been signed out/)).not.toBeInTheDocument()
        // Nothing was sent for the old account after the first, refused, attempt.
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(state.puts).toHaveLength(1)
        expect(session.me?.account_id).toBe('acc-2')
    })

    it('a refused first-run call also asks for a sign-in, and says so on the form', async () => {
        const none = () => page([])
        let signedIn = true
        await openApp('/', {
            'POST /api/v1/teams/list': none,
            'POST /api/v1/projects/list': none,
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/teams': () => (signedIn ? ok(TEAM) : problem(401, 'unauthorized')),
        })
        signedIn = false
        const user = userEvent.setup()

        await user.click(await screen.findByRole('button', { name: 'Create team and project' }))

        expect(await screen.findByText(/You've been signed out. Sign in from the banner above/)).toBeInTheDocument()
        expect(await screen.findByText(/Your changes are saved on this device/)).toBeInTheDocument()
        })
})

describe('arriving without a session', () => {
  it('still goes to the login screen, with no banner', async () => {
    const history = await openApp('/tickets/t-1', listRoutes([ticket()]))
    stubFetch({ 'GET /api/v1/auth/me': () => problem(401, 'unauthorized') })

    await refresh()

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(history.get()).toBe('/login?returnTo=%2Ftickets%2Ft-1')
    expect(screen.queryByText(/You've been signed out/)).not.toBeInTheDocument()
  })

  it('keeps unsynced work through the redirect and sends it after signing in as the same account', async () => {
    const { state, routes } = server()
    const history = await openApp('/tickets/t-1', routes)
    state.signedIn = false
    await expire()
    await screen.findByText(/You've been signed out/)

    // The tab is reloaded: the cookie is dead, so /auth/me says nobody.
    await refresh()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(history.get()).toBe('/login?returnTo=%2Ftickets%2Ft-1')
    expect(session.status).toBe('anonymous')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(history.get()).toBe('/tickets/t-1'))
    await waitFor(() => expect(state.puts).toHaveLength(2))
    expect(state.puts[1].title).toBe('Edited while signed out')
    await waitFor(() => expect(sync.outbox).toEqual([]))
    expect(await screen.findByLabelText('Title')).toHaveValue('Edited while signed out')
  })

  it("does not carry another account's unsynced work into a new sign-in", async () => {
    const { state, routes } = server()
    await openApp('/tickets/t-1', routes)
    state.signedIn = false
    await expire()
    await screen.findByText(/You've been signed out/)
    await refresh()
    await screen.findByRole('heading', { name: 'Sign in' })

    state.account = OTHER_BODY
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'grace@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(session.me?.account_id).toBe('acc-2'))
    await waitFor(() => expect(sync.active).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sync.outbox).toEqual([])
    expect(state.puts).toHaveLength(1)
  })
})

