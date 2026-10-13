import type { JSX } from '@solidjs/web'

import './AppShell.css'

type AppShellProps = {
    /** The side nav. */
    nav: JSX.Element
    children: JSX.Element
}

// The frame every signed-in screen sits in: the rail beside the main area.
// Domain-agnostic on purpose - what goes in the rail, and what the main area
// shows while the session is still loading, is the caller's decision.
export function AppShell(props: AppShellProps) {
    return (
        <div class="app-shell">
            {props.nav}
            <main class="app-shell__main">{props.children}</main>
        </div>
    )
}
