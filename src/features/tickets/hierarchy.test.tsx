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
        for (const name of ['Epic', 'Sprint', 'Milestone']) {
            expect(await screen.findByLabelText(name)).toHaveDisplayValue('None')
        }
        expect(screen.getByRole('checkbox', { name: 'bug' })).not.toBeChecked()
        expect(screen.getByRole('checkbox', { name: 'ui' })).not.toBeChecked()
    })

    it('sets the epic, milestone and labels through the outbox and the sprint with its own call', async () => {
        const { all, puts, members } = routes()
        await open('/tickets/t-1', all)
        const user = userEvent.setup()

        await user.selectOptions(await screen.findByLabelText('Epic'), 'Checkout')
        await user.selectOptions(screen.getByLabelText('Milestone'), 'v1.0')
        await user.click(screen.getByRole('checkbox', { name: 'bug' }))
        await user.click(screen.getByRole('checkbox', { name: 'ui' }))
        await user.selectOptions(screen.getByLabelText('Sprint'), 'Sprint 1')

        // On screen at once, whatever the server has heard.
        expect(screen.getByLabelText('Epic')).toHaveDisplayValue('Checkout')
        expect(screen.getByRole('checkbox', { name: 'bug' })).toBeChecked()

        await vi.waitFor(() => expect(members).toEqual(['t-1']))
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: 'e-1', milestone_id: 'm-1', label_ids: ['l-1', 'l-2'] }))
        expect(screen.getByLabelText('Sprint')).toHaveDisplayValue('Sprint 1')

        await user.selectOptions(screen.getByLabelText('Epic'), 'None')
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ epic_id: null }))
    })

    it('keeps a deleted epic as "Unknown epic" until it is changed', async () => {
        await open('/tickets/t-1', {
            ...routes().all,
            'POST /api/v1/tickets/list': () => page([{ ...ticket({ version: 3 }), epic_id: 'e-gone' }]),
        })
        expect(await screen.findByLabelText('Epic')).toHaveDisplayValue('Unknown epic')
    })
})

describe('the side panel', () => {
    it('opens the ticket beside the list on a plain click, and closes back to the list', async () => {
        const history = await open('/', routes().all)
        const user = userEvent.setup()

        await user.click(await screen.findByRole('link', { name: /Write the outbox/ }))
        const panel = await screen.findByRole('complementary', { name: 'Ticket' })
        expect(history.get()).toBe('/?ticket=t-1')
        expect(await within(panel).findByLabelText('Epic')).toBeInTheDocument()
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
