import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, ME, page, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// The epic, sprint and milestone pages (LAM-105), through the real route tree,
// store and engine; only `fetch` is stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ALL_PERMISSIONS,
}
const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const CHECKOUT = { id: 'e-1', project_id: 'p-1', name: 'Checkout', description: 'Pay for things', ...stamp }
const SEARCH = { id: 'e-2', project_id: 'p-1', name: 'Search', description: '', ...stamp }
const SPRINT = { id: 'sp-1', project_id: 'p-1', name: 'Sprint 1', start_date: '2026-03-01', end_date: '2026-03-14', ...stamp }
const V1 = { id: 'm-1', project_id: 'p-1', name: 'v1', description: '', target_date: '2026-06-01', ...stamp }

type Routes = Parameters<typeof stubFetch>[0]
let disconnect = () => {}

async function open(url: string, routes: Routes) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me), ...routes })
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

// The list page's own button; the sidebar has one of the same name.
async function pageButton(name: string) {
    await screen.findByRole('heading', { level: 1 })
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name }).at(-1)).toBeEnabled())
    return screen.getAllByRole('button', { name }).at(-1)!
}

const tickets = [
    ticket({ id: 't-1', version: 1, title: 'Pay button', epic_id: 'e-1', status_id: 's-done' }),
    ticket({ id: 't-2', version: 1, title: 'Cart page', epic_id: 'e-1', status_id: 's-todo' }),
    ticket({ id: 't-3', version: 1, title: 'Query box', epic_id: 'e-2', status_id: 's-todo' }),
    ticket({ id: 't-4', version: 1, title: 'Loose end' }),
]

// Which tickets the sprint filter returns: t-1 and t-3, from two epics.
function everything(extra: Routes = {}): Routes {
    return {
        ...listRoutes(tickets, [], [], { epics: [CHECKOUT, SEARCH], sprints: [SPRINT], milestones: [V1] }),
        'POST /api/v1/tickets/list': async (request) => {
            const body = await bodyOf(request)
            const conditions = (body.filter?.conditions ?? []) as { field: string; value: string }[]
            if (conditions.some((c) => c.field === 'sprint')) return page([tickets[0], tickets[2]])
            const title = conditions.find((c) => c.field === 'title')
            if (title) return page(tickets.filter((t) => t.title.toLowerCase().includes(title.value.toLowerCase())))
            return page(tickets)
        },
        ...extra,
    }
}

describe('the lists', () => {
    it('/epics lists each epic with how many of its tickets are done', async () => {
        await open('/epics', everything())
        const list = await screen.findByRole('list', { name: 'Epics' })
        const [checkout, search] = within(list).getAllByRole('listitem')
        expect(checkout).toHaveTextContent('Checkout')
        expect(checkout).toHaveTextContent('1 of 2 tickets done')
        expect(search).toHaveTextContent('0 of 1 ticket done')
        expect(within(checkout).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/epics/e-1')
    })

    it('/sprints shows the dates, and /milestones the target date', async () => {
        await open('/sprints', everything())
        expect(await screen.findByText('1 Mar 2026 – 14 Mar 2026')).toBeInTheDocument()
    })

    it('says plainly that a project has none, with no warning', async () => {
        await open('/milestones', listRoutes(tickets))
        expect(await screen.findByText(/No milestones in Launch yet/)).toBeInTheDocument()
        expect(screen.queryByRole('alert')).toBeNull()
    })
})

describe('a detail page', () => {
    it('shows its tickets and its progress, and not tickets filed elsewhere or nowhere', async () => {
        await open('/epics/e-1', everything())
        expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Pay button/ })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Cart page/ })).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /Query box/ })).toBeNull()
        expect(screen.queryByRole('link', { name: /Loose end/ })).toBeNull()
        expect(screen.getByText('1 of 2 tickets done (50%)')).toBeInTheDocument()
        expect(screen.getByRole('progressbar', { name: 'Progress of Checkout' })).toHaveAttribute('value', '1')
    })

    it('says so when nothing is filed there', async () => {
        await open('/milestones/m-1', everything())
        expect(await screen.findByText('No tickets are in this milestone.')).toBeInTheDocument()
        expect(screen.getByText('No tickets yet')).toBeInTheDocument()
    })

    it('says not found for an id nobody has', async () => {
        await open('/sprints/nope', everything())
        expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
    })

    it('renames an epic when focus leaves the name, and sends the description with it', async () => {
        const puts: unknown[] = []
        await open(
            '/epics/e-1',
            everything({
                'PUT /api/v1/epics/e-1': async (request) => {
                    const body = await bodyOf(request)
                    puts.push(body)
                    return ok({ ...CHECKOUT, ...body })
                },
            }),
        )
        const user = userEvent.setup()
        const name = await screen.findByLabelText('Name')
        await user.clear(name)
        await user.type(name, 'Payments')
        await user.tab()
        await vi.waitFor(() => expect(puts).toEqual([{ name: 'Payments', description: 'Pay for things' }]))
        expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument()
    })

    it('deletes an epic after a confirmation that says its tickets stay', async () => {
        let deleted = false
        await open(
            '/epics/e-1',
            everything({
                'DELETE /api/v1/epics/e-1': () => {
                    deleted = true
                    return new Response(null, { status: 204 })
                },
            }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Delete epic' }))
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('2 tickets stay, with no epic')
        await user.click(within(dialog).getByRole('button', { name: 'Delete epic' }))
        await vi.waitFor(() => expect(deleted).toBe(true))
        expect(await screen.findByRole('heading', { name: 'Epics' })).toBeInTheDocument()
    })
})

describe('sprints', () => {
    it('shows tickets from two epics in one sprint', async () => {
        await open('/sprints/sp-1', everything())
        expect(await screen.findByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
        const list = within(screen.getByRole('heading', { name: 'Tickets' }).parentElement!)
        expect(await list.findByRole('link', { name: /Pay button/ })).toBeInTheDocument()
        expect(list.getByRole('link', { name: /Query box/ })).toBeInTheDocument()
        expect(list.queryByRole('link', { name: /Loose end/ })).toBeNull()
    })

    it('creates one with dates from the list page, and opens it', async () => {
        const posts: unknown[] = []
        await open(
            '/sprints',
            everything({
                'POST /api/v1/sprints': async (request) => {
                    const body = await bodyOf(request)
                    posts.push(body)
                    return ok({ id: 'sp-new', project_id: 'p-1', start_date: null, end_date: null, ...body, ...stamp })
                },
            }),
        )
        const user = userEvent.setup()
        await user.click(await pageButton('New sprint'))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Sprint 2')
        await user.type(within(dialog).getByLabelText('Start date'), '2026-04-01')
        await user.type(within(dialog).getByLabelText('End date'), '2026-04-14')
        await user.click(within(dialog).getByRole('button', { name: 'Create sprint' }))

        await vi.waitFor(() =>
            expect(posts).toEqual([{ project_id: 'p-1', name: 'Sprint 2', start_date: '2026-04-01', end_date: '2026-04-14' }]),
        )
        expect(await screen.findByRole('heading', { name: 'Sprint 2' })).toBeInTheDocument()
    })

    it('replaces the temporary id in the address with the real one once the server answers (LAM-133)', async () => {
        // `answer` stays a no-op until the outbox actually sends the POST, which
        // happens asynchronously after the optimistic create. Answering before
        // then would be lost, so the test waits for the request first.
        let answer: ((response: Response) => void) | null = null
        const history = await open(
            '/sprints',
            everything({
                'POST /api/v1/sprints': async (request) => {
                    await bodyOf(request)
                    return new Promise<Response>((resolve) => {
                        answer = resolve
                    })
                },
            }),
        )
        const user = userEvent.setup()
        await user.click(await pageButton('New sprint'))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Sprint 3')
        await user.click(within(dialog).getByRole('button', { name: 'Create sprint' }))

        await vi.waitFor(() => expect(history.get()).toMatch(/^\/sprints\/tmp_sprint_/))
        expect(await screen.findByRole('heading', { name: 'Sprint 3' })).toBeInTheDocument()

        await vi.waitFor(() => expect(answer).not.toBeNull())
        answer!(ok({ id: 'sp-new', project_id: 'p-1', name: 'Sprint 3', start_date: null, end_date: null, ...stamp }))
        await vi.waitFor(() => expect(history.get()).toBe('/sprints/sp-new'))
        expect(screen.getByRole('heading', { name: 'Sprint 3' })).toBeInTheDocument()
    })

    it('will not make a sprint that ends before it starts', async () => {
        await open('/sprints', everything())
        const user = userEvent.setup()
        await user.click(await pageButton('New sprint'))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Backwards')
        await user.type(within(dialog).getByLabelText('Start date'), '2026-04-14')
        await user.type(within(dialog).getByLabelText('End date'), '2026-04-01')
        expect(within(dialog).getByText('The end cannot be before the start.')).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Create sprint' })).toBeDisabled()
    })

    it('adds a ticket from anywhere in the project through the picker', async () => {
        const adds: unknown[] = []
        await open(
            '/sprints/sp-1',
            everything({
                'PUT /api/v1/tickets/t-4': async (request) => ok(ticket({ ...(await bodyOf(request)), id: 't-4', version: 2 })),
                'POST /api/v1/sprints/sp-1/tickets': async (request) => {
                    adds.push(await bodyOf(request))
                    return new Response(null, { status: 204 })
                },
                'GET /api/v1/tickets/t-4': () => ok(ticket({ id: 't-4', version: 3, title: 'Loose end' })),
            }),
        )
        const user = userEvent.setup()
        await user.type(await screen.findByLabelText('Search this project’s tickets'), 'loose')
        const results = screen.getByRole('list', { name: 'Tickets that can be added' })
        await user.click(await within(results).findByRole('button', { name: 'Add Loose end to this sprint' }))
        await vi.waitFor(() => expect(adds).toEqual([{ ticket_id: 't-4' }]))
        // It is in the sprint now, so it is no longer offered.
        await vi.waitFor(() => expect(within(results).queryByText('Loose end')).toBeNull())
    })
})

describe('tickets with no parent', () => {
    it('open cleanly: nothing to complain about, and every parent picker says None', async () => {
        await open('/tickets/t-4', everything())
        const epic = (await screen.findByLabelText('Epic')) as HTMLSelectElement
        expect(epic.selectedOptions[0]).toHaveTextContent('None')
        expect((screen.getByLabelText('Sprint') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('None')
        expect((screen.getByLabelText('Milestone') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('None')
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('make an epic from the ticket page and file the ticket under it', async () => {
        const puts: Record<string, unknown>[] = []
        await open(
            '/tickets/t-4',
            everything({
                'POST /api/v1/epics': async (request) => {
                    const body = await bodyOf(request)
                    return ok({ id: 'e-new', ...body, ...stamp })
                },
                'PUT /api/v1/tickets/t-4': async (request) => {
                    const body = await bodyOf(request)
                    puts.push(body)
                    return ok(ticket({ ...body, id: 't-4', version: 2 }))
                },
            }),
        )
        const user = userEvent.setup()
        await user.click(await pageButton('New epic'))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Onboarding')
        await user.click(within(dialog).getByRole('button', { name: 'Create epic' }))
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: 'e-new' }))
        await vi.waitFor(() => expect((screen.getByLabelText('Epic') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('Onboarding'))
    })
})

describe('typing through the id swap (LAM-169)', () => {
    it('a new epic keeps the same description field, and what was typed in it', async () => {
        let release!: () => void
        const held = new Promise<void>((resolve) => (release = resolve))
        const puts: Record<string, unknown>[] = []
        const history = await open(
            '/epics',
            everything({
                'POST /api/v1/epics': async (request) => {
                    const body = await bodyOf(request)
                    await held
                    return ok({ id: 'e-new', ...body, ...stamp }, 201)
                },
                'PUT /api/v1/epics/e-new': async (request) => {
                    const body = await bodyOf(request)
                    puts.push(body)
                    return ok({ id: 'e-new', project_id: 'p-1', ...body, ...stamp })
                },
            }),
        )
        const user = userEvent.setup()
        await user.click(await pageButton('New epic'))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Onboarding')
        await user.click(within(dialog).getByRole('button', { name: 'Create epic' }))
        // The dialog has a Description field of its own: wait until it is gone and the
        // epic's page (still under its temporary id) is the only one there is.
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await vi.waitFor(() => expect(history.get()).toMatch(/^\/epics\/tmp_/))
        const field = screen.getByLabelText('Description')
        await user.type(field, 'Find')
        release()
        await vi.waitFor(() => expect(history.get()).toBe('/epics/e-new'))
        await user.type(field, ' things')
        expect(screen.getByLabelText('Description')).toBe(field)
        expect(field).toHaveValue('Find things')
        await user.tab()
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ description: 'Find things' }), { timeout: 5000 })
    })
})

describe('the sidebar', () => {
    it('links to the three pages and makes any of them', async () => {
        const posts: unknown[] = []
        await open(
            '/',
            everything({
                'POST /api/v1/milestones': async (request) => {
                    const body = await bodyOf(request)
                    posts.push(body)
                    return ok({ id: 'm-new', target_date: null, ...body, ...stamp })
                },
            }),
        )
        const user = userEvent.setup()
        await screen.findByRole('heading', { name: 'Tickets' })
        for (const name of ['Epics', 'Sprints', 'Milestones']) {
            expect(screen.getByRole('link', { name })).toBeInTheDocument()
        }
        await user.click(await screen.findByRole('button', { name: 'New milestone' }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'v2')
        await user.type(within(dialog).getByLabelText('Target date'), '2026-09-01')
        await user.click(within(dialog).getByRole('button', { name: 'Create milestone' }))
        await vi.waitFor(() => expect(posts).toEqual([{ project_id: 'p-1', name: 'v2', description: '', target_date: '2026-09-01' }]))
        expect(await screen.findByRole('heading', { name: 'v2' })).toBeInTheDocument()
    })
})
