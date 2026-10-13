import { screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, updateTicket, wipeLocalData } from '@/sync'
import { deferred, listRoutes, ME, page, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem } from '@/testing/fetch'
import { openApp, startAnonymous, type Routes } from '@/testing/app'

// Failures, as the user meets them: the toast, the pending indicator, the
// confirmation on log out. Session expiry is in sessionExpiry.test.tsx.

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

const nav = () => within(screen.getByRole('complementary'))

// An edit made through the store, as the ticket page would.
async function editTitle(title: string) {
    await vi.waitFor(() => expect(sync.hydrated).toBe(true))
    await updateTicket('t-1', { title })
}

describe('a server that is failing', () => {
    it('keeps the entry, says so once, and retries on demand', async () => {
        let puts = 0
        let healthy = false
        await openApp('/', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                puts += 1
                if (!healthy) return problem(500, 'internal')
                return ok(ticket({ ...(await bodyOf(request)), version: 2, updated_by: ME }))
            },
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument()

        await editTitle('Edited')

        // One message, calm: a status region, not an alert, and not styled as
        // a loss.
        const toast = await screen.findByText('Something went wrong on the server')
        expect(toast.closest('[role]')).toHaveAttribute('role', 'status')
        expect(screen.getByText('Your changes are saved here and will retry.')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        // The change is still queued, and the screen still shows it.
        expect(sync.outbox).toMatchObject([{ state: 'pending', attempts: 1 }])
        expect(screen.getByRole('link', { name: /Edited/ })).toBeInTheDocument()
        expect(puts).toBe(1)

        // Failing again does not stack a second message.
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Retry now' }))
        await vi.waitFor(() => expect(puts).toBe(2))
        await vi.waitFor(() => expect(sync.outbox[0]?.attempts).toBe(2))
        expect(screen.getAllByText('Something went wrong on the server')).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Retry now' })).toHaveLength(1)

        healthy = true
        await user.click(screen.getByRole('button', { name: 'Retry now' }))
        await vi.waitFor(() => expect(sync.outbox).toEqual([]))
        expect(puts).toBe(3)
        await vi.waitFor(() =>
            expect(screen.queryByText('Something went wrong on the server')).not.toBeInTheDocument(),
        )
    })

    it('calls an unreachable server by that name', async () => {
        await openApp('/', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        await screen.findByRole('link', { name: /Write the outbox/ })

        await editTitle('Edited')

        expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
        expect(screen.getByText('Your changes are saved here and will retry.')).toBeInTheDocument()
    })

    it('stays dismissed for that spell of trouble, and comes back for the next', async () => {
        let down = true
        await openApp('/', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                if (down) return problem(503, 'unavailable')
                return ok(ticket({ ...(await bodyOf(request)), version: 2, updated_by: ME }))
            },
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        await editTitle('One')
        await screen.findByText('Something went wrong on the server')
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Dismiss' }))
        expect(screen.queryByText('Something went wrong on the server')).not.toBeInTheDocument()
        await user.click(nav().getByRole('button', { name: /waiting/ }))
        expect(sync.outbox).toHaveLength(1)

        // The server comes back, the change goes, and the next failure is news.
        down = false
        const { retryNow } = await import('@/sync')
        retryNow()
        await vi.waitFor(() => expect(sync.outbox).toEqual([]))
        down = true
        await updateTicket('t-1', { title: 'Two' })
        expect(await screen.findByText('Something went wrong on the server')).toBeInTheDocument()
    })

    it('does not call a refused change trouble: that is the ticket page\'s to explain', async () => {
        await openApp('/', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => problem(403, 'forbidden'),
        })
        await screen.findByRole('link', { name: /Write the outbox/ })

        await editTitle('Edited')
        await vi.waitFor(() => expect(sync.outbox[0]?.state).toBe('failed'))

        expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument()
    })

    it('says it cannot reach the server when the first list fails, even with nothing queued', async () => {
        await openApp('/', {
            'POST /api/v1/teams/list': () => {
                throw new TypeError('Failed to fetch')
            },
            'POST /api/v1/projects/list': () => page([]),
            'POST /api/v1/tickets/list': () => page([]),
        })

        expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
        expect(
            screen.getByText('What you see is saved on this device. We will keep trying.'),
        ).toBeInTheDocument()
    })
})

describe('the pending-changes indicator', () => {
    const two: Routes = {
        ...listRoutes([ticket({ id: 't-1', title: 'First one' }), ticket({ id: 't-2', title: 'Second one' })]),
    }

    it('is absent when everything is synced', async () => {
        await openApp('/', listRoutes([ticket()]))
        await screen.findByRole('link', { name: /Write the outbox/ })

        expect(nav().queryByRole('button', { name: /change/ })).not.toBeInTheDocument()
    })

    it('counts changes that are waiting, and lists their tickets with links', async () => {
        const held = deferred()
        await openApp('/', {
            ...two,
            'PUT /api/v1/tickets/t-1': () => held.promise,
            'PUT /api/v1/tickets/t-2': () => held.promise,
        })
        await screen.findByRole('link', { name: /First one/ })

        await updateTicket('t-1', { title: 'First, edited' })
        await updateTicket('t-2', { title: 'Second, edited' })

        const button = await nav().findByRole('button', { name: '2 changes waiting' })
        await userEvent.setup().click(button)
        const list = nav().getByRole('list', { name: 'Changes not synced yet' })
        expect(within(list).getByRole('link', { name: 'First, edited' })).toHaveAttribute('href', '/tickets/t-1')
        expect(within(list).getByRole('link', { name: 'Second, edited' })).toHaveAttribute('href', '/tickets/t-2')
    })

    it('says "1 change waiting" in the singular', async () => {
        await openApp('/', {
            ...two,
            'PUT /api/v1/tickets/t-1': () => new Promise<Response>(() => {}),
        })
        await screen.findByRole('link', { name: /First one/ })

        await updateTicket('t-1', { title: 'Edited' })

        expect(await nav().findByRole('button', { name: '1 change waiting' })).toBeInTheDocument()
    })

    it('puts what needs a person ahead of what is merely waiting', async () => {
        await openApp('/', {
            ...two,
            'PUT /api/v1/tickets/t-1': () => problem(422, 'validation_failed', [{ location: 'body.title', message: 'bad' }]),
            'PUT /api/v1/tickets/t-2': () => new Promise<Response>(() => {}),
        })
        await screen.findByRole('link', { name: /First one/ })

        // The refused one first: sends are one at a time, and the other never answers.
        await updateTicket('t-1', { title: 'First, edited' })
        await vi.waitFor(() => expect(sync.outbox[0]?.state).toBe('failed'))
        await updateTicket('t-2', { title: 'Second, edited' })

        const button = await nav().findByRole('button', { name: '1 change needs attention' })
        await userEvent.setup().click(button)
        const items = within(nav().getByRole('list', { name: 'Changes not synced yet' })).getAllByRole('listitem')
        expect(items[0]).toHaveTextContent('First, edited')
        expect(items[0]).toHaveTextContent('Needs attention')
        expect(items[1]).toHaveTextContent('Second, edited')
    })

    it('asks for a sign-in when a 401 is what holds the changes', async () => {
        await openApp('/', {
            ...two,
            'PUT /api/v1/tickets/t-1': () => problem(401, 'unauthorized'),
        })
        await screen.findByRole('link', { name: /First one/ })

        await updateTicket('t-1', { title: 'First, edited' })
        await updateTicket('t-2', { title: 'Second, edited' })

        expect(await nav().findByRole('button', { name: 'Sign in to sync 2 changes' })).toBeInTheDocument()
    })

    it('keeps a refused archive reachable: the list links to its page, which can discard it', async () => {
        const { archiveTicket } = await import('@/sync')
        await openApp('/', {
            ...two,
            'DELETE /api/v1/tickets/t-1': () => problem(403, 'forbidden'),
        })
        await screen.findByRole('link', { name: /First one/ })
        await archiveTicket('t-1')
        await vi.waitFor(() => expect(sync.outbox[0]?.state).toBe('failed'))

        const user = userEvent.setup()
        await user.click(await nav().findByRole('button', { name: '1 change needs attention' }))
        const list = nav().getByRole('list', { name: 'Changes not synced yet' })
        await user.click(within(list).getByRole('link', { name: 'First one' }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent("You don't have permission")
        await user.click(within(alert).getByRole('button', { name: 'Discard my change' }))

        await vi.waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.getByLabelText('Title')).toHaveValue('First one')
    })
})

describe('logging out', () => {
    const loggedOut: Routes = { 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) }

    it('goes straight through when everything has synced', async () => {
        const history = await openApp('/', { ...listRoutes([ticket()]), ...loggedOut })
        await screen.findByRole('link', { name: /Write the outbox/ })

        await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }))

        await vi.waitFor(() => expect(history.get()).toBe('/login'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('asks first when changes have not synced, and keeps them if told to stay', async () => {
        const history = await openApp('/', {
            ...listRoutes([ticket()]),
            ...loggedOut,
            'PUT /api/v1/tickets/t-1': () => new Promise<Response>(() => {}),
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        await editTitle('Edited')
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Log out' }))

        const dialog = screen.getByRole('dialog', { name: 'Sign out?' })
        expect(dialog).toHaveTextContent("You have 1 change that hasn't synced. Signing out will discard it.")
        // The safe answer has focus.
        expect(within(dialog).getByRole('button', { name: 'Stay signed in' })).toHaveFocus()
        await user.click(within(dialog).getByRole('button', { name: 'Stay signed in' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(history.get()).toBe('/')
        expect(sync.outbox).toHaveLength(1)
    })

    it('discards the changes and signs out once confirmed', async () => {
        const history = await openApp('/', {
            ...listRoutes([ticket()]),
            ...loggedOut,
            'PUT /api/v1/tickets/t-1': () => new Promise<Response>(() => {}),
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        await editTitle('Edited')
        await updateTicket('t-1', { description: 'And more' })
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Log out' }))
        await user.click(screen.getByRole('button', { name: 'Sign out and discard' }))

        await vi.waitFor(() => expect(history.get()).toBe('/login'))
        expect(sync.outbox).toEqual([])
    })
})
