import { Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Tooltip } from './Tooltip'

import './Button.css'

// Domain-agnostic by construction: no ticket, document, or aspect appears in
// these props. That is the test for whether a component belongs in this folder.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

type ButtonProps = {
    children: JSX.Element
    onClick?: () => void
    /** `submit` makes the button the form's default action. */
    type?: 'button' | 'submit'
    disabled?: boolean
    /** Disables the button and explains why in a tooltip. Pass `undefined` for
     *  a button that is allowed. */
    disabledReason?: string
    /** Defaults to `primary`. */
    variant?: ButtonVariant
    /** `sm` is for a button sitting inside another surface (a toast). */
    size?: 'md' | 'sm'
    /** The id of text that explains what the button does beyond its name. */
    describedBy?: string
    /** Names the button when its text alone is not enough ("Edit" on every row). */
    'aria-label'?: string
    /** Receives the <button>, so a dialog can put focus on it. */
    ref?: (el: HTMLButtonElement) => void
}

// The four skins of the Button variants specimen. `variant` arrived with the
// Modal (LAM-67), whose footer is a ghost cancel beside a primary or danger
// confirm; until then every screen used primary alone.
//
// Props are read as `props.x`, never destructured: destructuring takes a
// one-time snapshot and silently drops reactivity.
export function Button(props: ButtonProps) {
    const button = (describedBy?: string) => (
        <button
            ref={props.ref}
            type={props.type ?? 'button'}
            class={`button button--${props.variant ?? 'primary'}${props.size === 'sm' ? ' button--sm' : ''}`}
            disabled={props.disabled || props.disabledReason !== undefined}
            aria-describedby={describedBy ?? props.describedBy}
            aria-label={props['aria-label']}
            onClick={props.onClick}
        >
            {props.children}
        </button>
    )
    return (
        <Show when={props.disabledReason} fallback={button()}>
            {(reason) => <Tooltip text={reason()}>{(id) => button(id)}</Tooltip>}
        </Show>
    )
}
