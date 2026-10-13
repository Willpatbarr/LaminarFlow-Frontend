import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { refresh, session } from '../session'
import { SignUpForm } from './SignUpForm'

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

type Values = { first?: string; last?: string; email?: string; password?: string; confirm?: string }

async function fillAndSubmit(values: Values) {
    const user = userEvent.setup()
    const fields: [string, string | undefined][] = [
        ['First name', values.first],
        ['Last name', values.last],
        ['Email', values.email],
        ['Password', values.password],
        ['Confirm password', values.confirm],
    ]
    for (const [label, text] of fields) {
        if (text) await user.type(screen.getByLabelText(label), text)
    }
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
}

const valid: Values = {
    first: 'Ada',
    last: 'Lovelace',
    email: 'ada@example.com',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
}

describe('SignUpForm', () => {
    it('registers with the joined display name, then loads the account', async () => {
        const onSuccess = vi.fn()
        const fetchMock = stubFetch({
            'POST /api/v1/auth/register': () =>
                ok({ account_id: 'acc-1', workspace_id: 'ws-1', workspace_created: true }, 201),
            'GET /api/v1/auth/me': () => ok(me),
        })
        render(() => <SignUpForm onSuccess={onSuccess} />)

        await fillAndSubmit(valid)

        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
        expect(await bodyOf(fetchMock.mock.calls[0][0])).toEqual({
            email: 'ada@example.com',
            password: 'correct horse battery',
            display_name: 'Ada Lovelace',
        })
        expect(session.status).toBe('authenticated')
    })

    it('a taken email shows a message on the email field', async () => {
        stubFetch({ 'POST /api/v1/auth/register': () => problem(409, 'email_taken') })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit(valid)

        const email = screen.getByLabelText('Email')
        await vi.waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
        expect(email).toHaveAccessibleDescription('An account with this email already exists.')
        expect(email).toHaveFocus()
        expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
    })

    it('password_too_short lands on the password field', async () => {
        stubFetch({ 'POST /api/v1/auth/register': () => problem(422, 'password_too_short') })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit({ ...valid, password: 'short', confirm: 'short' })

        const password = screen.getByLabelText('Password')
        await vi.waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
        expect(password).toHaveAccessibleDescription('Use at least 10 characters.')
        expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
    })

    it('password_too_long lands on the password field', async () => {
        stubFetch({ 'POST /api/v1/auth/register': () => problem(422, 'password_too_long') })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit(valid)

        expect(await screen.findByText(/too long/)).toBeInTheDocument()
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    })

    it('a malformed-field validation error lands on that field', async () => {
        stubFetch({
            'POST /api/v1/auth/register': () =>
                problem(422, 'unprocessable_entity', [
                    { location: 'body.email', message: 'expected string to be an email' },
                ]),
        })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit({ ...valid, email: 'nope' })

        const email = screen.getByLabelText('Email')
        await vi.waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
        expect(email).toHaveAccessibleDescription('Enter a valid email address.')
    })

    it('a mismatched confirmation is caught before any request', async () => {
        const fetchMock = stubFetch({})
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit({ ...valid, confirm: 'something else entirely' })

        const confirm = screen.getByLabelText('Confirm password')
        await vi.waitFor(() => expect(confirm).toHaveAccessibleDescription('Passwords do not match.'))
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not require a last name', async () => {
        const fetchMock = stubFetch({
            'POST /api/v1/auth/register': () =>
                ok({ account_id: 'acc-1', workspace_id: 'ws-1', workspace_created: false }, 201),
            'GET /api/v1/auth/me': () => ok(me),
        })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit({ ...valid, last: undefined })

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
        expect((await bodyOf(fetchMock.mock.calls[0][0])).display_name).toBe('Ada')
    })

    it('a server error that names no field becomes a form-level alert', async () => {
        stubFetch({ 'POST /api/v1/auth/register': () => problem(500, 'internal_server_error') })
        render(() => <SignUpForm onSuccess={vi.fn()} />)

        await fillAndSubmit(valid)

        expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    })
})
