import type { JSX } from '@solidjs/web'

import './AppShell.css'

type AppShellProps = {
    /** The side nav. */
    nav: JSX.Element
    /** Persistent notices, pinned above the content (a banner). Outside
     *  `<main>`, so a screen's own status regions are not mixed up with them. */
    banners?: JSX.Element
    /** Passing notices, floated over the corner of the content (toasts). */
    toasts?: JSX.Element
    children: JSX.Element
}

// The frame every signed-in screen sits in: the rail beside the main area.
// Domain-agnostic on purpose - what goes in the rail, what the notices say, and
// what the main area shows while the session is still loading, is the caller's
// decision.
export function AppShell(props: AppShellProps) {
    return (
        <div class="app-shell">
            {props.nav}
            <div class="app-shell__column">
                <div class="app-shell__banners">{props.banners}</div>
                <main class="app-shell__main">{props.children}</main>
            </div>
            <div class="app-shell__toasts">{props.toasts}</div>
        </div>
    )
}
