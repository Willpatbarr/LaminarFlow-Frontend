import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { doc, listRoutes, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

// The command palette (LAM-115) through the real route tree, with only
// `fetch` stubbed.

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

const item = (overrides: Record<string, unknown>) => ({
    type: 'ticket',
    id: 't-9',
    title: 'Server only',
    snippet: 'Server only',
    field_label: null,
    parent_type: null,
    parent_id: null,
    score: 1,
    ...overrides,
})

function world(search: (q: string) => Response | Promise<Response>, searched: string[] = []) {
    return {
        ...listRoutes(
            [ticket({ id: 't-1', title: 'Write the outbox', version: 3 }), ticket({ id: 't-2', title: 'Other work' })],
            [doc({ id: 'd-1', title: 'Design notes' })],
        ),
        'POST /api/v1/search/list': async (request: Request) => {
            const { q } = (await bodyOf(request)) as { q: string }
            searched.push(q)
            return search(q)
        },
    }
}

async function palette(routes: ReturnType<typeof world>) {
    const history = await openApp('/', routes)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Tickets', level: 1 })
    await user.keyboard('{Control>}k{/Control}')
    const dialog = within(await screen.findByRole('dialog', { name: 'Search' }))
    return { history, user, dialog, box: dialog.getByRole('combobox') }
}

describe('Command palette', () => {
    it('opens with Ctrl+K and closes with Escape, from anywhere', async () => {
        const { user } = await palette(world(() => ok({ items: [] })))
        expect(screen.getByRole('combobox')).toHaveFocus()
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument()
        await user.keyboard('{Meta>}k{/Meta}')
        expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument()
        await user.keyboard('{Control>}k{/Control}')
        expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument()
    })

    it('shows local tickets at once, finds one by title and opens it with the keyboard alone', async () => {
        const searched: string[] = []
        const { user, history, box } = await palette(world(() => ok({ items: [] }), searched))
        await user.type(box, 'outbox')
        expect(await screen.findByRole('option', { name: /Write the outbox/ })).toHaveAttribute('aria-selected', 'true')
        await user.keyboard('{Enter}')
        await waitFor(() => expect(history.get()).toBe('/tickets/t-1'))
        expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument()
    })

    it('never sends an empty query', async () => {
        const searched: string[] = []
        const { user, box } = await palette(world(() => ok({ items: [] }), searched))
        await user.type(box, '   ')
        await new Promise((r) => setTimeout(r, 300))
        expect(searched).toEqual([])
    })

    it('merges server hits, grouped, with marks and the field label, and links a comment to its parent', async () => {
        const { user, history, box, dialog } = await palette(
            world(() =>
                ok({
                    items: [
                        item({ type: 'document', id: 'd-7', title: 'Spec', snippet: 'the <mark>outbox</mark> &lt;b&gt;', field_label: 'Goal' }),
                        item({ type: 'comment', id: 'c-1', title: 'see outbox', snippet: 'see <mark>outbox</mark>', parent_type: 'ticket', parent_id: 't-2' }),
                    ],
                }),
            ),
        )
        await user.type(box, 'outbox')
        const hit = await dialog.findByRole('option', { name: /Spec/ })
        expect(hit).toHaveTextContent('Goal: the outbox <b>')
        expect(hit.querySelector('mark')?.textContent).toBe('outbox')
        expect(hit.querySelector('b')).toBeNull()
        expect(dialog.getByRole('group', { name: 'Tickets' })).toBeInTheDocument()
        expect(dialog.getByRole('group', { name: 'Documents' })).toBeInTheDocument()
        await user.keyboard('{ArrowDown}{ArrowDown}')
        expect(dialog.getByRole('option', { name: /Comment on ticket/ })).toHaveAttribute('aria-selected', 'true')
        await user.keyboard('{Enter}')
        await waitFor(() => expect(history.get()).toBe('/tickets/t-2'))
    })

    it('keeps the local results and says so when the server cannot be reached', async () => {
        const { user, box, dialog } = await palette(world(() => problem(500, 'internal')))
        await user.type(box, 'design')
        expect(await dialog.findByText(/Showing results from this device/)).toBeInTheDocument()
        expect(dialog.getByRole('option', { name: /Design notes/ })).toBeInTheDocument()
    })

    it('runs New ticket as a command', async () => {
        const { user, box } = await palette(world(() => ok({ items: [] })))
        await user.type(box, 'new tick')
        // The command only exists once the store has a project to make the
        // ticket in; Enter before then selects nothing. Wait for it, not a clock.
        await screen.findByRole('option', { name: /New ticket/ })
        await user.keyboard('{Enter}')
        expect(await screen.findByRole('dialog', { name: 'New ticket' })).toBeInTheDocument()
    })

    it('runs New document as a command: a document is made and opened', async () => {
        const routes = world(() => ok({ items: [] }))
        const { user, history, box } = await palette(routes)
        await user.type(box, 'new doc')
        await user.keyboard('{Enter}')
        await waitFor(() => expect(history.get()).toMatch(/^\/documents\/.+/))
        expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument()
    })
})
