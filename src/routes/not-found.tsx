import { Show } from 'solid-js'

import { session } from '@/features/auth'

import { usePageTitle } from './pageTitle'

// A URL no route claims. It sits inside the guard so that an anonymous user at
// a URL the app does not know yet still goes to /login first, instead of
// getting a blank page that reveals nothing and fixes nothing. While the
// session is still being asked about it says nothing at all: it has no shape of
// its own to draw a placeholder in, and "not found" would flash before a
// redirect to /login.
export function NotFoundPage() {
    usePageTitle(() => 'Page not found')
    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-page-title">Page not found</h1>
                <p class="t-body">
                    There is nothing at this address. <a href="/">Back to tickets</a>
                </p>
            </section>
        </Show>
    )
}
