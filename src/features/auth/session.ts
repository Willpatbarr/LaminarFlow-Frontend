import { createStore, flush } from 'solid-js'

import { api } from '@/api/client'
import { toProblem } from '@/api/problem'
import type { components } from '@/api/schema'

/*
╔═ session.ts ══════════════════════════════════════════════════════════════════════════
║  auth · who is logged in
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      session      reactive { status, me }, read-only from outside
║      refresh      GET /auth/me, then set the state from the answer
║      login        POST /auth/login, then refresh
║      register     POST /auth/register, then refresh
║      logout       POST /auth/logout, then clear
║      can          does the signed-in account hold this permission
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      the login and sign-up forms, route guards, the sync engine
╚═══════════════════════════════════════════════════════════════════════════════════════
*/

export type Me = components['schemas']['MeOutputBody']

// `unknown` is "have not asked yet", which is a different fact from
// `anonymous` ("asked, and nobody is logged in"). A guard that treats them the
// same would bounce a logged-in user to /login on every page load.
export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated'

export type SessionState = {
    status: SessionStatus
    me: Me | null
}

// The browser holds the session cookie (HttpOnly, so this code could not read
// it if it wanted to); this store holds only the "who am I" answer. Passwords
// never reach it.
const [state, setState] = createStore<SessionState>({ status: 'unknown', me: null })

// The store itself, typed read-only: writes go through the functions below so
// `status` and `me` cannot drift apart. It is plain module state rather than
// context, so non-component code (the sync engine) can read it too.
export const session: Readonly<SessionState> = state

// Solid 2 batches writes: a read straight after a write still sees the old
// value until the next flush. Outside a component nothing else triggers one
// before the caller's next line, so every write here flushes explicitly.
function set(status: SessionStatus, me: Me | null) {
    setState((draft) => {
        draft.status = status
        draft.me = me
    })
    flush()
}

// 401 is an answer ("nobody is logged in"), so it resolves. Anything else - a
// 500, a dropped connection - is not an answer, so it throws and leaves the
// state as it was rather than logging a signed-in user out on a blip.
export async function refresh(): Promise<void> {
    const { data, error, response } = await api.GET('/api/v1/auth/me')
    if (data) {
        set('authenticated', data)
        return
    }
    if (response.status === 401) {
        set('anonymous', null)
        return
    }
    throw toProblem(response, error)
}

// Both endpoints set the cookie, but neither returns the permissions, so a
// success is followed by /auth/me rather than assembled from the response.
export async function login(email: string, password: string): Promise<void> {
    const { error, response } = await api.POST('/api/v1/auth/login', {
        body: { email, password },
    })
    if (error) throw toProblem(response, error)
    await refresh()
}

export async function register(email: string, password: string, displayName: string): Promise<void> {
    const { error, response } = await api.POST('/api/v1/auth/register', {
        body: { email, password, display_name: displayName },
    })
    if (error) throw toProblem(response, error)
    await refresh()
}

// A 401 on logout means the session was already gone, which is the state the
// caller wanted.
export async function logout(): Promise<void> {
    const { error, response } = await api.POST('/api/v1/auth/logout')
    if (error && response.status !== 401) throw toProblem(response, error)
    set('anonymous', null)
}

// Hides actions; it does not guard them. The server re-checks every request,
// so a stale or tampered list can only show a button that then fails with 403.
export function can(permission: string): boolean {
    return state.me?.permissions.includes(permission) ?? false
}
