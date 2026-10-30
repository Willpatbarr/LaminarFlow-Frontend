import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { BOARD, listRoutes, ME, page, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// Saved views (LAM-118) through the real route tree, store and engine; only
// `fetch` is stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ALL_PERMISSIONS,
}
const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const TODO = { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-todo'] }] }
const TICKETS = [
    ticket({ id: 't-1', title: 'Pay by card', status_id: 's-todo', updated_at: '2026-01-03T00:00:00Z' }),
    ticket({ id: 't-2', title: 'Sign in', status_id: 's-doing', updated_at: '2026-01-02T00:00:00Z' }),
    ticket({ id: 't-3', title: 'Refund', status_id: 's-todo', updated_at: '2026-01-01T00:00:00Z' }),
]
const view = (overrides: Record<string, unknown>) => ({
    id: 'sv-1',
    team_id: 'team-1',
    project_id: 'p-1',
    board_id: null,
    layout: 'list',
    name: 'Todo only',
    is_shared: true,
    owner_account_id: 'acc-other',
    config: { filter: TODO, group: 'epic' },
    ...stamp,
    ...overrides,
})
const MINE = view({ id: 'sv-mine', name: 'My todo', is_shared: false, owner_account_id: ME })
const TEAMS = view({ id: 'sv-team', name: 'Team todo' })
const BOARD_VIEW = view({ id: 'sv-board', name: 'Todo board', layout: 'board', board_id: 'b-1', config: { filter: TODO } })

type Routes = Parameters<typeof stubFetch>[0]
let disconnect = () => {}

async function open(url: string, views: unknown[], routes: Routes = {}) {
    stubFetch({
        'GET /api/v1/auth/me': () => ok(me),
        ...listRoutes(TICKETS, [], [BOARD], { savedViews: views }),
        // The server answers a filter by running it: here, the one filter these tests use.
        'POST /api/v1/tickets/list': async (request) => {
            const { filter } = await bodyOf(request)
            return page(filter ? TICKETS.filter((t) => t.status_id === 's-todo') : TICKETS)
        },
        ...routes,
    })
    await refresh()
    const history = memoryHistory(url)
    const Router = createAppRouter(history)
    render(() => <Router />)
    return history
}

beforeEach(() => {
    disconnect = connectSyncToSession()
})
afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const titles = () =>
    screen
        .getAllByRole('link')
        .filter((a) => a.classList.contains('table__row'))
        .map((a) => a.textContent ?? '')

describe('the sidebar', () => {
    it('lists the team\'s saved views, marking the private ones', async () => {
        await open('/', [MINE, TEAMS])

        const mine = await screen.findByRole('link', { name: /My todo/ })
        expect(mine).toHaveAttribute('href', '/views/sv-mine')
        expect(within(mine).getByText('Private')).toBeInTheDocument()
        const shared = screen.getByRole('link', { name: 'Team todo' })
        expect(shared).toHaveAttribute('href', '/views/sv-team')
    })

    it('says there are none yet', async () => {
        await open('/', [])

        expect(await screen.findByText('No saved views yet')).toBeInTheDocument()
    })
})

describe('opening a view', () => {
    it('goes to the list with the saved setup in the address and applied', async () => {
        const history = await open('/views/sv-team', [TEAMS])

        await screen.findByText(/Team todo/)
        await vi.waitFor(() => expect(history.get()).toContain('view=sv-team'))
        const params = new URLSearchParams(history.get().split('?')[1])
        expect(history.get().startsWith('/?')).toBe(true)
        expect(JSON.parse(params.get('filter')!)).toEqual(TODO)
        expect(params.get('group')).toBe('epic')
        await screen.findByRole('region', { name: 'No epic' })
        expect(titles()).toEqual([expect.stringContaining('Pay by card'), expect.stringContaining('Refund')])
        expect(screen.queryByText(/has changed/)).not.toBeInTheDocument()
    })

    it('goes to the board with only its filter', async () => {
        const history = await open('/views/sv-board', [BOARD_VIEW])

        await screen.findByRole('heading', { name: `Launch · ${BOARD.name}` })
        expect(history.get().startsWith('/boards/b-1?')).toBe(true)
        expect(history.get()).toContain('view=sv-board')
        const todo = screen.getByRole('region', { name: 'To Do' })
        expect(within(todo).getAllByRole('listitem')).toHaveLength(2)
        expect(within(screen.getByRole('region', { name: 'In Progress' })).queryAllByRole('listitem')).toHaveLength(0)
        expect(screen.getByText('Saved view:', { exact: false })).toBeInTheDocument()
    })

    it('says so for a view this account cannot see', async () => {
        await open('/views/sv-nope', [TEAMS])

        expect(await screen.findByRole('heading', { name: 'View not found' })).toBeInTheDocument()
    })
})

describe('a changed view', () => {
    it('shows as changed, and Revert puts the saved setup back', async () => {
        const history = await open('/views/sv-team', [TEAMS])
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'No epic' })

        await user.selectOptions(screen.getByLabelText('Group by'), 'Status')

        expect(await screen.findByText(/“Team todo” has changed/)).toBeInTheDocument()
        expect(new URLSearchParams(history.get().split('?')[1]).get('view')).toBe('sv-team')

        await user.click(screen.getByRole('button', { name: 'Revert' }))

        await screen.findByRole('region', { name: 'No epic' })
        expect(screen.queryByText(/has changed/)).not.toBeInTheDocument()
    })

    it('Save changes re-saves the setup to the same view', async () => {
        let body: unknown
        await open('/views/sv-mine', [MINE], {
            'PUT /api/v1/saved-views/sv-mine': async (request) => {
                body = await bodyOf(request)
                return ok({ ...MINE, config: (body as { config: unknown }).config })
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'No epic' })

        await user.selectOptions(screen.getByLabelText('Group by'), 'Status')
        await user.click(await screen.findByRole('button', { name: 'Save changes' }))

        await vi.waitFor(() => expect(body).toEqual({ name: 'My todo', is_shared: false, config: { filter: TODO, group: 'status' } }))
        await vi.waitFor(() => expect(screen.queryByText(/has changed/)).not.toBeInTheDocument())
    })

    it('offers no Save changes on a view that is someone else\'s', async () => {
        await open('/views/sv-team', [TEAMS])
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'No epic' })

        await user.selectOptions(screen.getByLabelText('Group by'), 'Status')

        await screen.findByText(/has changed/)
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Revert' })).toBeInTheDocument()
    })
})

describe('saving a view', () => {
    it('names it, makes it the team\'s, and sends the list setup', async () => {
        let body: unknown
        const history = await open(`/?${new URLSearchParams({ filter: JSON.stringify(TODO), sort: 'title' })}`, [], {
            'POST /api/v1/saved-views': async (request) => {
                body = await bodyOf(request)
                return ok(view({ id: 'sv-new', name: 'Fresh', config: (body as { config: unknown }).config }))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        await user.click(screen.getByRole('button', { name: 'Save view' }))
        const dialog = await screen.findByRole('dialog', { name: 'Save list view' })
        await user.type(within(dialog).getByLabelText('Name'), 'Fresh')
        await user.click(within(dialog).getByLabelText('The team'))
        await user.click(within(dialog).getByRole('button', { name: 'Save view' }))

        await vi.waitFor(() =>
            expect(body).toEqual({
                team_id: 'team-1',
                project_id: 'p-1',
                layout: 'list',
                name: 'Fresh',
                is_shared: true,
                config: { filter: TODO, group: 'status', sort: [{ field: 'title', desc: false }] },
            }),
        )
        expect(new URLSearchParams(history.get().split('?')[1]).get('view')).toBeTruthy()
        expect(await screen.findByRole('link', { name: 'Fresh' })).toBeInTheDocument()
        expect(screen.queryByText(/has changed/)).not.toBeInTheDocument()
    })

    it('is private unless the team is chosen, and refuses a blank name', async () => {
        let body: Record<string, unknown> = {}
        await open('/', [], {
            'POST /api/v1/saved-views': async (request) => {
                body = await bodyOf(request)
                return ok(view({ id: 'sv-new', name: 'Mine', is_shared: false }))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        await user.click(screen.getByRole('button', { name: 'Save view' }))
        const dialog = await screen.findByRole('dialog', { name: 'Save list view' })
        await user.click(within(dialog).getByRole('button', { name: 'Save view' }))
        expect(await within(dialog).findByText('Give the view a name.')).toBeInTheDocument()
        expect(body).toEqual({})

        await user.type(within(dialog).getByLabelText('Name'), '  Mine  ')
        await user.click(within(dialog).getByRole('button', { name: 'Save view' }))

        await vi.waitFor(() => expect(body).toMatchObject({ name: 'Mine', is_shared: false }))
    })

    it('saves a filtered board, with its board and only the filter', async () => {
        let body: unknown
        await open('/boards/b-1', [], {
            'POST /api/v1/saved-views': async (request) => {
                body = await bodyOf(request)
                return ok(view({ id: 'sv-new', name: 'Todo board', layout: 'board', board_id: 'b-1' }))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('heading', { name: `Launch · ${BOARD.name}` })

        await user.click(screen.getByText(/^Filter/))
        const panel = screen.getByText(/^Filter/).closest('details')!
        await user.click(await within(panel).findByRole('checkbox', { name: 'To Do' }))
        expect(within(screen.getByRole('region', { name: 'In Progress' })).queryAllByRole('listitem')).toHaveLength(0)

        await user.click(screen.getByRole('button', { name: 'Save view' }))
        const dialog = await screen.findByRole('dialog', { name: 'Save board view' })
        await user.type(within(dialog).getByLabelText('Name'), 'Todo board')
        await user.click(within(dialog).getByLabelText('The team'))
        await user.click(within(dialog).getByRole('button', { name: 'Save view' }))

        await vi.waitFor(() =>
            expect(body).toEqual({
                team_id: 'team-1',
                project_id: 'p-1',
                board_id: 'b-1',
                layout: 'board',
                name: 'Todo board',
                is_shared: true,
                config: { filter: TODO },
            }),
        )
    })
})

describe('the Views page', () => {
    it('lists the views and deletes one after asking', async () => {
        let deleted = false
        await open('/views', [MINE, TEAMS], {
            'DELETE /api/v1/saved-views/sv-mine': () => {
                deleted = true
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()

        await user.click(await screen.findByRole('button', { name: 'Delete My todo' }))
        // Someone else's shared view can be opened but not deleted.
        expect(screen.queryByRole('button', { name: 'Delete Team todo' })).not.toBeInTheDocument()

        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete view' }))

        await vi.waitFor(() => expect(deleted).toBe(true))
        await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Delete My todo' })).not.toBeInTheDocument())
    })
})
