import { useLocation, useNavigate, useSearchParams } from '@solidjs/router'
import type { JSX } from '@solidjs/web'
import { createEffect, Show } from 'solid-js'

import { safeReturnTo, loginPathFor } from './returnTo'
import { session } from './session'

/*
┌─ auth ──────────────────────────────────────────
│  keeps anonymous users out of the app, and signed-in users off the login screens
├─ out ───────────────────────────────────────────
│      RequireAuth                  wraps protected routes
│      useRedirectIfAuthenticated   called by the login and sign-up routes
├─ example ───────────────────────────────────────
│      anonymous at /tickets?x=1  →  /login?returnTo=%2Ftickets%3Fx%3D1
*/

type RequireAuthProps = {
    children: JSX.Element
}

// Redirects as soon as the answer is "anonymous", and shows nothing to an
// anonymous user in the meantime.
//
// `unknown` is deliberately NOT treated as anonymous: it means the first
// /auth/me has not come back, and bouncing then would send every signed-in
// user through /login on each page load. It renders the children, which
// therefore see `session.status` and decide what "still asking" looks like
// (the app layout shows its chrome with a placeholder).
//
// The redirect replaces the history entry, so Back from the login screen goes
// to where the user was before, not into a loop through the page that bounced
// them.
export function RequireAuth(props: RequireAuthProps) {
    const navigate = useNavigate()
    const location = useLocation()

    createEffect(
        () => session.status,
        (status) => {
            if (status !== 'anonymous') return
            // Read in the apply half on purpose: only the status should re-run
            // this, not every later navigation.
            navigate(loginPathFor(location.pathname + location.search + location.hash), {
                replace: true,
            })
        },
    )

    return <Show when={session.status !== 'anonymous'}>{props.children}</Show>
}

// For /login and /signup. Reacting to the status, instead of navigating from
// the form's success callback, covers both ways of arriving signed in: just
// having logged in, and opening /login while a session already exists (or
// while the first /auth/me is still on its way). `returnTo` is validated here,
// where it is used, because it comes straight from the URL.
export function useRedirectIfAuthenticated() {
    const navigate = useNavigate()
    const [params] = useSearchParams()

    createEffect(
        () => session.status,
        (status) => {
            if (status === 'authenticated') {
                navigate(safeReturnTo(params.returnTo), { replace: true })
            }
        },
    )
}
