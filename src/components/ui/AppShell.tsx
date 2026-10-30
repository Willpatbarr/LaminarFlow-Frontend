import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, createUniqueId, Show } from 'solid-js'

import { useNarrowScreen } from './useNarrowScreen'
import { Icon } from './icons/Icon'
import './AppShell.css'

type AppShellProps = {
    /** The side nav. */
    nav: JSX.Element
    /** Persistent notices, pinned above the content (a banner). Outside
     *  `<main>`, so a screen's own status regions are not mixed up with them. */
    banners?: JSX.Element
    /** Passing notices, floated over the corner of the content (toasts). */
    toasts?: JSX.Element
    /** Narrow screens only: the page or section in view, shown in the top bar. */
    title?: string
    /** Narrow screens only: a quiet status that stays in the top bar while the
     *  drawer is shut (sync state). */
    status?: JSX.Element
    /** Narrow screens only: changes whenever the user has gone somewhere (the
     *  path). The drawer shuts when it does. */
    route?: string
    /** Narrow screens only: a Search button in the top bar, beside the menu button. */
    onSearch?: (button: HTMLButtonElement) => void
    children: JSX.Element
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
// A click on one of these inside the drawer is "going somewhere", so the drawer
// gets out of the way: a link, or a button that opens a dialog.
const GOES_SOMEWHERE = 'a[href], .side-nav__create, .side-nav__search, .side-nav__logout'

// The frame every signed-in screen sits in: the rail beside the main area.
// Domain-agnostic on purpose - what goes in the rail, what the notices say, and
// what the main area shows while the session is still loading, is the caller's
// decision.
//
// Below 768px the rail does not fit beside the content, so it becomes a drawer:
// a slim top bar (menu button, where you are, the status) stays on screen and
// the same nav slides over the content from the left. Nothing is dropped from
// it. While it is open it behaves like a dialog: focus moves in, the content
// behind is inert, and Escape, a tap outside, the menu button again or
// navigating shut it and put focus back on the menu button.
export function AppShell(props: AppShellProps) {
    const narrow = useNarrowScreen()
    const [open, setOpen] = createSignal(false)
    const drawerId = createUniqueId()
    let menuButton: HTMLButtonElement | undefined
    let drawer: HTMLDivElement | undefined

    const shut = () => setOpen(false)
    const drawerOpen = () => narrow() && open()

    // A wide screen has no drawer; a navigation closes it.
    createEffect(
        () => narrow(),
        (isNarrow) => {
            if (!isNarrow) shut()
        },
    )
    createEffect(
        () => props.route,
        () => {
            shut()
        },
    )

    // While open: focus goes in, Escape shuts it; on close focus returns to the
    // menu button unless something else (a dialog the drawer opened) has it.
    createEffect(drawerOpen, (isOpen) => {
        if (!isOpen) return
        // After the browser has laid the drawer out as visible and not inert:
        // focus does not land on something that was hidden a moment ago.
        const frame = requestAnimationFrame(() => {
            // The first control that is actually on screen (the collapse button
            // is hidden in the drawer).
            const first = [...(drawer?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find(
                (el) => el.checkVisibility?.() !== false,
            )
            ;(first ?? drawer)?.focus()
        })
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            shut()
        }
        document.addEventListener('keydown', onKey)
        return () => {
            cancelAnimationFrame(frame)
            document.removeEventListener('keydown', onKey)
            const at = document.activeElement
            if (at === document.body || at === null || drawer?.contains(at)) menuButton?.focus()
        }
    })

    return (
        <div class={`app-shell${narrow() ? ' app-shell--narrow' : ''}`}>
            <Show when={narrow()} fallback={props.nav}>
                <header class="app-shell__topbar">
                    <button
                        type="button"
                        ref={(el) => (menuButton = el)}
                        class="app-shell__menu"
                        aria-label="Menu"
                        aria-expanded={drawerOpen() ? 'true' : 'false'}
                        aria-controls={drawerId}
                        onClick={() => setOpen(!open())}
                    >
                        <Icon name="menu" />
                    </button>
                    <span class="app-shell__title t-cell">{props.title}</span>
                    <Show when={props.onSearch}>
                        {(onSearch) => (
                            <button
                                type="button"
                                class="app-shell__menu app-shell__search"
                                aria-label="Search"
                                onClick={(event) => onSearch()(event.currentTarget)}
                            >
                                <Icon name="search" />
                            </button>
                        )}
                    </Show>
                    <div class="app-shell__status">{props.status}</div>
                </header>
                <div
                    id={drawerId}
                    ref={(el) => (drawer = el)}
                    class={`app-shell__drawer${drawerOpen() ? ' app-shell__drawer--open' : ''}`}
                    tabindex="-1"
                    inert={!drawerOpen()}
                    onClick={(event) => {
                        if ((event.target as Element).closest(GOES_SOMEWHERE)) shut()
                    }}
                >
                    {props.nav}
                </div>
                <div class="app-shell__scrim" hidden={!drawerOpen()} aria-hidden="true" onClick={shut} />
            </Show>
            <div class="app-shell__column" inert={drawerOpen()}>
                <div class="app-shell__banners">{props.banners}</div>
                <main class="app-shell__main">{props.children}</main>
            </div>
            <div class="app-shell__toasts">{props.toasts}</div>
        </div>
    )
}
