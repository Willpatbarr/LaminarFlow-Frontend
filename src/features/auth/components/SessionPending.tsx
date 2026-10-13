import './SessionPending.css'

// What the content area shows while the first /auth/me is still on its way.
// Deliberately plain and deliberately named for the situation: LAM-69 replaces
// it with proper skeletons, so nothing else should depend on how it looks.
export function SessionPending() {
    return (
        <p class="session-pending t-meta" role="status">
            Loading…
        </p>
    )
}
