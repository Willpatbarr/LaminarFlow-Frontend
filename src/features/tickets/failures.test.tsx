import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, updateTicket, wipeLocalData } from '@/sync'
import { listRoutes, ME, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem } from '@/testing/fetch'
import { openApp, startAnonymous } from '@/testing/app'

// A change the server refuses, as the ticket page and the list show it.

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

describe('a validation failure on an outbox entry', () => {
    it('marks the field with the server\'s message, keeps the text, and sends again when it is edited', async () => {
        const puts: { ifMatch: string | null; title: string }[] = []
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                puts.push({ ifMatch: request.headers.get('If-Match'), title: body.title })
                if (puts.length === 1) {
                    return problem(422, 'validation_failed', [
                        { location: 'body.title', message: 'expected length <= 10' },
                    ])
                }
                return ok(ticket({ ...body, version: 4, updated_by: ME }))
            },
        })
        const user = userEvent.setup()
        const title = await screen.findByLabelText('Title')

        await user.clear(title)
        await user.type(title, 'Far too long a title')
        await user.tab()

        const message = "The server didn't accept this title: expected length <= 10."
        expect(await screen.findByText(message)).toBeInTheDocument()
        // At the field, as its description, and the text is exactly theirs.
        expect(title).toHaveAttribute('aria-invalid', 'true')
        expect(title).toHaveAccessibleDescription(message)
        expect(title).toHaveValue('Far too long a title')
        expect(screen.getByRole('alert')).toHaveTextContent('Fix the marked field and it will send again.')
        expect(screen.getByLabelText('Description')).not.toHaveAttribute('aria-invalid')
        expect(sync.outbox).toMatchObject([{ state: 'failed' }])
        // Nothing keeps retrying a request that will get the same answer.
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(puts).toHaveLength(1)
        expect(
            within(screen.getByRole('complementary')).getByRole('button', { name: '1 change needs attention' }),
        ).toBeInTheDocument()

        await user.clear(title)
        await user.type(title, 'Short')
        await user.tab()

        await waitFor(() => expect(puts).toHaveLength(2))
        expect(puts[1]).toEqual({ ifMatch: '"3"', title: 'Short' })
        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.queryByText(message)).not.toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(title).not.toHaveAttribute('aria-invalid')
        expect(title).toHaveValue('Short')
    })

    it('puts what it cannot place on a field in a message of the form\'s own', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () =>
                problem(422, 'validation_failed', [
                    { location: 'body.description', message: 'is too long' },
                    { location: 'body.something_new', message: 'is odd' },
                ]),
        })
        await screen.findByLabelText('Title')
        await updateTicket('t-1', { description: 'x'.repeat(5) })

        expect(await screen.findByText("The server didn't accept this description: is too long.")).toBeInTheDocument()
        expect(screen.getByText('Also: is odd.')).toBeInTheDocument()
        expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid', 'true')
    })
})

describe('a failure that is not about a field', () => {
    it('explains a 403 in plain words and offers to discard the change', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () => problem(403, 'forbidden'),
        })
        const user = userEvent.setup()
        const title = await screen.findByLabelText('Title')
        await user.clear(title)
        await user.type(title, 'Not allowed')
        await user.tab()

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent("You don't have permission to make this change, so it was not saved.")
        // No field is blamed.
        expect(title).not.toHaveAttribute('aria-invalid')
        expect(title).toHaveValue('Not allowed')

        await user.click(within(alert).getByRole('button', { name: 'Discard my change' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(title).toHaveValue('Write the outbox')
    })

    it('explains a 404 the same way', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => problem(404, 'ticket_not_found'),
        })
        await screen.findByLabelText('Title')
        await updateTicket('t-1', { title: 'Gone' })

        expect(await screen.findByRole('alert')).toHaveTextContent('no longer available')
        expect(screen.getByRole('button', { name: 'Discard my change' })).toBeInTheDocument()
    })
})

describe('the list', () => {
    it('marks a refused row and links it to its ticket page', async () => {
        await openApp('/', {
            ...listRoutes([ticket({ id: 't-1', title: 'Refused' }), ticket({ id: 't-2', title: 'Fine' })]),
            'PUT /api/v1/tickets/t-1': () => problem(403, 'forbidden'),
        })
        await screen.findByRole('link', { name: /Refused/ })
        await updateTicket('t-1', { description: 'changed' })

        const row = await screen.findByRole('link', { name: /Refused/ })
        expect(await within(row).findByRole('img', { name: /the server refused this change/ })).toBeInTheDocument()
        expect(row).toHaveAttribute('href', '/tickets/t-1')
        expect(
            within(screen.getByRole('link', { name: /Fine/ })).queryByRole('img', { name: /Not synced/ }),
        ).not.toBeInTheDocument()
    })
})
