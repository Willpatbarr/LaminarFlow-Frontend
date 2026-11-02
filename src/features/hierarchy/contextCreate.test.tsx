import { memoryHistory } from '@solidjs/router'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, ME, page, PROJECT, TEAM, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// "New team" and "New project in <team>" in the sidebar (LAM-199), through the real route
// tree, store and engine; only `fetch` is stubbed.

const me = (permissions: string[]) => ({
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions,
})

type Routes = Parameters<typeof stubFetch>[0]
let disconnect = () => {}

async function open(permissions: string[], routes: Routes = {}) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me(permissions)), ...listRoutes([ticket()]), ...routes })
    await refresh()
    const history = memoryHistory('/')
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

const create = () => screen.findByRole('list', { name: 'Create' })

describe('who sees the actions', () => {
    it('shows neither without team:write and project:write', async () => {
        await open(['ticket:read', 'ticket:write', 'team:read', 'project:read'])
        const list = await create()
        expect(within(list).queryByRole('button', { name: 'New team' })).toBeNull()
        expect(within(list).queryByRole('button', { name: /New project in/ })).toBeNull()
        expect(within(list).getByRole('button', { name: 'New epic' })).toBeInTheDocument()
    })

    it('shows each with its own permission, the project one naming the team', async () => {
        await open(['team:read', 'project:read', 'project:write'])
        const list = await create()
        expect(within(list).queryByRole('button', { name: 'New team' })).toBeNull()
        expect(within(list).getByRole('button', { name: 'New project in Core' })).toBeEnabled()
    })
})

describe('making a team', () => {
    it('will not send an empty name, and creates on Enter, then opens the team', async () => {
        const teams: unknown[] = [TEAM]
        let sent: Record<string, unknown> | undefined
        const history = await open(ALL_PERMISSIONS, {
            'POST /api/v1/teams/list': () => page(teams),
            'POST /api/v1/teams': async (request) => {
                sent = await bodyOf(request)
                const made = { ...TEAM, id: 'team-2', name: 'Growth' }
                teams.push(made)
                return ok(made)
            },
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'New team' }))

        const dialog = await screen.findByRole('dialog', { name: 'New team' })
        // Empty (or blank) is not allowed: the button waits for a name.
        const confirm = within(dialog).getByRole('button', { name: 'Create team' })
        expect(confirm).toBeDisabled()
        await user.type(within(dialog).getByLabelText(/Name/), '   ')
        expect(confirm).toBeDisabled()
        expect(sent).toBeUndefined()

        await user.type(within(dialog).getByLabelText(/Name/), 'Growth{Enter}')
        await vi.waitFor(() => expect(history.get()).toBe('/teams/team-2'))
        expect(sent).toMatchObject({ workspace_id: 'ws-1', name: 'Growth' })
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('puts the server\'s name conflict on the field and keeps the dialog', async () => {
        await open(ALL_PERMISSIONS, {
            'POST /api/v1/teams': () => problem(409, 'team_name_taken'),
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'New team' }))
        const dialog = await screen.findByRole('dialog', { name: 'New team' })
        await user.type(within(dialog).getByLabelText(/Name/), 'Core{Enter}')
        expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: 'New team' })).toBeInTheDocument()
    })

    it('closes on Escape without creating', async () => {
        let called = false
        await open(ALL_PERMISSIONS, { 'POST /api/v1/teams': () => ((called = true), ok(TEAM)) })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'New team' }))
        await screen.findByRole('dialog', { name: 'New team' })
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(called).toBe(false)
    })
})

describe('making a project', () => {
    it('creates it in the team in view and opens it', async () => {
        const projects: unknown[] = [PROJECT]
        let sent: Record<string, unknown> | undefined
        const history = await open(ALL_PERMISSIONS, {
            'POST /api/v1/projects/list': () => page(projects),
            'POST /api/v1/projects': async (request) => {
                sent = await bodyOf(request)
                const made = { ...PROJECT, id: 'p-2', name: 'Runtime' }
                projects.push(made)
                return ok(made)
            },
        })
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'New project in Core' }))
        const dialog = await screen.findByRole('dialog', { name: 'New project in Core' })
        await user.type(within(dialog).getByLabelText(/Name/), 'Runtime{Enter}')
        await vi.waitFor(() => expect(history.get()).toBe('/projects/p-2'))
        expect(sent).toMatchObject({ team_id: 'team-1', name: 'Runtime' })
    })
})
