import { memoryHistory } from '@solidjs/router'
import { fireEvent, render, screen, within } from '@solidjs/testing-library'
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
import { FakeWebSocket } from '@/sync/testing/fakeSocket'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// The ticket screens, driven through the real route tree, the real store and
// the real engine against fake-indexeddb, with only `fetch` stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ALL_PERMISSIONS,
}

type Routes = Parameters<typeof stubFetch>[0]

const person = (account_id: string, display_name: string) => ({
    account_id,
    display_name,
    email: `${account_id}@example.com`,
    role: 'member',
})
const MEMBERS = {
    'POST /api/v1/members/list': () =>
        ok({
            items: [person(ME, 'Ada Lovelace'), person('acc-sam', 'Sam Ortiz')],
            has_more: false,
            next_cursor: null,
        }),
}

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

// The side nav has a status region of its own (the connection), so a page's
// status is looked for inside the page.
const inMain = () => within(screen.getByRole('main'))

beforeEach(() => {
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

describe('the ticket list', () => {
    it('shows the list placeholder until the first load lands, then the rows', async () => {
        const tickets = deferred()
        await open('/', { ...listRoutes(), 'POST /api/v1/tickets/list': () => tickets.promise })

        expect(await inMain().findByRole('status')).toHaveTextContent('Loading tickets')
        expect(screen.getByRole('main').querySelector('section.tickets')).toHaveAttribute(
            'aria-busy',
            'true',
        )
        expect(inMain().queryByRole('link')).not.toBeInTheDocument()

        tickets.resolve(page([ticket()]))
        expect(await screen.findByRole('link', { name: /Write the outbox/ })).toBeInTheDocument()
        expect(inMain().queryByRole('status')).not.toBeInTheDocument()
        expect(screen.getByRole('main').querySelector('section.tickets')).not.toHaveAttribute(
            'aria-busy',
        )
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
        // The loading list shows the button too, disabled: wait for the real one.
        await vi.waitFor(() =>
            expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled(),
        )
        await user.click(screen.getByRole('button', { name: 'New ticket' }))

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
        expect(inMain().getByRole('status')).toHaveTextContent('Not synced yet')
        await vi.waitFor(() =>
            expect(sent).toEqual([
                {
                    project_id: 'p-1',
                    title: 'Offline idea',
                    description: '',
                    status_id: 's-todo',
                    assignee_id: null,
                    epic_id: null,
                    milestone_id: null,
                    label_ids: [],
                },
            ]),
        )

        // The user is typing in the description when the answer arrives.
        const description = screen.getByRole('textbox', { name: 'Description' })
        await user.click(description)
        await user.keyboard('half a thou')
        answer.resolve(ok(ticket({ id: 't-9', title: 'Offline idea', updated_by: ME })))

        await vi.waitFor(() => expect(history.get()).toBe('/tickets/t-9'))
        // Same fields, same focus, same text: nothing was rebuilt.
        expect(screen.getByDisplayValue('Offline idea')).toBe(title)
        expect(screen.getByRole('textbox', { name: 'Description' })).toBe(description)
        expect(description).toHaveFocus()
        expect(description).toHaveTextContent('half a thou')
        await vi.waitFor(() => expect(inMain().getByRole('status')).toBeEmptyDOMElement())
    })
})

describe('creating from the keyboard', () => {
    it('opens the dialog on C, and C typed into a field does not', async () => {
        await open('/', listRoutes([ticket({ id: 't-1', title: 'Existing' })]))
        const user = userEvent.setup()
        await screen.findByRole('link', { name: /Existing/ })

        await user.keyboard('c')
        const dialog = await screen.findByRole('dialog', { name: 'New ticket' })
        // The key that opened it was not typed into the title.
        expect(within(dialog).getByLabelText('Title')).toHaveValue('')

        await user.type(within(dialog).getByLabelText('Title'), 'cc')
        expect(within(dialog).getByLabelText('Title')).toHaveValue('cc')
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('ignores C with a modifier held, and while a ticket is being edited in the list', async () => {
        await open('/', listRoutes([ticket({ id: 't-1', title: 'Existing' })]))
        const user = userEvent.setup()
        await screen.findByRole('link', { name: /Existing/ })

        await user.keyboard('{Control>}c{/Control}')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Edit Existing' }))
        await user.keyboard('c')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('creates with the description and the status that were picked', async () => {
        const sent: unknown[] = []
        await open('/', {
            ...listRoutes([]),
            'POST /api/v1/tickets': async (request) => {
                const body = await bodyOf(request)
                sent.push(body)
                return ok(ticket({ id: 't-9', ...(body as object), updated_by: ME }))
            },
        })
        const user = userEvent.setup()
        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled())
        await user.keyboard('c')

        const dialog = await screen.findByRole('dialog', { name: 'New ticket' })
        // The first status of the project is the default.
        expect(within(dialog).getByLabelText('Status')).toHaveValue('s-todo')
        await user.type(within(dialog).getByLabelText('Title'), 'Picked')
        await user.type(within(dialog).getByLabelText('Description'), 'With words')
        await user.selectOptions(within(dialog).getByLabelText('Status'), 'In Progress')
        await user.click(within(dialog).getByRole('button', { name: 'Create ticket' }))

        await vi.waitFor(() =>
            expect(sent).toEqual([
                {
                    project_id: 'p-1',
                    title: 'Picked',
                    description: 'With words',
                    status_id: 's-doing',
                    assignee_id: null,
                    epic_id: null,
                    milestone_id: null,
                    label_ids: [],
                },
            ]),
        )
    })
})

describe('editing in the list', () => {
    function editable() {
        const puts: { ifMatch: string | null; body: Record<string, unknown> }[] = []
        const routes: Routes = {
            ...listRoutes([ticket({ id: 't-1', title: 'Rename me', version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                puts.push({ ifMatch: request.headers.get('If-Match'), body })
                return ok(ticket({ id: 't-1', ...body, version: 4, updated_by: ME }))
            },
        }
        return { routes, puts }
    }

    it('changes the title and the status in place, as one full replace with If-Match', async () => {
        const { routes, puts } = editable()
        await open('/', routes)
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Edit Rename me' }))

        const title = screen.getByLabelText('Title')
        expect(title).toHaveValue('Rename me')
        await user.clear(title)
        await user.type(title, 'Renamed')
        await user.selectOptions(screen.getByLabelText('Status'), 'Done')
        await user.click(screen.getByRole('button', { name: 'Save' }))

        // Optimistic: the row is under its new status before the server is
        // heard. The list holds its order while the pointer or focus is in it
        // (LAM-145): the pointer leaves and focus moves out of the list.
        fireEvent.pointerLeave((await screen.findByRole('link', { name: /Renamed/ })).closest('.tickets__rows')!)
        ;(document.activeElement as HTMLElement).blur()
        const group = await screen.findByRole('region', { name: 'Done' })
        expect(within(group).getByRole('link', { name: /Renamed/ })).toBeInTheDocument()
        await vi.waitFor(() =>
            expect(puts).toEqual([
                {
                    ifMatch: '"3"',
                    body: { title: 'Renamed', description: '', status_id: 's-done', assignee_id: null, epic_id: null, milestone_id: null, label_ids: [] },
                },
            ]),
        )
    })

    it('after a keyboard save, focus is back on that row and the order holds', async () => {
        const routes: Routes = {
            ...listRoutes([
                ticket({ id: 't-1', title: 'Newer one', version: 1, updated_at: '2026-10-29T10:00:09.000Z' }),
                ticket({ id: 't-2', title: 'Older one', version: 1, updated_at: '2026-10-29T10:00:01.000Z' }),
            ]),
            'PUT /api/v1/tickets/t-2': async (request) => ok(ticket({ id: 't-2', ...(await bodyOf(request)), version: 2 })),
        }
        await open('/', routes)
        const user = userEvent.setup()
        const names = () => [...document.querySelectorAll('a.table__row .table__text')].map((el) => el.textContent)
        await screen.findByRole('button', { name: 'Edit Older one' })
        expect(names()).toEqual(['Newer one', 'Older one'])

        screen.getByRole('button', { name: 'Edit Older one' }).focus()
        await user.keyboard('{Enter}')
        await user.type(screen.getByLabelText('Title'), ' edited{Enter}')

        const edit = await screen.findByRole('button', { name: 'Edit Older one edited' })
        await vi.waitFor(() => expect(edit).toHaveFocus())
        expect(names()).toEqual(['Newer one', 'Older one edited'])
    })

    it('saves on Enter, cancels on Escape, and queues nothing when nothing changed', async () => {
        const { routes, puts } = editable()
        await open('/', routes)
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Edit Rename me' }))

        await user.type(screen.getByLabelText('Title'), ' now')
        await user.keyboard('{Escape}')
        expect(screen.getByRole('link', { name: /Rename me/ })).toBeInTheDocument()
        expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Edit Rename me' }))
        await user.keyboard('{Enter}')
        expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
        expect(puts).toEqual([])

        await user.click(screen.getByRole('button', { name: 'Edit Rename me' }))
        await user.type(screen.getByLabelText('Title'), '!{Enter}')
        await vi.waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].body.title).toBe('Rename me!')
    })

    it('does not queue a blank or over-long title, and says why at the row', async () => {
        const { routes, puts } = editable()
        await open('/', routes)
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Edit Rename me' }))

        await user.clear(screen.getByLabelText('Title'))
        await user.click(screen.getByRole('button', { name: 'Save' }))
        expect(screen.getByText('A ticket needs a title.')).toBeInTheDocument()

        await user.click(screen.getByLabelText('Title'))
        await user.paste('x'.repeat(201))
        await user.click(screen.getByRole('button', { name: 'Save' }))
        expect(screen.getByText(/Title can be at most 200 characters/)).toBeInTheDocument()
        expect(puts).toEqual([])
    })
})

describe('archiving from the list, with undo', () => {
    const noContent = (version: number) =>
        new Response(null, { status: 204, headers: { ETag: `"${version}"` } })

    it('archives at once, offers Undo, and Undo restores it through POST /unarchive', async () => {
        const calls: string[] = []
        await open('/', {
            ...listRoutes([ticket({ id: 't-1', title: 'Oops', version: 2 })]),
            'DELETE /api/v1/tickets/t-1': (request) => {
                calls.push(`DELETE ${request.headers.get('If-Match')}`)
                return noContent(3)
            },
            'POST /api/v1/tickets/t-1/unarchive': (request) => {
                calls.push(`POST ${request.headers.get('If-Match')}`)
                return noContent(4)
            },
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Archive Oops' }))

        // Gone from the list, with the offer to take it back.
        await vi.waitFor(() => expect(screen.queryByRole('link', { name: /Oops/ })).not.toBeInTheDocument())
        const toast = await screen.findByText('Archived “Oops”')
        expect(toast).toBeInTheDocument()
        await vi.waitFor(() => expect(calls).toEqual(['DELETE "2"']))

        await user.click(screen.getByRole('button', { name: 'Undo' }))

        expect(await screen.findByRole('link', { name: /Oops/ })).toBeInTheDocument()
        expect(screen.queryByText('Archived “Oops”')).not.toBeInTheDocument()
        await vi.waitFor(() => expect(calls).toEqual(['DELETE "2"', 'POST "3"']))
    })

    it('offers Undo after archiving from the ticket page too', async () => {
        await open('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1', title: 'From the page', version: 2 })]),
            'DELETE /api/v1/tickets/t-1': () => noContent(3),
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Archive ticket' }))
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }))

        expect(await screen.findByText('Archived “From the page”')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
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
            'POST /api/v1/documents/list': none,
            'POST /api/v1/comments/list': none,
            'POST /api/v1/boards/list': none,
            'POST /api/v1/epics/list': none,
            'POST /api/v1/sprints/list': none,
            'POST /api/v1/milestones/list': none,
            'POST /api/v1/labels/list': none,
            'POST /api/v1/saved-views/list': none,
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
            'POST /api/v1/documents/list': none,
            'POST /api/v1/comments/list': none,
            'POST /api/v1/boards/list': none,
            'POST /api/v1/epics/list': none,
            'POST /api/v1/sprints/list': none,
            'POST /api/v1/milestones/list': none,
            'POST /api/v1/labels/list': none,
            'POST /api/v1/saved-views/list': none,
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
            ...MEMBERS,
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
                        epic_id: null,
                        milestone_id: null,
                        label_ids: [],
                    },
                },
            ]),
        )
        expect(title).toHaveValue('Write the inbox')
    })

    it('keeps a blank title in the field with a reason, and saves nothing', async () => {
        const { routes, puts } = editable()
        await open('/tickets/t-1', routes)
        const user = userEvent.setup()
        const title = await screen.findByLabelText('Title')

        await user.clear(title)
        await user.tab()

        expect(title).toHaveValue('')
        expect(title).toHaveAttribute('aria-invalid', 'true')
        expect(title).toHaveAccessibleDescription('A ticket needs a title.')
        expect(puts).toEqual([])
        expect(sync.outbox).toEqual([])

        // Typing clears the reason, and a real title saves.
        await user.type(title, 'Back again')
        expect(title).not.toHaveAttribute('aria-invalid')
        await user.tab()
        await vi.waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].body.title).toBe('Back again')
    })

    it('saves status and assignee the moment they change', async () => {
        const { routes, puts } = editable()
        await open('/tickets/t-1', routes)
        const user = userEvent.setup()

        // Each change is waited out until the server's answer is applied and the
        // outbox is empty, not merely until the request arrived: the next change
        // then always starts from the version the previous answer set, rather
        // than from however far that round trip happened to get. The member
        // options come from a separate request, so they are waited for too.
        const saved = (count: number) =>
            vi.waitFor(() => {
                expect(puts).toHaveLength(count)
                expect(sync.outbox).toEqual([])
            })
        const assignee = await screen.findByLabelText('Assignee')
        await within(assignee).findByRole('option', { name: 'Sam Ortiz' })
        expect(assignee).toHaveValue('')

        await user.selectOptions(await screen.findByLabelText('Status'), 'In Progress')
        await saved(1)
        expect(puts[0].body.status_id).toBe('s-doing')

        await user.selectOptions(assignee, 'Ada Lovelace (you)')
        await saved(2)
        expect(puts[1]).toMatchObject({ ifMatch: '"4"', body: { assignee_id: ME, status_id: 's-doing' } })

        await user.selectOptions(assignee, 'Sam Ortiz')
        await saved(3)
        expect(puts[2].body.assignee_id).toBe('acc-sam')

        await user.selectOptions(assignee, 'Unassigned')
        await saved(4)
        expect(puts[3].body.assignee_id).toBeNull()
    })

    it('names another assignee from the members list', async () => {
        await open('/tickets/t-1', { ...listRoutes([ticket({ assignee_id: 'acc-sam' })]), ...MEMBERS })

        const assignee = await screen.findByLabelText('Assignee')
        await vi.waitFor(() => expect(assignee).toHaveValue('acc-sam'))
        expect(within(assignee).getByRole('option', { name: 'Sam Ortiz' })).toBeInTheDocument()
    })

    it('shows an assignee who is not a member as someone else', async () => {
        await open('/tickets/t-1', listRoutes([ticket({ assignee_id: 'acc-other' })]))

        const assignee = await screen.findByLabelText('Assignee')
        expect(assignee).toHaveValue('acc-other')
        expect(within(assignee).getByRole('option', { name: 'Someone else' })).toBeInTheDocument()
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

    it('shows the ticket placeholder, not "not found", while the first load is on its way', async () => {
        const tickets = deferred()
        await open('/tickets/t-1', {
            ...listRoutes(),
            'POST /api/v1/tickets/list': () => tickets.promise,
        })

        expect(await inMain().findByRole('status')).toHaveTextContent('Loading ticket')
        expect(screen.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()

        tickets.resolve(page([ticket()]))
        expect(await screen.findByLabelText('Title')).toHaveValue('Write the outbox')
        expect(screen.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
    })

    it('says so when there is no such ticket', async () => {
        await open('/tickets/nope', listRoutes([ticket()]))

        expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: '← Tickets' })).toHaveAttribute('href', '/')
    })
})

describe('live updates', () => {
    const edited = ticket({ title: 'Changed in another tab', version: 2, updated_by: 'acc-other' })
    const event = (type: string, row: ReturnType<typeof ticket>) => ({
        type,
        ticket_id: row.id,
        version: row.version,
        actor_id: 'acc-other',
        at: row.updated_at,
        ticket: row,
    })

    it('shows a change made elsewhere in the list and on the ticket page, as it happens', async () => {
        await open('/tickets/t-1', listRoutes([ticket()]))
        const title = (await screen.findByLabelText('Title')) as HTMLInputElement
        expect(title).toHaveValue('Write the outbox')

        FakeWebSocket.last.hello()
        FakeWebSocket.last.receive(event('ticket.updated', edited))

        await vi.waitFor(() => expect(title).toHaveValue('Changed in another tab'))
    })

    it('shows the connection in a word, polite and only on a change of state', async () => {
        await open('/', listRoutes([ticket()]))
        await screen.findByRole('link', { name: /Write the outbox/ })
        const nav = within(screen.getByRole('complementary'))

        expect(nav.getByRole('status')).toHaveTextContent('Connecting')

        FakeWebSocket.last.hello()
        await vi.waitFor(() => expect(nav.getByRole('status')).toHaveTextContent('Connected'))
        expect(nav.getByRole('status')).toHaveAttribute('aria-live', 'polite')

        FakeWebSocket.last.drop()
        await vi.waitFor(() => expect(nav.getByRole('status')).toHaveTextContent('Reconnecting'))
    })
})
