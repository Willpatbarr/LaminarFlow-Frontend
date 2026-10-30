import { memoryHistory } from '@solidjs/router'
import { render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, ME, ticket } from '@/sync/testing/harness'
import { ok, stubFetch } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

// What a token limited to reading looks like. The web app signs in with a
// session, which has every permission, so this is the only place the narrowed
// case is exercised: /auth/me is stubbed to report a permission list.

const meWith = (permissions: string[]) => ({
    account_id: ME,
    via: 'token',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions,
})

let disconnect = () => {}

async function open(url: string, permissions: string[]) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(meWith(permissions)), ...listRoutes([ticket({ id: 't-1', title: 'Write the outbox' })]) })
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

describe('without ticket:write', () => {
    it('disables the list controls and says why', async () => {
        await open('/', ['ticket:read'])
        await screen.findByRole('link', { name: /Write the outbox/ })

        for (const name of ['New ticket', /^Edit/, /^Archive/]) {
            const button = screen.getByRole('button', { name })
            expect(button).toBeDisabled()
        }
        expect(screen.getAllByRole('tooltip').map((t) => t.textContent)).toContain(
            "You don't have permission to create tickets.",
        )
        expect(screen.getByRole('button', { name: 'New ticket' })).toHaveAccessibleDescription(
            "You don't have permission to create tickets.",
        )
    })

    it('renders the ticket page read-only, with no way to archive', async () => {
        await open('/tickets/t-1', ['ticket:read'])
        const title = await screen.findByDisplayValue('Write the outbox')

        expect(title).toHaveAttribute('readonly')
        expect(screen.getByRole('button', { name: 'Archive ticket' })).toBeDisabled()
        expect(screen.getByText("You don't have permission to edit tickets.", { selector: 'p' })).toBeInTheDocument()
    })

    it('offers no "New epic" style shortcuts in the side nav', async () => {
        await open('/', ['ticket:read'])
        await screen.findByRole('link', { name: /Write the outbox/ })

        expect(screen.queryByRole('button', { name: /^New (epic|sprint|milestone)/ })).not.toBeInTheDocument()
    })
})

describe('with every permission', () => {
    it('leaves the controls enabled', async () => {
        await open('/', ALL_PERMISSIONS)
        await screen.findByRole('link', { name: /Write the outbox/ })

        expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled()
        expect(screen.getByRole('button', { name: /^Edit/ })).toBeEnabled()
        expect(screen.getByRole('button', { name: /^New epic/ })).toBeInTheDocument()
        // The row buttons' tooltips are always there; none of them is a denial.
        expect(screen.queryByText(/don't have permission/)).not.toBeInTheDocument()
    })
})
