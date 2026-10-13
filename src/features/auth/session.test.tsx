import { render, screen } from '@solidjs/testing-library'
import { Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiProblem } from '@/api/problem'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { can, login, logout, refresh, register, session } from './session'

const me = {
    account_id: 'acc-1',
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ['ticket:write'],
}

afterEach(() => {
    vi.unstubAllGlobals()
})

// The store is module state, so every test starts by asking the (stubbed)
// server and getting "nobody".
beforeEach(async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => problem(401, 'unauthorized') })
    await refresh()
})

describe('session store', () => {
    it('starts anonymous after the server says nobody is logged in', () => {
        expect(session.status).toBe('anonymous')
        expect(session.me).toBeNull()
    })

    it('login posts the credentials, then fills the store from /auth/me', async () => {
        const fetchMock = stubFetch({
            'POST /api/v1/auth/login': () => ok({ account_id: 'acc-1' }),
            'GET /api/v1/auth/me': () => ok(me),
        })

        await login('ada@example.com', 'correct horse battery')

        expect(await bodyOf(fetchMock.mock.calls[0][0])).toEqual({
            email: 'ada@example.com',
            password: 'correct horse battery',
        })
        expect(session.status).toBe('authenticated')
        expect(session.me?.display_name).toBe('Ada Lovelace')
        expect(JSON.stringify(session)).not.toContain('correct horse battery')
    })

    it('register posts display_name and then loads the account', async () => {
        const fetchMock = stubFetch({
            'POST /api/v1/auth/register': () =>
                ok({ account_id: 'acc-1', workspace_id: 'ws-1', workspace_created: true }, 201),
            'GET /api/v1/auth/me': () => ok(me),
        })

        await register('ada@example.com', 'correct horse battery', 'Ada Lovelace')

        expect(await bodyOf(fetchMock.mock.calls[0][0])).toEqual({
            email: 'ada@example.com',
            password: 'correct horse battery',
            display_name: 'Ada Lovelace',
        })
        expect(session.status).toBe('authenticated')
    })

    it('a rejected login throws the problem and leaves the store anonymous', async () => {
        stubFetch({ 'POST /api/v1/auth/login': () => problem(401, 'invalid_login') })

        await expect(login('ada@example.com', 'wrong')).rejects.toMatchObject({
            status: 401,
            code: 'invalid_login',
        })
        await expect(login('ada@example.com', 'wrong')).rejects.toBeInstanceOf(ApiProblem)
        expect(session.status).toBe('anonymous')
    })

    it('refresh keeps a signed-in user signed in through a server error', async () => {
        stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
        await refresh()
        stubFetch({ 'GET /api/v1/auth/me': () => problem(500, 'internal_server_error') })

        await expect(refresh()).rejects.toMatchObject({ status: 500 })

        expect(session.status).toBe('authenticated')
    })

    it('logout clears the store', async () => {
        stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
        await refresh()
        stubFetch({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) })

        await logout()

        expect(session.status).toBe('anonymous')
        expect(session.me).toBeNull()
    })
})

describe('can', () => {
    it('is false for nobody, and reflects the permissions list once signed in', async () => {
        expect(can('ticket:write')).toBe(false)

        stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
        await refresh()

        expect(can('ticket:write')).toBe(true)
        expect(can('ticket:delete')).toBe(false)
    })

    it('follows a narrowed list on the next refresh', async () => {
        stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
        await refresh()
        stubFetch({ 'GET /api/v1/auth/me': () => ok({ ...me, permissions: [] }) })
        await refresh()

        expect(can('ticket:write')).toBe(false)
    })

    it('updates a component that gates on it', async () => {
        stubFetch({ 'GET /api/v1/auth/me': () => ok(me) })
        await refresh()
        render(() => (
            <Show when={can('ticket:write')}>
                <button type="button">New ticket</button>
            </Show>
        ))
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument()

        stubFetch({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) })
        await logout()

        expect(screen.queryByRole('button', { name: 'New ticket' })).not.toBeInTheDocument()
    })
})
