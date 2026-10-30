import { screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, PROJECT, TEAM } from '@/sync/testing/harness'
import { openApp } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

// LAM-149, against the real store and engine with only fetch stubbed.
let disconnect: () => void

beforeEach(() => {
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const SETTINGS = `/teams/${TEAM.id}/settings`

it('renames the team from its settings: sends the trimmed name, and the page shows it', async () => {
    const user = userEvent.setup()
    let body: unknown
    await openApp(SETTINGS, {
        ...listRoutes(),
        [`PUT /api/v1/teams/${TEAM.id}`]: async (request) => {
            body = await bodyOf(request)
            return ok({ ...TEAM, name: 'Platform' })
        },
    })
    const field = await screen.findByLabelText('Team name')
    expect(field).toHaveValue('Core')
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()

    await user.clear(field)
    await user.type(field, '  Platform ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(body).toEqual({ name: 'Platform' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '← Platform' })).toBeInTheDocument()
})

it('refuses a blank team name without asking the server', async () => {
    const user = userEvent.setup()
    const put = vi.fn(() => ok(TEAM))
    await openApp(SETTINGS, { ...listRoutes(), [`PUT /api/v1/teams/${TEAM.id}`]: put })
    const field = await screen.findByLabelText('Team name')

    await user.clear(field)
    await user.type(field, '   ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText('A team needs a name.')).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
})

it('says so when another team already has the name, and keeps what was typed', async () => {
    const user = userEvent.setup()
    await openApp(SETTINGS, {
        ...listRoutes(),
        [`PUT /api/v1/teams/${TEAM.id}`]: () => problem(409, 'team_name_taken'),
    })
    const field = await screen.findByLabelText('Team name')

    await user.clear(field)
    await user.type(field, 'Taken')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText(/Another team in this workspace already has that name/)).toBeInTheDocument()
    expect(field).toHaveValue('Taken')
    expect(screen.getByText('Not saved.')).toBeInTheDocument()
})

it('renames the project from its heading, and the heading shows the new name', async () => {
    const user = userEvent.setup()
    let body: unknown
    await openApp(`/projects/${PROJECT.id}`, {
        ...listRoutes(),
        [`PUT /api/v1/projects/${PROJECT.id}`]: async (request) => {
            body = await bodyOf(request)
            return ok({ ...PROJECT, name: 'Ship it' })
        },
    })
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Rename project' }))
    const field = await screen.findByLabelText('Project name')
    await user.clear(field)
    await user.type(field, 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(body).toEqual({ name: 'Ship it' }))
    expect(await screen.findByRole('heading', { name: 'Ship it' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Project name')).not.toBeInTheDocument()
})

it('cancels a project rename with Escape and refuses a blank name', async () => {
    const user = userEvent.setup()
    const put = vi.fn(() => ok(PROJECT))
    await openApp(`/projects/${PROJECT.id}`, { ...listRoutes(), [`PUT /api/v1/projects/${PROJECT.id}`]: put })
    await screen.findByRole('heading', { name: 'Launch' })

    await user.click(screen.getByRole('button', { name: 'Rename project' }))
    let field = await screen.findByLabelText('Project name')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByText('A project needs a name.')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Rename project' }))
    field = await screen.findByLabelText('Project name')
    expect(field).toHaveValue('Launch')
})
