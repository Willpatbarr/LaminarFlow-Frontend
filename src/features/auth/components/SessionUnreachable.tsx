import { createSignal, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'

import { refresh, session } from '../session'
import './SessionPending.css'

// What the content area shows when the very first /auth/me got no usable
// answer (the server is down, or the network is). Without it the app would
// show "Loading…" for as long as the server stays away. Retry asks again; the
// session store clears the failure when any answer lands, and this goes with it.
export function SessionUnreachable() {
    const [trying, setTrying] = createSignal(false)
    const [again, setAgain] = createSignal(false)

    async function retry() {
        setTrying(true)
        try {
            await refresh()
        } catch {
            // `refresh` has recorded why; the message below stays.
            setAgain(true)
        } finally {
            setTrying(false)
        }
    }

    return (
        <section class="session-unreachable" role="status">
            <h1 class="t-section">
                {session.loadFailure === 'server'
                    ? 'The server is having trouble'
                    : "Can't reach the server"}
            </h1>
            <p class="t-body">Check your connection, then try again.</p>
            <Show when={again() && !trying()}>
                <p class="t-meta">Still no answer.</p>
            </Show>
            <div>
                <Button variant="secondary" onClick={() => void retry()} disabled={trying()}>
                    {trying() ? 'Trying…' : 'Retry'}
                </Button>
            </div>
        </section>
    )
}
