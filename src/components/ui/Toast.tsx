import { Show } from 'solid-js'

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
        <div class="toast" data-hue={props.hue ?? 'rust'} role={props.role ?? 'status'}>
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
