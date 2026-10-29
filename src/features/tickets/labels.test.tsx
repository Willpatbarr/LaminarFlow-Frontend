import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { BOARD, listRoutes, ME, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

// Label management, the inline create on the ticket page, and the chips on
// list rows and board cards (LAM-104), through the real route tree, store and
// engine; only `fetch` is stubbed.

const me = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: [],
}
const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const BUG = { id: 'l-1', team_id: 'team-1', name: 'bug', color: '#ef4444', ...stamp }
const UI = { id: 'l-2', team_id: 'team-1', name: 'ui', color: '#3b82f6', ...stamp }

type Routes = Parameters<typeof stubFetch>[0]
let disconnect = () => {}

async function open(url: string, routes: Routes) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me), ...routes })
    await refresh()
    const Router = createAppRouter(memoryHistory(url))
    render(() => <Router />)
}

beforeEach(() => {
    disconnect = connectSyncToSession()
})
afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const tagged = ticket({ id: 't-1', version: 3, title: 'Tagged', label_ids: ['l-1', 'l-2'], status_id: 's-todo' })

describe('label chips', () => {
    it('show on a list row, by name, and not for an id the team no longer has', async () => {
        await open('/', listRoutes([{ ...tagged, label_ids: ['l-1', 'l-2', 'l-gone'] }], [], [], { labels: [BUG, UI] }))
        const row = (await screen.findByRole('link', { name: /Tagged/ })).closest('li')!
        const chips = within(row).getByRole('list', { name: 'Labels' })
        expect(within(chips).getAllByRole('listitem').map((chip) => chip.textContent)).toEqual(['bug', 'ui'])
    })

    it('show on a board card', async () => {
        await open('/boards/b-1', listRoutes([tagged], [], [BOARD], { labels: [BUG, UI] }))
        const card = (await screen.findByRole('link', { name: 'Tagged' })).closest('li')!
        expect(within(card).getAllByRole('listitem').map((chip) => chip.textContent)).toEqual(['bug', 'ui'])
    })

    it('show on the ticket page above the picker', async () => {
        await open('/tickets/t-1', listRoutes([tagged], [], [], { labels: [BUG, UI] }))
        const group = (await screen.findByText('Labels', { selector: 'legend' })).closest('fieldset')!
        expect(within(group).getByRole('list', { name: 'Labels' })).toHaveTextContent('bugui')
    })
})

describe('creating a label from the picker', () => {
    it('makes the label, then applies it, and the chip is there before the server answers', async () => {
        const posts: unknown[] = []
        const puts: Record<string, unknown>[] = []
        await open('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1', version: 3, title: 'Plain' })], [], [], { labels: [BUG] }),
            'POST /api/v1/labels': async (request) => {
                posts.push(await bodyOf(request))
                return ok({ id: 'l-new', team_id: 'team-1', name: 'feature', color: '#22c55e', ...stamp })
            },
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                puts.push(body)
                return ok(ticket({ ...body, id: 't-1', version: 4, updated_by: ME }))
            },
        })
        const user = userEvent.setup()

        await user.type(await screen.findByLabelText('New label name'), 'feature')
        await user.click(screen.getByRole('button', { name: 'Create and apply' }))

        const box = await screen.findByRole('checkbox', { name: 'feature' })
        await vi.waitFor(() => expect(box).toBeChecked())
        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ label_ids: ['l-new'] }))
        expect(posts).toEqual([{ team_id: 'team-1', name: 'feature', color: '#22c55e' }])
        expect(screen.getByRole('list', { name: 'Labels' })).toHaveTextContent('feature')
    })

    it('applies the team\'s label of that name instead of making a second one', async () => {
        const posts: unknown[] = []
        const puts: Record<string, unknown>[] = []
        await open('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1', version: 3 })], [], [], { labels: [BUG] }),
            'POST /api/v1/labels': async (request) => {
                posts.push(await bodyOf(request))
                return problem(409, 'label_name_taken')
            },
            'PUT /api/v1/tickets/t-1': async (request) => {
                puts.push(await bodyOf(request))
                return ok(ticket({ id: 't-1', version: 4 }))
            },
        })
        const user = userEvent.setup()

        await user.type(await screen.findByLabelText('New label name'), 'Bug')
        await user.click(screen.getByRole('button', { name: 'Use “bug”' }))

        await vi.waitFor(() => expect(puts.at(-1)).toMatchObject({ label_ids: ['l-1'] }))
        expect(posts).toEqual([])
    })
})

describe('the label list in team settings', () => {
    const settings = (extra: Routes = {}) => open('/teams/team-1/settings', { ...listRoutes([tagged], [], [], { labels: [BUG, UI] }), ...extra })

    it('renames, recolours, adds and deletes, each reaching the server', async () => {
        const puts: Record<string, unknown>[] = []
        const posts: unknown[] = []
        let deleted = ''
        await settings({
            'PUT /api/v1/labels/l-1': async (request) => {
                const body = await bodyOf(request)
                puts.push(body)
                return ok({ ...BUG, ...body })
            },
            'POST /api/v1/labels': async (request) => {
                const body = await bodyOf(request)
                posts.push(body)
                return ok({ id: 'l-3', ...body, ...stamp })
            },
            'DELETE /api/v1/labels/l-2': (request) => {
                deleted = new URL(request.url).pathname
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        const list = await screen.findByRole('list', { name: 'Team labels' })

        const name = within(list).getByLabelText('Name of bug')
        await user.clear(name)
        await user.type(name, 'defect')
        await user.tab()
        await vi.waitFor(() => expect(puts).toEqual([{ name: 'defect', color: '#ef4444' }]))

        await user.selectOptions(within(list).getByLabelText('Colour of defect'), 'Violet')
        await vi.waitFor(() => expect(puts.at(-1)).toEqual({ name: 'defect', color: '#8b5cf6' }))

        await user.type(screen.getByLabelText('New label name'), 'docs')
        await user.click(screen.getByRole('button', { name: 'Add label' }))
        await vi.waitFor(() => expect(posts).toEqual([{ team_id: 'team-1', name: 'docs', color: '#22c55e' }]))
        expect(await within(list).findByLabelText('Name of docs')).toBeInTheDocument()

        await user.click(within(list).getByRole('button', { name: 'Delete ui' }))
        const dialog = await screen.findByRole('dialog', { name: /Delete .ui./ })
        expect(dialog).toHaveTextContent('1 ticket has this label')
        await user.click(within(dialog).getByRole('button', { name: 'Delete label' }))
        await vi.waitFor(() => expect(deleted).toBe('/api/v1/labels/l-2'))
        expect(within(list).queryByLabelText('Name of ui')).not.toBeInTheDocument()
    })

    it('says so when the name is taken, and Undo puts the old name back', async () => {
        await settings({ 'PUT /api/v1/labels/l-1': () => problem(409, 'label_name_taken') })
        const user = userEvent.setup()
        const list = await screen.findByRole('list', { name: 'Team labels' })

        const name = within(list).getByLabelText('Name of bug')
        await user.clear(name)
        await user.type(name, 'ui')
        await user.tab()

        expect(await within(list).findByRole('alert')).toHaveTextContent('already has a label with that name')
        await user.click(within(list).getByRole('button', { name: 'Undo this change' }))
        expect(await within(list).findByLabelText('Name of bug')).toBeInTheDocument()
    })
})
