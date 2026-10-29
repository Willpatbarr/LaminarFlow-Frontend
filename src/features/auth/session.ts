import { createStore, flush, untrack } from 'solid-js'

import { api } from '@/api/client'
import { classify } from '@/api/errors'
import { toProblem } from '@/api/problem'
import type { components } from '@/api/schema'

/*
╔═ session.ts ══════════════════════════════════════════════════════════════════════════
║  auth · who is logged in
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      session      reactive { status, me }, read-only from outside
║      refresh      GET /auth/me, then set the state from the answer
║      markExpired  the session ended while the user was in the app (the sync layer calls it)
║      recheckExpired  while that banner shows: ask /auth/me again, and clear it if the session is fine
║      login        POST /auth/login, then refresh
║      register     POST /auth/register, then refresh
║      logout       POST /auth/logout, then clear - clears even if the request fails
║      onLogout     register a function to run after the store is cleared
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
    /** The session ended while the user was in the app. `status` stays
     *  `authenticated` and `me` stays, on purpose: that is what keeps the route
     *  guard from sending them to /login mid-action, and what lets the banner
     *  prefill their email. Signing in again clears it. Never true for a visitor
     *  who arrived with no session - that is `anonymous`, and redirects. */
    expired: boolean
    /** Why the first /auth/me did not answer, while `status` is still
     *  `unknown`. The shell shows "can't reach the server" with a retry. */
    loadFailure: 'network' | 'server' | null
}

// The browser holds the session cookie (HttpOnly, so this code could not read
// it if it wanted to); this store holds only the "who am I" answer. Passwords
// never reach it.
const [state, setState] = createStore<SessionState>({
    status: 'unknown',
    me: null,
    expired: false,
    loadFailure: null,
})

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
        // Any answer about who is signed in ends a pending expiry: a new
        // session replaces it, and anonymous has nothing left to expire.
        draft.expired = false
        draft.loadFailure = null
    })
    flush()
}

/** The server turned this session down (401) while someone was using the app.
 *  Keeps them where they are; the banner asks them to sign in again. A no-op
 *  unless they are signed in - an anonymous visitor is redirected instead. */
export function markExpired(): void {
    // Called from effects, where a bare read warns and `flush()` is a no-op:
    // the read is a one-off check and the write is picked up by the flush that
    // is already running.
    if (untrack(() => state.status !== 'authenticated' || state.expired)) return
    setState((draft) => {
        draft.expired = true
    })
}

let rechecking: Promise<void> | null = null

/** For when the "signed out" banner is showing and the session may in fact be
 *  fine: a 401 that was the server's passing trouble, or a sign-in made in
 *  another tab. Asks /auth/me once. A 200 is handled exactly as a sign-in is
 *  (`set` ends the expiry): the same account lets the sync layer resume what it
 *  was holding, a different one is the different-account path it already has.
 *  A 401, any other answer, or no answer leaves the banner as it was. Does
 *  nothing when no banner is showing, and never rejects. */
export function recheckExpired(): Promise<void> {
    if (rechecking) return rechecking
    if (untrack(() => !state.expired)) return Promise.resolve()
    rechecking = (async () => {
        try {
            const { data } = await api.GET('/api/v1/auth/me')
            // The user may have signed in through the banner, or logged out,
            // while this was on the wire; either already settled it.
            if (data && untrack(() => state.expired)) set('authenticated', data)
        } catch {
            // Unreachable is not "signed in" and not "signed out": nothing to say.
        }
    })().finally(() => {
        rechecking = null
    })
    return rechecking
}

// 401 is an answer ("nobody is logged in"), so it resolves. Anything else - a
// 500, a dropped connection - is not an answer, so it throws and leaves the
// state as it was rather than logging a signed-in user out on a blip.
export async function refresh(): Promise<void> {
    const { data, error, response } = await api.GET('/api/v1/auth/me').catch((failure: unknown) => {
        noteLoadFailure('network')
        throw failure
    })
    if (data) {
        set('authenticated', data)
        return
    }
    if (classify(response) === 'unauthorized') {
        set('anonymous', null)
        return
    }
    // An answer that is not 401 and not a session: the server is there and unwell.
    noteLoadFailure('server')
    throw toProblem(response, error)
}

// Only the very first answer matters here: once we know who is signed in, a
// later failed check changes nothing on screen.
function noteLoadFailure(kind: 'network' | 'server') {
    if (state.status !== 'unknown') return
    setState((draft) => {
        draft.loadFailure = kind
    })
    flush()
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

// Who to tell once the store is cleared. A registration point rather than an
// import, so the sync layer can wipe its local data on logout without this
// feature knowing it exists.
const logoutHooks = new Set<() => void | Promise<void>>()

/** Runs `fn` after every logout, once the session store is cleared. Returns
 *  the function that unregisters it. A hook that throws is logged and does not
 *  stop the others or the logout. */
export function onLogout(fn: () => void | Promise<void>): () => void {
    logoutHooks.add(fn)
    return () => {
        logoutHooks.delete(fn)
    }
}

// The user asked to leave, so this never leaves them signed in locally: a 401
// (the session was already gone), a 5xx, and a dropped connection all end the
// same way, with the store cleared and the hooks run. The catch is that a
// failed request means the server may still hold the session, so the cookie
// can sign them straight back in on the next load; that is logged, not hidden.
// It does not reject, so a caller can navigate to /login unconditionally.
export async function logout(): Promise<void> {
    try {
        const { error, response } = await api.POST('/api/v1/auth/logout')
        if (error && classify(response) !== 'unauthorized') throw toProblem(response, error)
    } catch (failure) {
        console.error('logout request failed; signing out locally anyway', failure)
    }
    set('anonymous', null)

    // Hooks wipe local data, which must happen whatever the server said, and
    // must not depend on each other. `async` so a hook that throws before its
    // first await still lands in allSettled instead of escaping the map.
    const results = await Promise.allSettled([...logoutHooks].map(async (hook) => hook()))
    for (const result of results) {
        if (result.status === 'rejected') console.error('a logout hook failed', result.reason)
    }
}

// Hides actions; it does not guard them. The server re-checks every request,
// so a stale or tampered list can only show a button that then fails with 403.
export function can(permission: string): boolean {
    return state.me?.permissions.includes(permission) ?? false
}

/** The tooltip for a control the user may not use: "You don't have permission
 *  to <action>.", or undefined when they may. Meant for `Button`'s
 *  `disabledReason`, so every gate says the same thing the same way. */
export function denial(permission: string, action: string): string | undefined {
    return can(permission) ? undefined : `You don't have permission to ${action}.`
}
