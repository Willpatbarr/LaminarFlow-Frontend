import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { refresh, session } from '../session'
import { LoginForm } from './LoginForm'

const me = {
    account_id: 'acc-1',
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: ['ticket:write'],
}

beforeEach(async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => problem(401, 'unauthorized') })
    await refresh()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

async function fillAndSubmit(email: string, password: string) {
    const user = userEvent.setup()
    if (email) await user.type(screen.getByLabelText('Email'), email)
    if (password) await user.type(screen.getByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('LoginForm', () => {
    it('a successful login populates the store and reports success', async () => {
        const onSuccess = vi.fn()
        const fetchMock = stubFetch({
            'POST /api/v1/auth/login': () => ok({ account_id: 'acc-1' }),
            'GET /api/v1/auth/me': () => ok(me),
        })
        render(() => <LoginForm onSuccess={onSuccess} />)

        await fillAndSubmit('ada@example.com', 'correct horse battery')

        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
        expect(session.status).toBe('authenticated')
        expect(session.me?.display_name).toBe('Ada Lovelace')
        expect(await bodyOf(fetchMock.mock.calls[0][0])).toEqual({
            email: 'ada@example.com',
            password: 'correct horse battery',
        })
    })

    it('a 401 shows a form-level message and marks no field invalid', async () => {
        const onSuccess = vi.fn()
        stubFetch({ 'POST /api/v1/auth/login': () => problem(401, 'invalid_login') })
        render(() => <LoginForm onSuccess={onSuccess} />)

        await fillAndSubmit('ada@example.com', 'wrong password')

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'That email and password do not match.',
        )
        expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
        expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
        expect(onSuccess).not.toHaveBeenCalled()
        expect(session.status).toBe('anonymous')
    })

    it('a validation error lands on the field its location names', async () => {
        stubFetch({
            'POST /api/v1/auth/login': () =>
                problem(422, 'unprocessable_entity', [
                    { location: 'body.email', message: 'expected string to be an email' },
                ]),
        })
        render(() => <LoginForm onSuccess={vi.fn()} />)

        await fillAndSubmit('not-an-email', 'whatever it is')

        const email = screen.getByLabelText('Email')
        await vi.waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
        expect(email).toHaveAccessibleDescription('Enter a valid email address.')
        expect(email).toHaveFocus()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('an empty submit names the empty fields without calling the server', async () => {
        const fetchMock = stubFetch({})
        render(() => <LoginForm onSuccess={vi.fn()} />)

        await fillAndSubmit('', '')

        expect(await screen.findByText('Enter your email.')).toBeInTheDocument()
        expect(screen.getByText('Enter your password.')).toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('clears a field message as soon as the field is edited', async () => {
        stubFetch({})
        render(() => <LoginForm onSuccess={vi.fn()} />)
        await fillAndSubmit('', '')
        await screen.findByText('Enter your email.')

        await userEvent.type(screen.getByLabelText('Email'), 'a')

        expect(screen.queryByText('Enter your email.')).not.toBeInTheDocument()
    })

    it('says so when the server cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new TypeError('Failed to fetch')
        }))
        render(() => <LoginForm onSuccess={vi.fn()} />)

        await fillAndSubmit('ada@example.com', 'correct horse battery')

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
    })
})
