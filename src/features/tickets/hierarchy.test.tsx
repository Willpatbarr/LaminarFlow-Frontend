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
import { expectProperty, pickProperty } from '@/testing/properties'

// The pickers on the ticket page and the side panel on the list (LAM-103),
// through the real route tree, store and engine; only `fetch` is stubbed.

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
    epics: [{ id: 'e-1', project_id: 'p-1', name: 'Checkout', description: '', ...stamp }],
    sprints: [{ id: 'sp-1', project_id: 'p-1', name: 'Sprint 1', start_date: null, end_date: null, ...stamp }],
    milestones: [{ id: 'm-1', project_id: 'p-1', name: 'v1.0', description: '', target_date: null, ...stamp }],
    labels: [
        { id: 'l-1', team_id: 'team-1', name: 'bug', color: '#f00', ...stamp },
        { id: 'l-2', team_id: 'team-1', name: 'ui', color: '#00f', ...stamp },
    ],
}

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

function routes() {
    const puts: Record<string, unknown>[] = []
    const members: string[] = []
    let sprint: string[] = []
    const all: Routes = {
        // The sprint filter answers with the ticket once it is in the sprint.
        ...listRoutes([ticket({ version: 3, description: 'Before' })], [], [], HIERARCHY),
        'POST /api/v1/tickets/list': async (request) => {
            const body = await bodyOf(request)
            if (body.filter) return page(sprint.length ? [ticket({ version: 3, description: 'Before' })] : [])
            return page([ticket({ version: 3, description: 'Before' })])
        },
        'PUT /api/v1/tickets/t-1': async (request) => {
            const body = await bodyOf(request)
            puts.push(body)
            return ok(ticket({ ...body, version: 3 + puts.length, updated_by: ME }))
        },
        'POST /api/v1/sprints/sp-1/tickets': async (request) => {
            members.push((await bodyOf(request)).ticket_id)
            sprint = ['sp-1']
            return new Response(null, { status: 204 })
        },
        'GET /api/v1/tickets/t-1': () => ok(ticket({ version: 9, epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1', 'l-2'] })),
    }
    return { all, puts, members }
}

describe('the ticket page pickers', () => {
    it('reads "None" for every parent a ticket does not have', async () => {
        await open('/tickets/t-1', routes().all)
        for (const name of ['Epic', 'Sprint', 'Milestone']) await expectProperty(name, 'None')
        // No label is applied, and none is listed twice: the chips are the labels.
        expect(screen.queryByRole('list', { name: 'Labels' })).not.toBeInTheDocument()
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('sets the epic, milestone and labels through the outbox and the sprint with its own call', async () => {
        const { all, puts, members } = routes()
        await open('/tickets/t-1', all)
        const user = userEvent.setup()

        await pickProperty(user, 'Epic', 'Checkout')
        await pickProperty(user, 'Milestone', 'v1.0')
        await user.click(await screen.findByRole('button', { name: 'Add label' }))
        const labels = await screen.findByRole('listbox', { name: 'Labels' })
        await user.click(within(labels).getByRole('option', { name: 'bug' }))
        await user.click(within(labels).getByRole('option', { name: 'ui' }))
        // The list stays open for the second pick; Escape closes it.
        await user.keyboard('{Escape}')
        await pickProperty(user, 'Sprint', 'Sprint 1')

        // On screen at once, whatever the server has heard.
        await expectProperty('Epic', 'Checkout')
        expect(within(screen.getByRole('list', { name: 'Labels' })).getByText('bug')).toBeInTheDocument()

        await vi.waitFor(() => expect(members).toEqual(['t-1']))
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1', 'l-2'] }))
        await expectProperty('Sprint', 'Sprint 1')

        await pickProperty(user, 'Epic', 'None')
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: null }))
    })

    it('keeps a deleted epic as "Unknown epic" until it is changed', async () => {
        await open('/tickets/t-1', {
            ...routes().all,
            'POST /api/v1/tickets/list': () => page([{ ...ticket({ version: 3 }), epic_id: 'e-gone' }]),
        })
        await expectProperty('Epic', 'Unknown epic')
    })
})

// LAM-231: "Create new …" inside a picker makes the item and gives it to this ticket.
describe('making an epic, sprint, milestone or label from a picker', () => {
    async function createFrom(user: ReturnType<typeof userEvent.setup>, property: string, kind: string, name: string) {
        await user.click(await screen.findByRole('button', { name: new RegExp(`^${property}:`) }))
        await user.click(await screen.findByRole('button', { name: `Create new ${kind}…` }))
        const dialog = await screen.findByRole('dialog', {}, { timeout: 10_000 })
        await user.type(within(dialog).getByLabelText('Name'), name)
        await user.click(within(dialog).getByRole('button', { name: `Create ${kind}` }))
        // The dialog closes once the new row is handed to the page; a second create
        // must not start while it is still up.
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10_000 })
    }

    it('files the ticket under a new epic and a new milestone, and the pickers read them', async () => {
        const { all, puts } = routes()
        await open('/tickets/t-1', {
            ...all,
            'POST /api/v1/epics': async (request) => ok({ id: 'e-new', ...(await bodyOf(request)), ...stamp }),
            'POST /api/v1/milestones': async (request) => ok({ id: 'm-new', ...(await bodyOf(request)), ...stamp }),
        })
        const user = userEvent.setup()
        await createFrom(user, 'Epic', 'epic', 'Onboarding')
        await createFrom(user, 'Milestone', 'milestone', 'Beta')
        // Both assignments are saved in turn (the second names an id that only
        // exists once its create is answered), so wait for the last one to reach
        // the server rather than for a moment in time.
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: 'e-new', milestone_id: 'm-new' }), { timeout: 10_000 })
        await expectProperty('Epic', 'Onboarding')
        await expectProperty('Milestone', 'Beta')
        // Focus comes back to the property that was being set.
        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Milestone: Beta' })).toHaveFocus())
    }, 20_000)

    it('adds the ticket to a new sprint, replacing the one it was in', async () => {
        const { all, members } = routes()
        const removed: string[] = []
        await open('/tickets/t-1', {
            ...all,
            'POST /api/v1/sprints': async (request) => ok({ id: 'sp-new', ...(await bodyOf(request)), ...stamp }),
            'POST /api/v1/sprints/sp-new/tickets': async (request) => {
                members.push(`new:${(await bodyOf(request)).ticket_id}`)
                return new Response(null, { status: 204 })
            },
            'DELETE /api/v1/sprints/sp-1/tickets/t-1': () => {
                removed.push('sp-1')
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        await pickProperty(user, 'Sprint', 'Sprint 1')
        await vi.waitFor(() => expect(members).toEqual(['t-1']))
        await expectProperty('Sprint', 'Sprint 1')
        await createFrom(user, 'Sprint', 'sprint', 'Sprint 2')
        await vi.waitFor(() => expect(members).toContain('new:t-1'))
        await expectProperty('Sprint', 'Sprint 2')
        await vi.waitFor(() => expect(removed).toEqual(['sp-1']))
    })

    it('applies a label made from the label picker', async () => {
        const { all, puts } = routes()
        await open('/tickets/t-1', {
            ...all,
            'POST /api/v1/labels': async (request) => ok({ id: 'l-new', ...(await bodyOf(request)), ...stamp }),
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Add label' }))
        await user.type(await screen.findByRole('searchbox', { name: 'Search or create a label' }), 'urgent{Enter}')
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ label_ids: ['l-new'] }))
        expect(within(await screen.findByRole('list', { name: 'Labels' })).getByText('urgent')).toBeInTheDocument()
    })

    it('changes nothing when the dialog is cancelled', async () => {
        const { all, puts, members } = routes()
        let made = 0
        await open('/tickets/t-1', {
            ...all,
            'POST /api/v1/sprints': () => {
                made++
                return ok({})
            },
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: /^Sprint:/ }))
        await user.click(await screen.findByRole('button', { name: 'Create new sprint…' }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Name'), 'Never')
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await expectProperty('Sprint', 'None')
        expect(made).toBe(0)
        expect(puts).toEqual([])
        expect(members).toEqual([])
    })
})

describe('the side panel', () => {
    it('opens the ticket beside the list on a plain click, and closes back to the list', async () => {
        const history = await open('/', routes().all)
        const user = userEvent.setup()

        await user.click(await screen.findByRole('link', { name: /Write the outbox/ }))
        const panel = await screen.findByRole('complementary', { name: 'Ticket' })
        expect(history.get()).toBe('/?ticket=t-1')
        expect(await within(panel).findByRole('button', { name: /^Epic:/ })).toBeInTheDocument()
        expect(within(panel).getByRole('link', { name: 'Open as a page' })).toHaveAttribute('href', '/tickets/t-1')
        // The list is still there behind it.
        expect(screen.getByRole('link', { name: /Write the outbox/ })).toBeInTheDocument()

        await user.click(within(panel).getByRole('button', { name: 'Close' }))
        await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ticket' })).not.toBeInTheDocument())
        expect(history.get()).toBe('/')
    })

    it('opens from the address, so a reload or a shared link shows the same panel', async () => {
        await open('/?ticket=t-1', routes().all)
        const panel = await screen.findByRole('complementary', { name: 'Ticket' })
        expect(await within(panel).findByLabelText('Title')).toHaveValue('Write the outbox')
    })
})
