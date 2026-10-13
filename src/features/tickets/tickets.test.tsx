import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, sync, wipeLocalData } from '@/sync'
import {
    deferred,
    listRoutes,
    ME,
    page,
    PROJECT,
    TEAM,
    ticket,
} from '@/sync/testing/harness'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

// The ticket screens, driven through the real route tree, the real store and
// the real engine against fake-indexeddb, with only `fetch` stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: [],
}

type Routes = Parameters<typeof stubFetch>[0]

let disconnect = () => {}

// Signs in, lets sync start, and mounts the app at `url`.
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

describe('the ticket list', () => {
    it('shows the loading placeholder until the first load lands', async () => {
        const tickets = deferred()
        await open('/', { ...listRoutes(), 'POST /api/v1/tickets/list': () => tickets.promise })

        expect(await screen.findByRole('status')).toHaveTextContent('Loading')

        tickets.resolve(page([ticket()]))
        expect(await screen.findByRole('link', { name: /Write the outbox/ })).toBeInTheDocument()
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('groups tickets by status in position order, with "No status" last and only if needed', async () => {
        await open(
            '/',
            listRoutes([
                ticket({ id: 't-1', title: 'Ship it', status_id: 's-done' }),
                ticket({ id: 't-2', title: 'Loose end', status_id: null }),
                ticket({ id: 't-3', title: 'Plan it', status_id: 's-todo' }),
                ticket({ id: 't-4', title: 'Also plan', status_id: 's-todo' }),
            ]),
        )
        await screen.findByRole('link', { name: /Ship it/ })

        // "In Progress" has no tickets, so it has no group.
        const groups = screen.getAllByRole('region')
        expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
            'To Do',
            'Done',
            'No status',
        ])
        expect(within(groups[0]).getAllByRole('link')).toHaveLength(2)
        expect(within(groups[1]).getByRole('link', { name: /Ship it/ })).toHaveAttribute(
            'href',
            '/tickets/t-1',
        )
        expect(within(groups[2]).getByRole('link', { name: /Loose end/ })).toBeInTheDocument()
    })

    it('shows a status pill and an assignee marker on each row', async () => {
        await open(
            '/',
            listRoutes([
                ticket({ id: 't-1', title: 'Mine', assignee_id: ME }),
                ticket({ id: 't-2', title: 'Theirs', assignee_id: 'acc-other' }),
                ticket({ id: 't-3', title: 'Nobody' }),
            ]),
        )

        const mine = await screen.findByRole('link', { name: /Mine/ })
        expect(within(mine).getByText('To Do')).toBeInTheDocument()
        expect(within(mine).getByRole('img', { name: 'Assigned to you' })).toHaveTextContent('AL')
        expect(
            within(screen.getByRole('link', { name: /Theirs/ })).getByRole('img', {
                name: 'Assigned to someone else',
            }),
        ).toBeInTheDocument()
        expect(
            within(screen.getByRole('link', { name: /Nobody/ })).getByRole('img', {
                name: 'Unassigned',
            }),
        ).toBeInTheDocument()
    })

    it('marks a ticket with unsent changes, and only that one', async () => {
        await open('/', {
            ...listRoutes([
                ticket({ id: 't-1', title: 'Synced' }),
                ticket({ id: 't-2', title: 'Edited offline' }),
            ]),
            'PUT /api/v1/tickets/t-2': () => new Promise<Response>(() => {}),
        })
        await screen.findByRole('link', { name: /Synced/ })
        expect(screen.queryByRole('img', { name: /Not synced/ })).not.toBeInTheDocument()

        const { updateTicket } = await import('@/sync')
        await updateTicket('t-2', { description: 'more' })

        const edited = screen.getByRole('link', { name: /Edited offline/ })
        expect(within(edited).getByRole('img', { name: 'Not synced yet' })).toBeInTheDocument()
        expect(
            within(screen.getByRole('link', { name: /^Synced/ })).queryByRole('img', {
                name: /Not synced/,
            }),
        ).not.toBeInTheDocument()
    })

    it('shows an empty state for a project with no tickets', async () => {
        await open('/', listRoutes([]))

        expect(await screen.findByText('No tickets in Launch yet')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument()
    })

    it('offers a project picker only when there is more than one, and remembers the choice', async () => {
        const second = { ...PROJECT, id: 'p-2', name: 'Maintenance' }
        const routes = {
            ...listRoutes([
                ticket({ id: 't-1', title: 'In launch', project_id: 'p-1' }),
                ticket({ id: 't-2', title: 'In maintenance', project_id: 'p-2' }),
            ]),
            'POST /api/v1/projects/list': () => page([PROJECT, second]),
        }
        await open('/', routes)
        await screen.findByRole('link', { name: /In launch/ })
        expect(screen.queryByRole('link', { name: /In maintenance/ })).not.toBeInTheDocument()

        await userEvent.selectOptions(screen.getByLabelText('Project'), 'Maintenance')

        expect(await screen.findByRole('link', { name: /In maintenance/ })).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /In launch/ })).not.toBeInTheDocument()
        await vi.waitFor(() => expect(sync.projectId).toBe('p-2'))
    })

    it('creates a ticket from the dialog, opens it, and keeps the page through the id swap', async () => {
        const answer = deferred()
        const sent: unknown[] = []
        const history = await open('/', {
            ...listRoutes([]),
            'POST /api/v1/tickets': async (request) => {
                sent.push(await bodyOf(request))
                return answer.promise
            },
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'New ticket' }))

        const dialog = screen.getByRole('dialog', { name: 'New ticket' })
        // Nothing to create yet.
        expect(within(dialog).getByRole('button', { name: 'Create ticket' })).toBeDisabled()
        expect(within(dialog).getByLabelText('Title')).toHaveFocus()
        await user.type(within(dialog).getByLabelText('Title'), 'Offline idea{Enter}')

        // On its own page, under a temporary id, before the server has answered.
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        const title = await screen.findByLabelText('Title')
        expect(title).toHaveValue('Offline idea')
        expect(history.get()).toMatch(/^\/tickets\/tmp_/)
        expect(screen.getByRole('status')).toHaveTextContent('Not synced yet')
        await vi.waitFor(() =>
            expect(sent).toEqual([
                {
                    project_id: 'p-1',
                    title: 'Offline idea',
                    description: '',
                    status_id: 's-todo',
                    assignee_id: null,
                },
            ]),
        )

        // The user is typing in the description when the answer arrives.
        const description = screen.getByLabelText('Description')
        await user.type(description, 'half a thou')
        answer.resolve(ok(ticket({ id: 't-9', title: 'Offline idea', updated_by: ME })))

        await vi.waitFor(() => expect(history.get()).toBe('/tickets/t-9'))
        // Same fields, same focus, same text: nothing was rebuilt.
        expect(screen.getByDisplayValue('Offline idea')).toBe(title)
        expect(screen.getByLabelText('Description')).toBe(description)
        expect(description).toHaveFocus()
        expect(description).toHaveValue('half a thou')
        await vi.waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
    })
})

describe('first-run setup', () => {
    const none = () => page([])

    it('creates the team, then the project in it, then shows the empty project', async () => {
        const calls: { path: string; body: unknown }[] = []
        let created = false
        await open('/', {
            'POST /api/v1/teams/list': () => (created ? page([TEAM]) : none()),
            'POST /api/v1/projects/list': () => (created ? page([PROJECT]) : none()),
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/teams': async (request) => {
                calls.push({ path: 'teams', body: await bodyOf(request) })
                return ok(TEAM)
            },
            'POST /api/v1/projects': async (request) => {
                calls.push({ path: 'projects', body: await bodyOf(request) })
                created = true
                return ok(PROJECT)
            },
        })
        const user = userEvent.setup()

        expect(
            await screen.findByRole('heading', { name: 'Set up your first team and project' }),
        ).toBeInTheDocument()
        // Sensible defaults: it can be submitted as it stands.
        expect(screen.getByLabelText('Team name')).toHaveValue('My team')
        await user.clear(screen.getByLabelText('Project name'))
        await user.type(screen.getByLabelText('Project name'), 'Launch')
        await user.click(screen.getByRole('button', { name: 'Create team and project' }))

        expect(await screen.findByText('No tickets in Launch yet')).toBeInTheDocument()
        expect(calls).toEqual([
            { path: 'teams', body: { workspace_id: 'ws-1', name: 'My team', bare: false } },
            { path: 'projects', body: { team_id: 'team-1', name: 'Launch', bare: false } },
        ])
    })

    it('does not create a second team when the project failed the first time', async () => {
        let teamCreated = false
        let projectCreated = false
        let teamPosts = 0
        let projectPosts = 0
        await open('/', {
            'POST /api/v1/teams/list': () => (teamCreated ? page([TEAM]) : none()),
            'POST /api/v1/projects/list': () => (projectCreated ? page([PROJECT]) : none()),
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/teams': () => {
                teamPosts += 1
                teamCreated = true
                return ok(TEAM)
            },
            'POST /api/v1/projects': () => {
                projectPosts += 1
                if (projectPosts === 1) return problem(500, 'internal')
                projectCreated = true
                return ok(PROJECT)
            },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Create team and project' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('That did not work')
        // The team exists now, so the form no longer asks for its name.
        expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument()
        expect(screen.getByText('Team: Core')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Create team and project' }))

        expect(await screen.findByText(/No tickets in/)).toBeInTheDocument()
        expect(teamPosts).toBe(1)
        expect(projectPosts).toBe(2)
    })
})

describe('the ticket page', () => {
    function editable(extra: Routes = {}) {
        const puts: { ifMatch: string | null; body: Record<string, unknown> }[] = []
        const routes: Routes = {
            ...listRoutes([ticket({ version: 3, description: 'Before' })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                puts.push({ ifMatch: request.headers.get('If-Match'), body })
                return ok(ticket({ ...body, version: 3 + puts.length, updated_by: ME }))
            },
            ...extra,
        }
        return { routes, puts }
    }

    it('saves the title when focus leaves it, as a full replace with If-Match', async () => {
        const { routes, puts } = editable()
        await open('/tickets/t-1', routes)
        const user = userEvent.setup()
        const title = await screen.findByLabelText('Title')
        expect(title).toHaveValue('Write the outbox')

        await user.clear(title)
        await user.type(title, 'Write the inbox')
        expect(puts).toEqual([])
        await user.tab()

        await vi.waitFor(() =>
            expect(puts).toEqual([
                {
                    ifMatch: '"3"',
                    body: {
                        title: 'Write the inbox',
                        description: 'Before',
                        status_id: 's-todo',
                        assignee_id: null,
                    },
                },
            ]),
        )
        expect(title).toHaveValue('Write the inbox')
    })

    it('puts the old title back instead of saving a blank one', async () => {
        const { routes, puts } = editable()
        await open('/tickets/t-1', routes)
        const user = userEvent.setup()
        const title = await screen.findByLabelText('Title')

        await user.clear(title)
        await user.tab()

        expect(title).toHaveValue('Write the outbox')
        expect(puts).toEqual([])
    })

    it('saves status and assignee the moment they change', async () => {
        const { routes, puts } = editable()
        await open('/tickets/t-1', routes)
        const user = userEvent.setup()

        await user.selectOptions(await screen.findByLabelText('Status'), 'In Progress')
        await vi.waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].body.status_id).toBe('s-doing')

        const assignee = screen.getByRole('group', { name: 'Assignee' })
        expect(within(assignee).getByText('Unassigned')).toBeInTheDocument()
        await user.click(within(assignee).getByRole('button', { name: 'Assign to me' }))
        await vi.waitFor(() => expect(puts).toHaveLength(2))
        expect(puts[1]).toMatchObject({ ifMatch: '"4"', body: { assignee_id: ME, status_id: 's-doing' } })
        expect(within(assignee).getByText('You')).toBeInTheDocument()

        await user.click(within(assignee).getByRole('button', { name: 'Unassign' }))
        await vi.waitFor(() => expect(puts).toHaveLength(3))
        expect(puts[2].body.assignee_id).toBeNull()
    })

    it('shows another assignee read-only', async () => {
        await open('/tickets/t-1', listRoutes([ticket({ assignee_id: 'acc-other' })]))

        const assignee = await screen.findByRole('group', { name: 'Assignee' })
        expect(within(assignee).getByText('Someone else')).toBeInTheDocument()
        expect(within(assignee).queryByRole('button')).not.toBeInTheDocument()
    })

    it('archives after confirming, and goes back to the list', async () => {
        const deletes: (string | null)[] = []
        const history = await open('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'DELETE /api/v1/tickets/t-1': (request) => {
                deletes.push(request.headers.get('If-Match'))
                return new Response(null, { status: 204, headers: { ETag: '"4"' } })
            },
        })
        const user = userEvent.setup()
        const archive = await screen.findByRole('button', { name: 'Archive ticket' })

        // Cancel first: nothing happens, and focus goes back where it was.
        await user.click(archive)
        const dialog = screen.getByRole('dialog', { name: /Archive .Write the outbox.\?/ })
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(archive).toHaveFocus()
        expect(deletes).toEqual([])

        await user.click(archive)
        await user.click(screen.getByRole('button', { name: 'Archive' }))

        expect(await screen.findByText('No tickets in Launch yet')).toBeInTheDocument()
        expect(history.get()).toBe('/')
        await vi.waitFor(() => expect(deletes).toEqual(['"3"']))
    })

    it('says so when there is no such ticket', async () => {
        await open('/tickets/nope', listRoutes([ticket()]))

        expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: '← Tickets' })).toHaveAttribute('href', '/')
    })
})
