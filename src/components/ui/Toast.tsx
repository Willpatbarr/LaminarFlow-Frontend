import { createEffect, createSignal, Show } from 'solid-js'

import { Button } from './Button'
import type { NoticeHue } from './Banner'
import { Icon } from './icons/Icon'
import './Toast.css'

type ToastProps = {
    title: string
    /** Say what happened to the *work*, not to the request: a queued change is
     *  not a lost change. */
    detail?: string
    /** The badge. Defaults to the `warning` exclamation; a good outcome passes
     *  `check`. Both are the coolicons Icon, not a text glyph. */
    mark?: 'check'
    /** Defaults to `rust`, the spec's default. `amber` is for a warning (work
     *  is safe but not done), and callers that mean it must say so. */
    hue?: NoticeHue
    role?: 'status' | 'alert'
    action?: string
    onAction?: () => void
    onDismiss?: () => void
    /** Stays until dismissed, used or replaced. For a message that stays true
     *  (the server is unreachable) or that the reader must not miss. Everything
     *  else times out, and needs `onDismiss` for the timer to have anything to do. */
    persistent?: boolean
    /** Change it to start the timer again when the same toast is announced
     *  again with new content (a second "Create more", a second request). */
    timerKey?: unknown
}

/** How long a timed toast stays before it dismisses itself. */
export const TOAST_TIMEOUT_MS = 8000

// From the Toast and Banner specimen. A toast floats, so it is one of the few
// things with a shadow; its action is the shared Button at `sm`, secondary,
// because the primary action on the screen is still whatever the user was
// doing.
//
// A toast times out after TOAST_TIMEOUT_MS unless it is `persistent`, and the
// timer stands still while the pointer is over it or focus is inside it, then
// starts again in full, so it can be read and used at the reader's pace. Never
// any focus movement: a toast pulling the cursor out of the field being typed
// in is worse than one that lingers.
export function Toast(props: ToastProps) {
    const [hovered, setHovered] = createSignal(false)
    const [focused, setFocused] = createSignal(false)

    createEffect(
        () => ({ on: !props.persistent && !!props.onDismiss && !hovered() && !focused(), key: props.timerKey }),
        ({ on }) => {
            if (!on) return
            const timer = setTimeout(() => props.onDismiss?.(), TOAST_TIMEOUT_MS)
            return () => clearTimeout(timer)
        },
    )

    return (
        <div
            class="toast"
            data-hue={props.hue ?? 'rust'}
            role={props.role ?? 'status'}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocusIn={() => setFocused(true)}
            onFocusOut={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
            }}
        >
            <span class="toast__mark" aria-hidden="true">
                <Icon name={props.mark === 'check' ? 'check' : 'warning'} size={12} />
            </span>
            <div class="toast__body">
                <span class="toast__title t-body">{props.title}</span>
                <Show when={props.detail}>
                    <span class="toast__detail t-meta">{props.detail}</span>
                </Show>
                <Show when={props.action}>
                    <span class="toast__action">
                        <Button variant="secondary" size="sm" onClick={() => props.onAction?.()}>
                            {props.action}
                        </Button>
                    </span>
                </Show>
            </div>
            <Show when={props.onDismiss}>
                <button
                    type="button"
                    class="toast__dismiss"
                    aria-label="Dismiss"
                    onClick={() => props.onDismiss?.()}
                >
                    <Icon name="close" size={16} />
                </button>
            </Show>
        </div>
    )
}
