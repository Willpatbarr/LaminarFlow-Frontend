import { screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, PROJECT, TEAM } from '@/sync/testing/harness'
import { openApp } from '@/testing/app'

// Team and project pages and the sidebar, against the real store with only
// fetch stubbed.
let disconnect: () => void

beforeEach(() => {
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

it('shows the team switcher and its projects in the sidebar', async () => {
    await openApp('/', listRoutes())

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(await screen.findByLabelText('Team')).toHaveValue(TEAM.id)
    expect(await screen.findByRole('link', { name: PROJECT.name })).toHaveAttribute(
        'href',
        `/projects/${PROJECT.id}`,
    )
    expect(nav).toBeInTheDocument()
})

it('lists the team projects at /teams/:id, and switching teams navigates there', async () => {
    const history = await openApp(`/teams/${TEAM.id}`, listRoutes())

    expect(await screen.findByRole('heading', { name: TEAM.name })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: PROJECT.name })).not.toHaveLength(0)

    await userEvent.setup().selectOptions(await screen.findByLabelText('Team'), TEAM.id)
    expect(history.get()).toBe(`/teams/${TEAM.id}`)
})

it('opens a project by URL and shows its tickets page', async () => {
    await openApp(`/projects/${PROJECT.id}`, listRoutes())

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
})

it('says so for a team or project the account does not have', async () => {
    await openApp('/teams/nope', listRoutes())
    expect(await screen.findByRole('heading', { name: 'Team not found' })).toBeInTheDocument()
})

it('says so for an unknown project', async () => {
    await openApp('/projects/nope', listRoutes())
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
})
