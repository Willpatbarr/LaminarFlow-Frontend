import { Show } from 'solid-js'

import { Button } from './Button'
import type { NoticeHue } from './Banner'
import './Toast.css'

type ToastProps = {
    title: string
    /** Say what happened to the *work*, not to the request: a queued change is
     *  not a lost change. */
    detail: string
    /** Defaults to `amber`. `rust` is for something that is actually lost. */
    hue?: NoticeHue
    role?: 'status' | 'alert'
    action?: string
    onAction?: () => void
    onDismiss?: () => void
}

// From the Toast and Banner specimen. A toast floats, so it is one of the few
// things with a shadow; its action is the shared Button at `sm`, secondary,
// because the primary action on the screen is still whatever the user was
// doing.
//
// No auto-dismiss and no focus movement. A message that disappears on a timer
// cannot be read at the reader's pace (or at all, by a screen reader still
// speaking the last thing), and one that takes focus pulls the cursor out of
// the field being typed in.
export function Toast(props: ToastProps) {
    return (
        <div class="toast" data-hue={props.hue ?? 'amber'} role={props.role ?? 'status'}>
            <span class="toast__mark" aria-hidden="true">
                !
            </span>
            <div class="toast__body">
                <span class="toast__title t-body">{props.title}</span>
                <span class="toast__detail t-meta">{props.detail}</span>
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
                    <span aria-hidden="true">×</span>
                </button>
            </Show>
        </div>
    )
}
