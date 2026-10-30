import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { deferred, listRoutes, ME, page, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// The list's filter, sort, group and column controls (LAM-106), through the
// real route tree, store and engine; only `fetch` is stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ALL_PERMISSIONS,
}
const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const HIERARCHY = {
    epics: [
        { id: 'e-1', project_id: 'p-1', name: 'Checkout', description: '', ...stamp },
        { id: 'e-2', project_id: 'p-1', name: 'Accounts', description: '', ...stamp },
    ],
    sprints: [],
    milestones: [],
    labels: [{ id: 'l-1', team_id: 'team-1', name: 'bug', color: '#f00', ...stamp }],
}
const TICKETS = [
    ticket({
        id: 't-1',
        title: 'Pay by card',
        status_id: 's-todo',
        epic_id: 'e-1',
        label_ids: ['l-1'],
        updated_at: '2026-01-03T00:00:00Z',
    }),
    ticket({ id: 't-2', title: 'Sign in', status_id: 's-doing', epic_id: 'e-2', updated_at: '2026-01-02T00:00:00Z' }),
    ticket({ id: 't-3', title: 'Refund', status_id: 's-todo', epic_id: 'e-1', updated_at: '2026-01-01T00:00:00Z' }),
]

type Routes = Parameters<typeof stubFetch>[0]
let disconnect = () => {}

async function open(url: string, routes: Routes = {}) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me), ...listRoutes(TICKETS, [], [], HIERARCHY), ...routes })
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

describe('the view in the address', () => {
    it('is grouped by status and newest first when the link says nothing', async () => {
        await open('/')
        await screen.findByRole('region', { name: 'To Do' })
        expect(within(screen.getByRole('region', { name: 'To Do' })).getAllByRole('link')).toHaveLength(2)
        expect(titles()[0]).toContain('Pay by card')
    })

    it('reproduces a view from its link: filter, sort, group and columns', async () => {
        const filter = { op: 'and', conditions: [{ field: 'status', op: 'in', value: ['s-todo'] }] }
        const query = new URLSearchParams({
            filter: JSON.stringify(filter),
            sort: 'title',
            group: 'epic',
            columns: 'title,epic,label',
        })
        await open(`/?${query}`)

        const checkout = await screen.findByRole('region', { name: 'Checkout' })
        expect(screen.queryByRole('region', { name: 'Accounts' })).not.toBeInTheDocument()
        expect(
            within(checkout)
                .getAllByRole('link')
                .map((a) => a.textContent),
        ).toEqual([expect.stringContaining('Pay by card'), expect.stringContaining('Refund')])
        // The epic and label columns, and no status column.
        expect(within(checkout).getAllByText('Checkout').length).toBeGreaterThan(0)
        expect(within(checkout).getByText('bug')).toBeInTheDocument()
        expect(screen.queryByText('Status', { selector: '.t-overline' })).not.toBeInTheDocument()
    })

    it('writes every change back to the address, keeping the open ticket', async () => {
        const history = await open('/?ticket=t-1')
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        await user.selectOptions(screen.getByLabelText('Group by'), 'Epic')
        await user.selectOptions(screen.getByLabelText('Sort by'), 'Title')
        await user.click(screen.getByRole('button', { name: 'Sort direction: ascending' }))

        const params = new URLSearchParams(history.get().split('?')[1])
        expect(params.get('group')).toBe('epic')
        expect(params.get('sort')).toBe('title:desc')
        expect(params.get('ticket')).toBe('t-1')
        expect(titles()).toEqual([
            expect.stringContaining('Sign in'),
            expect.stringContaining('Refund'),
            expect.stringContaining('Pay by card'),
        ])
    })
})

describe('the filter bar', () => {
    it('filters locally at once, then asks the server the same question, scoped to the project', async () => {
        const asked: Record<string, unknown>[] = []
        const reply = deferred<Response>()
        const history = await open('/', {
            'POST /api/v1/tickets/list': async (request) => {
                const body = await bodyOf(request)
                if (!body.filter) return page(TICKETS)
                asked.push(body)
                return reply.promise
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        await user.click(screen.getByText(/^Filter/))
        await user.click(await screen.findByRole('checkbox', { name: 'Checkout' }))

        await vi.waitFor(() => expect(titles()).toHaveLength(2))
        await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0))
        expect(asked.at(-1)!.filter).toEqual({
            op: 'and',
            conditions: [
                { field: 'project', op: 'eq', value: 'p-1' },
                { field: 'epic', op: 'in', value: ['e-1'] },
            ],
        })
        // Local first: both Checkout tickets are on screen while the server is still thinking.
        expect(titles()).toHaveLength(2)
        reply.resolve(page([TICKETS[0]]))
        // The server only knows t-1 of the two Checkout tickets, and the list takes its word for it.
        await vi.waitFor(() => expect(titles()).toEqual([expect.stringContaining('Pay by card')]))
        expect(new URLSearchParams(history.get().split('?')[1]).get('filter')).toContain('"epic"')

        await user.click(screen.getByRole('button', { name: 'Clear filters' }))
        await vi.waitFor(() => expect(titles()).toHaveLength(3))
    })

    it('stays on the local answer when the server cannot be asked', async () => {
        await open(
            '/?' +
                new URLSearchParams({
                    filter: JSON.stringify({
                        op: 'and',
                        conditions: [{ field: 'title', op: 'contains', value: 'sign' }],
                    }),
                }),
            {
                'POST /api/v1/tickets/list': async (request) => {
                    const body = await bodyOf(request)
                    return body.filter ? new Response('down', { status: 503 }) : page(TICKETS)
                },
            },
        )
        await screen.findByRole('region', { name: 'In Progress' })
        expect(titles()).toEqual([expect.stringContaining('Sign in')])
    })

    it('says so when nothing matches', async () => {
        const query = new URLSearchParams({
            filter: JSON.stringify({ op: 'and', conditions: [{ field: 'title', op: 'contains', value: 'zzz' }] }),
        })
        await open(`/?${query}`)
        expect(await screen.findByText('No tickets match this filter')).toBeInTheDocument()
    })
})

describe('groups and columns', () => {
    it('folds a group and remembers it in the address', async () => {
        const history = await open('/')
        const user = userEvent.setup()
        const todo = await screen.findByRole('region', { name: 'To Do' })

        await user.click(within(todo).getByRole('button', { name: /To Do, 2 tickets/ }))
        expect(within(screen.getByRole('region', { name: 'To Do' })).queryAllByRole('link')).toHaveLength(0)
        expect(new URLSearchParams(history.get().split('?')[1]).get('collapsed')).toBe('s-todo')

        await user.click(screen.getByRole('button', { name: /To Do, 2 tickets/ }))
        expect(within(screen.getByRole('region', { name: 'To Do' })).getAllByRole('link')).toHaveLength(2)
    })

    it('shows one flat list when ungrouped', async () => {
        await open('/?group=none')
        await screen.findByRole('region', { name: 'Tickets' })
        expect(titles()).toHaveLength(3)
    })

    it('adds and removes columns from the picker', async () => {
        const history = await open('/')
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        await user.click(screen.getByText('Columns'))
        await user.click(await screen.findByRole('checkbox', { name: 'Epic' }))
        await user.click(screen.getByRole('checkbox', { name: 'Status' }))

        expect(new URLSearchParams(history.get().split('?')[1]).get('columns')).toBe('title,assignee,epic')
        expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0)
        expect(screen.getByRole('checkbox', { name: 'Title' })).toBeDisabled()
    })
})

describe('list polish (LAM-155)', () => {
    it('lists "Recently updated" once, and reads the old "updated_at" sort as it', async () => {
        const history = await open('/?sort=updated_at:desc')
        const user = userEvent.setup()
        await screen.findByRole('region', { name: 'To Do' })

        const sort = screen.getByLabelText('Sort by')
        expect(within(sort).getAllByRole('option').map((o) => o.textContent)).not.toContain('Updated')
        expect(within(sort).getAllByRole('option').filter((o) => o.textContent === 'Recently updated')).toHaveLength(1)
        expect(sort).toHaveValue('')
        // An old link's explicit key is the default now: nothing left to write.
        expect(titles()[0]).toContain('Pay by card')

        // The direction button works on the default ordering.
        await user.click(screen.getByRole('button', { name: 'Sort direction: descending' }))
        expect(new URLSearchParams(history.get().split('?')[1]).get('sort')).toBe('updated_at')
        expect(screen.getByLabelText('Sort by')).toHaveValue('')
        expect(screen.getByRole('button', { name: 'Sort direction: ascending' })).toBeInTheDocument()
    })

    it('draws one column header for every group, with an Assignee column', async () => {
        await open('/')
        await screen.findByRole('region', { name: 'To Do' })
        expect(screen.getAllByRole('region').length).toBeGreaterThan(1)
        const headers = document.querySelectorAll('.table__header')
        expect(headers).toHaveLength(1)
        expect(headers[0]).toHaveTextContent('Assignee')
    })

    it('keeps the room for "Clear filters" whether or not it shows', async () => {
        await open('/')
        await screen.findByRole('region', { name: 'To Do' })
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
        expect(document.querySelector('.list-controls__clear')).toBeInTheDocument()
    })

    it('has quiet icon buttons on every row, named and in the tab order', async () => {
        await open('/')
        await screen.findByRole('region', { name: 'To Do' })
        const edit = screen.getAllByRole('button', { name: /^Edit / })
        expect(edit).toHaveLength(3)
        expect(edit[0]).toHaveAccessibleDescription('Edit title and status')
        expect(edit[0]).not.toHaveAttribute('tabindex')
        expect(edit[0].textContent).toBe('')
        expect(screen.getAllByRole('button', { name: /^Archive / })[0]).toHaveAccessibleDescription('Archive ticket')
    })
})
