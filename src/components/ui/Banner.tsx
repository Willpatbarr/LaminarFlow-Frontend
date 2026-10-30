import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'
import { Icon } from './icons/Icon'

import './Banner.css'

export type NoticeHue = 'amber' | 'slate' | 'rust' | 'green' | 'blue'

type BannerProps = {
    /** Defaults to `amber`: a banner says "this needs a moment of your
     *  attention", not "something broke". */
    hue?: NoticeHue
    /** `status` is polite and the right default; `alert` interrupts, and is for
     *  something the reader must see now. */
    role?: 'status' | 'alert'
    /** The message. */
    children: JSX.Element
    /** The one thing the reader can do about it, inline at the end. */
    action?: string
    onAction?: () => void
    /** Set while the action is under way. */
    actionBusy?: boolean
    /** `aria-expanded` for an action that reveals something below the banner. */
    actionExpanded?: boolean
    /** Adds a dismiss button. Absent for a banner that goes away by itself once
     *  the thing it reports is fixed. */
    onDismiss?: () => void
    /** More than a line can hold - an inline form. Sits under the message. */
    details?: JSX.Element
}

// From the Toast and Banner specimen: a tint rather than a surface, no shadow,
// because it is part of the page rather than floating over it. The message and
// its action share one row; `details` is the one addition, for the session
// banner whose sign-in form opens beneath the sentence.
//
// The live region is the banner itself and is mounted with its text already in
// it. That is announced when it appears, which is what is wanted, and nothing
// here ever moves focus: the reader is in the middle of something.
export function Banner(props: BannerProps) {
    return (
        <div
            class="banner"
            data-hue={props.hue ?? 'amber'}
            role={props.role ?? 'status'}
        >
            <div class="banner__row">
                <span class="banner__dot" aria-hidden="true" />
                <span class="banner__text t-meta">{props.children}</span>
                <Show when={props.action}>
                    <button
                        type="button"
                        class="banner__action t-meta"
                        onClick={() => props.onAction?.()}
                        disabled={props.actionBusy}
                        aria-expanded={
                            props.actionExpanded === undefined
                                ? undefined
                                : props.actionExpanded
                                  ? 'true'
                                  : 'false'
                        }
                    >
                        {props.action}
                    </button>
                </Show>
                <Show when={props.onDismiss}>
                    <button
                        type="button"
                        class="banner__dismiss t-meta"
                        aria-label="Dismiss"
                        onClick={() => props.onDismiss?.()}
                    >
                        <Icon name="close" size={16} />
                    </button>
                </Show>
            </div>
            <Show when={props.details}>
                <div class="banner__details">{props.details}</div>
            </Show>
        </div>
    )
}
