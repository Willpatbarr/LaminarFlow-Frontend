import { cleanup, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    archiveTicket,
    connectSyncToSession,
    stopSync,
    sync,
    updateTicket,
    wipeLocalData,
    type Ticket,
} from '@/sync'
import { listRoutes, ME, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

// A change that lost to someone else's, as the ticket page, the list and the
// pending indicator show it - through the real route tree, store and engine,
// with only `fetch` stubbed.

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
const main = () => within(screen.getByRole('main'))
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function conflictResponse(
    code: 'ticket_conflict' | 'ticket_archived',
    current: Ticket,
    by: { account_id: string; display_name: string } | null = { account_id: 'acc-sarah', display_name: 'Sarah' },
    minutes = 2,
) {
    return new Response(
        JSON.stringify({ title: 'Conflict', status: 409, code, current, changed_by: by, changed_at: ago(minutes) }),
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    )
}

const theirs = (overrides: Partial<Ticket> = {}) =>
    ticket({ title: 'Theirs', description: 'Their words', version: 5, updated_by: 'acc-sarah', ...overrides })

// A ticket the user edits through the page; the server answers `answers` in
// order, then the last of them again.
async function openConflicted(
    answers: (() => Response)[],
    { url = '/tickets/t-1', extra = {} }: { url?: string; extra?: Parameters<typeof openApp>[1] } = {},
) {
    const puts: { ifMatch: string | null; body: Record<string, unknown> }[] = []
    const posts: Record<string, unknown>[] = []
    const history = await openApp(url, {
        ...listRoutes([ticket({ version: 3, description: 'Old words' })]),
        'PUT /api/v1/tickets/t-1': async (request) => {
            puts.push({ ifMatch: request.headers.get('If-Match'), body: await bodyOf(request) })
            return (answers[Math.min(puts.length, answers.length) - 1] ?? answers.at(-1)!)()
        },
        'POST /api/v1/tickets': async (request) => {
            const body = await bodyOf(request)
            posts.push(body)
            return ok(ticket({ ...body, id: 't-new', version: 1, updated_by: ME }))
        },
        ...extra,
    })
    return { puts, posts, history }
}

async function typeTitle(value: string) {
    const user = userEvent.setup()
    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.type(title, value)
    await user.tab()
    return { user, title }
}

const panel = () => screen.findByRole('region', { name: 'This ticket needs a decision' })

describe('an edit that lost to someone else\'s', () => {
    it('says what happened, shows only what differs, and keeps the work on screen', async () => {
        await openConflicted([() => conflictResponse('ticket_conflict', theirs({ description: 'Old words' }))])
        const { title } = await typeTitle('Mine')

        const region = await panel()
        expect(region).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')
        expect(region).toHaveTextContent("Your change hasn't been saved to the server. It's still here.")
        expect(within(region).getByText('2 minutes ago')).toHaveAttribute('datetime')
        // Not an error: no alert anywhere, and the marker names the decision.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(main().getByText('Needs a decision: someone else changed this ticket')).toBeInTheDocument()
        // Title differs; the description is the same on both sides, so it is not listed.
        const fields = within(within(region).getByRole('group', { name: 'What differs' }))
        expect(fields.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Title'])
        expect(fields.getByText('Mine')).toBeInTheDocument()
        expect(fields.getByText('Theirs')).toBeInTheDocument()
        // The page still shows the user's version.
        expect(title).toHaveValue('Mine')
        expect(sync.outbox).toMatchObject([{ state: 'conflict' }])
    })

    it('makes the fields read-only while it is undecided, and says so', async () => {
        await openConflicted([() => conflictResponse('ticket_conflict', theirs())])
        await typeTitle('Mine')
        const region = await panel()

        expect(within(region).getByText(/Editing is paused until you decide/)).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
        expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('aria-readonly', 'true')
        expect(screen.getByLabelText('Status')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Assign to me' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Archive ticket' })).toBeDisabled()

        // Typing does nothing.
        await userEvent.setup().type(screen.getByLabelText('Title'), 'more')
        expect(screen.getByLabelText('Title')).toHaveValue('Mine')
    })

    it('keeps theirs after confirming, because words would be lost; focus and a status message follow', async () => {
        await openConflicted([() => conflictResponse('ticket_conflict', theirs())])
        const { user, title } = await typeTitle('Mine')
        const region = await panel()

        await user.click(within(region).getByRole('button', { name: 'Keep theirs' }))
        const dialog = screen.getByRole('dialog')
        expect(sync.outbox).toHaveLength(1)
        await user.click(within(dialog).getByRole('button', { name: 'Keep theirs' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.queryByRole('region', { name: 'This ticket needs a decision' })).not.toBeInTheDocument()
        expect(title).toHaveValue('Theirs')
        expect(title).not.toHaveAttribute('readonly')
        // The store shows the result a moment before the handler gets to say so.
        const message = await main().findByText('Kept their version. Your change was discarded.')
        expect(message).toHaveAttribute('aria-live', 'polite')
        await waitFor(() => expect(title).toHaveFocus())
    })

    it('keeps theirs without asking when only a status differs', async () => {
        await openConflicted([() => conflictResponse('ticket_conflict', theirs({ title: 'Write the outbox', description: 'Old words' }))])
        await screen.findByLabelText('Title')
        await vi.waitFor(() => expect(sync.hydrated).toBe(true))
        await updateTicket('t-1', { status_id: 's-done' })
        const region = await panel()
        expect(within(region).getByText('Done')).toBeInTheDocument()

        await userEvent.setup().click(within(region).getByRole('button', { name: 'Keep theirs' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.getByLabelText('Status')).toHaveValue('s-todo')
    })

    it('uses mine: resends on their version, then the page is editable again', async () => {
        const { puts } = await openConflicted([
            () => conflictResponse('ticket_conflict', theirs()),
            () => ok(ticket({ title: 'Mine', description: 'Old words', version: 6, updated_by: ME })),
        ])
        const { user, title } = await typeTitle('Mine')
        const region = await panel()
        expect(within(region).getByRole('button', { name: 'Use mine' })).toHaveAccessibleDescription(
            'Use mine replaces their change with yours.',
        )

        await user.click(within(region).getByRole('button', { name: 'Use mine' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(puts.map((put) => put.ifMatch)).toEqual(['"3"', '"5"'])
        expect(puts[1].body).toMatchObject({ title: 'Mine' })
        expect(screen.queryByRole('region', { name: 'This ticket needs a decision' })).not.toBeInTheDocument()
        expect(title).toHaveValue('Mine')
        expect(title).not.toHaveAttribute('readonly')
        expect(await main().findByText('Saved. Your version replaced theirs.')).toBeInTheDocument()
        await waitFor(() => expect(title).toHaveFocus())
    })

    it('updates the panel when "use mine" collides again', async () => {
        await openConflicted([
            () => conflictResponse('ticket_conflict', theirs({ title: 'Theirs' })),
            () =>
                conflictResponse(
                    'ticket_conflict',
                    theirs({ title: 'Theirs, again', version: 6 }),
                    { account_id: 'acc-maria', display_name: 'Maria' },
                    1,
                ),
        ])
        const { user } = await typeTitle('Mine')
        let region = await panel()
        expect(region).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')

        await user.click(within(region).getByRole('button', { name: 'Use mine' }))

        await waitFor(() => expect(main().getByText(/Maria edited this ticket/)).toBeInTheDocument())
        region = await panel()
        expect(region).toHaveTextContent('Maria edited this ticket 1 minute ago.')
        expect(within(region).getByText('Theirs, again')).toBeInTheDocument()
        expect(sync.outbox).toMatchObject([{ state: 'conflict', conflict: { current: { version: 6 } } }])
        expect(
            await main().findByText("That didn't go through: the ticket changed again. Your version still hasn't been saved."),
        ).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
    })

    it('keeps mine as a new ticket in the same project, and goes to it', async () => {
        const { posts, history } = await openConflicted([() => conflictResponse('ticket_conflict', theirs())])
        const { user } = await typeTitle('Mine')
        const region = await panel()

        await user.click(within(region).getByRole('button', { name: 'Keep mine as a new ticket' }))

        await waitFor(() => expect(posts).toHaveLength(1))
        expect(posts[0]).toMatchObject({ project_id: 'p-1', title: 'Mine' })
        await waitFor(() => expect(history.get()).toBe('/tickets/t-new'))
        // The new page: their words, not marked as a copy; the original is back to theirs.
        expect(await screen.findByLabelText('Title')).toHaveValue('Mine')
        expect(screen.queryByRole('region', { name: 'This ticket needs a decision' })).not.toBeInTheDocument()
        const message = await main().findByText('Saved your version as a new ticket. The original is back to their version.')
        await waitFor(() => expect(message).toHaveFocus())
        expect(sync.tickets.find((found) => found.id === 't-1')).toMatchObject({ title: 'Theirs' })
        await waitFor(() => expect(sync.outbox).toEqual([]))
    })
})

describe('a ticket that was archived underneath an edit', () => {
    const archivedAnswer = () => conflictResponse('ticket_archived', theirs({ title: 'Theirs' }))

    it('shows their version read-only, offers no "Use mine", and is reachable', async () => {
        await openConflicted([archivedAnswer])
        await typeTitle('Mine')

        const region = await panel()
        expect(region).toHaveTextContent('Sarah archived this ticket 2 minutes ago.')
        expect(within(region).getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Discard my change',
            'Keep mine as a new ticket',
        ])
        expect(within(region).getByText('Theirs')).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
    })

    it('can be opened from the pending indicator after the page was left', async () => {
        await openConflicted([archivedAnswer])
        await typeTitle('Mine')
        await panel()
        const user = userEvent.setup()
        await user.click(screen.getByRole('link', { name: '← Tickets' }))

        await user.click(await nav().findByRole('button', { name: '1 change needs a decision' }))
        await user.click(within(nav().getByRole('list', { name: 'Changes not synced yet' })).getByRole('link', { name: 'Mine' }))

        expect(await panel()).toHaveTextContent('Sarah archived this ticket')
        expect(screen.getByLabelText('Title')).toHaveValue('Mine')
    })

    it('discards the change after confirming; the ticket is gone, and the page says so', async () => {
        await openConflicted([archivedAnswer])
        const { user } = await typeTitle('Mine')
        const region = await panel()

        await user.click(within(region).getByRole('button', { name: 'Discard my change' }))
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard my change' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument()
        const message = await main().findByText("Discarded your change. The ticket was archived, so it's no longer in your list.")
        await waitFor(() => expect(message).toHaveFocus())
        expect(sync.tickets).toEqual([])
    })

    it('keeps mine as a new ticket; the original stays archived', async () => {
        const { posts, history } = await openConflicted([archivedAnswer])
        const { user } = await typeTitle('Mine')
        const region = await panel()

        await user.click(within(region).getByRole('button', { name: 'Keep mine as a new ticket' }))

        await waitFor(() => expect(posts).toHaveLength(1))
        expect(posts[0]).toMatchObject({ project_id: 'p-1', title: 'Mine', description: 'Old words' })
        await waitFor(() => expect(history.get()).toBe('/tickets/t-new'))
        expect(await screen.findByLabelText('Title')).toHaveValue('Mine')
        expect(main().getByText('Saved your version as a new ticket. The original stays archived.')).toBeInTheDocument()
        expect(sync.tickets.map((found) => found.id)).toEqual(['t-new'])
    })
})

describe('an archive that collided with an edit', () => {
    const edited = () => conflictResponse('ticket_conflict', theirs({ title: 'Edited meanwhile' }))

    async function openArchived(answers: (() => Response)[]) {
        const deletes: (string | null)[] = []
        const opened = await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'DELETE /api/v1/tickets/t-1': () => {
                deletes.push(null)
                return (answers[Math.min(deletes.length, answers.length) - 1] ?? answers.at(-1)!)()
            },
        })
        await screen.findByLabelText('Title')
        await vi.waitFor(() => expect(sync.hydrated).toBe(true))
        await archiveTicket('t-1')
        return { deletes, opened }
    }

    it('keeps the ticket page reachable, with their version, instead of "not found"', async () => {
        await openArchived([edited])

        const region = await panel()
        expect(region).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')
        expect(region).toHaveTextContent('You archived this ticket.')
        expect(within(region).getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Keep theirs',
            'Archive anyway',
        ])
        expect(screen.getByLabelText('Title')).toHaveValue('Edited meanwhile')
        expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
        expect(screen.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
    })

    it('keeps theirs: the archive is dropped and the ticket is editable', async () => {
        await openArchived([edited])
        const region = await panel()

        await userEvent.setup().click(within(region).getByRole('button', { name: 'Keep theirs' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.getByLabelText('Title')).not.toHaveAttribute('readonly')
        expect(screen.getByLabelText('Title')).toHaveValue('Edited meanwhile')
    })

    it('archives anyway: leaves for the list, and the ticket is gone', async () => {
        const { deletes, opened } = await openArchived([edited, () => new Response(null, { status: 204 })])
        const region = await panel()

        await userEvent.setup().click(within(region).getByRole('button', { name: 'Archive anyway' }))

        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(deletes).toHaveLength(2)
        expect(opened.get()).toBe('/')
        expect(sync.tickets).toEqual([])
    })
})

describe('an inline edit in the list that lost to someone else\'s', () => {
    async function conflictedInList() {
        await openConflicted(
            [
                () => conflictResponse('ticket_conflict', theirs({ description: 'Old words' })),
                () => ok(ticket({ title: 'Mine', version: 6, updated_by: ME })),
            ],
            { url: '/' },
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Edit Write the outbox' }))
        const title = screen.getByLabelText('Title')
        await user.clear(title)
        await user.type(title, 'Mine{Enter}')
        return user
    }

    it('shows the same panel under the row, and locks the row until it is decided', async () => {
        await conflictedInList()

        const region = await panel()
        expect(region).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')
        expect(screen.getByRole('button', { name: 'Edit Mine' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Archive Mine' })).toBeDisabled()
    })

    it('"Use mine" resends it on their version from the list', async () => {
        const user = await conflictedInList()
        const region = await panel()

        await user.click(within(region).getByRole('button', { name: 'Use mine' }))

        await waitFor(() => expect(screen.queryByRole('region', { name: 'This ticket needs a decision' })).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Edit Mine' })).toBeEnabled()
        await waitFor(() => expect(sync.outbox).toEqual([]))
    })
})

describe('the rest of the app', () => {
    it('counts conflicts in the indicator as decisions, and links to each ticket', async () => {
        await openApp('/', {
            ...listRoutes([ticket({ id: 't-1', title: 'First' }), ticket({ id: 't-2', title: 'Second' })]),
            'PUT /api/v1/tickets/t-1': () => conflictResponse('ticket_conflict', theirs({ id: 't-1' })),
            'PUT /api/v1/tickets/t-2': () => conflictResponse('ticket_conflict', theirs({ id: 't-2' }), null),
        })
        await screen.findByRole('link', { name: /First/ })
        await updateTicket('t-1', { title: 'First, mine' })
        await vi.waitFor(() => expect(sync.outbox[0]?.state).toBe('conflict'))
        await updateTicket('t-2', { title: 'Second, mine' })
        await vi.waitFor(() => expect(sync.outbox.map((entry) => entry.state)).toEqual(['conflict', 'conflict']))

        const button = await nav().findByRole('button', { name: '2 changes need a decision' })
        const user = userEvent.setup()
        await user.click(button)
        const items = within(nav().getByRole('list', { name: 'Changes not synced yet' })).getAllByRole('listitem')
        expect(items[0]).toHaveTextContent('First, mine')
        expect(items[0]).toHaveTextContent('Needs a decision')
        expect(items[0]).not.toHaveTextContent(/error|attention/i)
        expect(within(items[0]).getByRole('link', { name: 'First, mine' })).toHaveAttribute('href', '/tickets/t-1')
        expect(within(items[1]).getByRole('link', { name: 'Second, mine' })).toHaveAttribute('href', '/tickets/t-2')
    })

    it('says "1 change needs a decision" for one, and keeps a refusal apart from it', async () => {
        await openApp('/', {
            ...listRoutes([ticket({ id: 't-1', title: 'First' }), ticket({ id: 't-2', title: 'Second' })]),
            'PUT /api/v1/tickets/t-1': () => conflictResponse('ticket_conflict', theirs({ id: 't-1' })),
            'PUT /api/v1/tickets/t-2': () =>
                problem(422, 'validation_failed', [{ location: 'body.title', message: 'bad' }]),
        })
        await screen.findByRole('link', { name: /First/ })
        await updateTicket('t-1', { title: 'First, mine' })
        expect(await nav().findByRole('button', { name: '1 change needs a decision' })).toBeInTheDocument()

        await updateTicket('t-2', { title: 'Second, mine' })
        expect(
            await nav().findByRole('button', { name: '1 change needs attention, 1 needs a decision' }),
        ).toBeInTheDocument()
    })

    it('marks the list row as needing a decision, not as an error', async () => {
        await openApp('/', {
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => conflictResponse('ticket_conflict', theirs()),
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        await updateTicket('t-1', { title: 'Mine' })

        const row = await screen.findByRole('link', { name: /Mine/ })
        const marker = await within(row).findByRole('img', { name: /Needs a decision/ })
        expect(marker).toHaveAttribute('aria-label', 'Needs a decision: someone else changed this ticket')
        expect(marker.parentElement).toHaveAttribute('data-state', 'conflict')
    })

    it('marks a ticket whose archive collided as a decision about the archive', async () => {
        await openApp('/', {
            ...listRoutes([ticket()]),
            'DELETE /api/v1/tickets/t-1': () => conflictResponse('ticket_conflict', theirs()),
        })
        await screen.findByRole('link', { name: /Write the outbox/ })
        await archiveTicket('t-1')

        const row = await screen.findByRole('link', { name: /Theirs/ })
        expect(
            await within(row).findByRole('img', { name: /Needs a decision: .* before you archived it/ }),
        ).toBeInTheDocument()
    })

    it('survives a reload: the same decision is waiting, and nothing was sent again', async () => {
        const { puts } = await openConflicted([() => conflictResponse('ticket_conflict', theirs())])
        await typeTitle('Mine')
        await panel()
        expect(puts).toHaveLength(1)

        // A reload: the page and every in-memory thing goes; IndexedDB stays.
        cleanup()
        disconnect()
        await stopSync()
        expect(sync.outbox).toEqual([])
        disconnect = connectSyncToSession()
        const second = await openConflicted([() => conflictResponse('ticket_conflict', theirs())])

        const region = await panel()
        expect(region).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')
        expect(screen.getByLabelText('Title')).toHaveValue('Mine')
        expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
        expect(sync.outbox).toMatchObject([{ state: 'conflict' }])
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(second.puts).toHaveLength(0)
    })
})
