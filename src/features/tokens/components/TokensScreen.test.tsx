import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/features/auth'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { TokensScreen } from './TokensScreen'

const me = {
    account_id: 'acc-1',
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ['ticket:read', 'ticket:write', 'account:delete'],
    scopes: null,
}

const existing = {
    id: 't1',
    label: 'CI key',
    scopes: ['ticket:read'],
    created_at: '2026-10-01T10:00:00Z',
    expires_at: null,
    last_used_at: null,
}

beforeEach(async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
    await refresh()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('TokensScreen', () => {
    it('lists tokens, showing Never for a token that was not used', async () => {
        stubFetch({ 'POST /api/v1/auth/tokens/list': () => ok({ tokens: [existing] }) })
        render(() => <TokensScreen />)

        expect(await screen.findByText('CI key')).toBeInTheDocument()
        expect(screen.getByText('ticket:read')).toBeInTheDocument()
        expect(screen.getByText(/Last used Never/)).toBeInTheDocument()
    })

    it('keeps Create disabled until a scope is picked, then shows the secret once', async () => {
        const user = userEvent.setup()
        const fetchMock = stubFetch({
            'POST /api/v1/auth/tokens/list': () => ok({ tokens: [] }),
            'POST /api/v1/auth/tokens': () =>
                ok({ ...existing, id: 't2', label: 'Deploy', token: 'lam_abc_secret' }, 201),
        })
        render(() => <TokensScreen />)
        await user.click(await screen.findByRole('button', { name: 'Create token' }))

        const dialog = screen.getByRole('dialog', { name: 'Create API token' })
        const create = () => screen.getAllByRole('button', { name: 'Create token' }).at(-1)!
        await user.type(screen.getByLabelText('Name'), 'Deploy')
        expect(create()).toBeDisabled()
        // From the session's permissions, none pre-selected.
        expect(screen.getByLabelText('Tickets and content Read (ticket:read)')).not.toBeChecked()
        await user.click(screen.getByLabelText('Tickets and content Write (ticket:write)'))
        expect(create()).toBeEnabled()
        await user.click(create())

        expect(await screen.findByLabelText('Token')).toHaveValue('lam_abc_secret')
        expect(screen.getByText("You won't see this again.")).toBeInTheDocument()
        const post = fetchMock.mock.calls.find(([req]) => (req as Request).url.endsWith('/auth/tokens'))!
        expect(await bodyOf(post[0])).toEqual({ label: 'Deploy', scopes: ['ticket:write'], expires_at: null })
        expect(dialog).toBeDefined()

        // Escape and a click outside must not lose the secret.
        await user.keyboard('{Escape}')
        expect(screen.getByLabelText('Token')).toHaveValue('lam_abc_secret')
        await user.click(document.querySelector('.modal__backdrop')!)
        expect(screen.getByLabelText('Token')).toHaveValue('lam_abc_secret')
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Done' }))
        expect(screen.queryByDisplayValue('lam_abc_secret')).toBeNull()
        expect(document.body.textContent).not.toContain('lam_abc_secret')
    })

    it('describes scopes, keeps Write separate from Read, and asks twice for account:delete', async () => {
        const user = userEvent.setup()
        const fetchMock = stubFetch({
            'POST /api/v1/auth/tokens/list': () => ok({ tokens: [] }),
            'POST /api/v1/auth/tokens': () => ok({ ...existing, id: 't3', token: 'lam_x' }, 201),
        })
        render(() => <TokensScreen />)
        await user.click(await screen.findByRole('button', { name: 'Create token' }))
        const create = () => screen.getAllByRole('button', { name: 'Create token' }).at(-1)!
        await user.type(screen.getByLabelText('Name'), 'Danger')

        // Plain English beside the code; Write does not tick Read.
        expect(screen.getByText('Create, edit and archive the same things.')).toBeInTheDocument()
        expect(screen.getByText('ticket:write')).toBeInTheDocument()
        await user.click(screen.getByLabelText('Tickets and content Write (ticket:write)'))
        expect(screen.getByLabelText('Tickets and content Read (ticket:read)')).not.toBeChecked()

        // The dangerous scope is set apart, with a warning, and needs a second yes.
        const danger = screen.getByLabelText('Delete account (account:delete)')
        expect(screen.getByText(/can delete your account, without signing in/)).toBeInTheDocument()
        await user.click(danger)
        expect(create()).toBeDisabled()
        const understood = screen.getByLabelText('I understand this token could delete my account.')
        await user.click(understood)
        expect(create()).toBeEnabled()
        // Unticking the scope drops the confirmation, so ticking it again asks again.
        await user.click(danger)
        await user.click(danger)
        expect(screen.getByLabelText('I understand this token could delete my account.')).not.toBeChecked()
        expect(create()).toBeDisabled()
        await user.click(screen.getByLabelText('I understand this token could delete my account.'))
        await user.click(create())

        const post = fetchMock.mock.calls.find(([req]) => (req as Request).url.endsWith('/auth/tokens'))!
        expect((await bodyOf(post[0])).scopes).toEqual(['ticket:write', 'account:delete'])
    })

    it('puts an unknown_scope refusal under the permissions', async () => {
        const user = userEvent.setup()
        stubFetch({
            'POST /api/v1/auth/tokens/list': () => ok({ tokens: [] }),
            'POST /api/v1/auth/tokens': () => problem(422, 'unknown_scope'),
        })
        render(() => <TokensScreen />)
        await user.click(await screen.findByRole('button', { name: 'Create token' }))
        await user.type(screen.getByLabelText('Name'), 'Deploy')
        await user.click(screen.getByLabelText('Tickets and content Read (ticket:read)'))
        await user.click(screen.getAllByRole('button', { name: 'Create token' }).at(-1)!)

        expect(await screen.findByText(/not recognised/)).toBeInTheDocument()
    })

    it('revokes after confirming, then refreshes the list', async () => {
        const user = userEvent.setup()
        let revoked = false
        stubFetch({
            'POST /api/v1/auth/tokens/list': () => ok({ tokens: revoked ? [] : [existing] }),
            'DELETE /api/v1/auth/tokens/t1': () => {
                revoked = true
                return new Response(null, { status: 204 })
            },
        })
        render(() => <TokensScreen />)
        await user.click(await screen.findByRole('button', { name: 'Revoke CI key' }))
        await user.click(screen.getByRole('button', { name: 'Revoke token' }))

        expect(await screen.findByText('No API tokens yet.')).toBeInTheDocument()
    })
})
