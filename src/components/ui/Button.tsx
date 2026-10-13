import type { JSX } from '@solidjs/web'

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
    /** Defaults to `primary`. */
    variant?: ButtonVariant
    /** `sm` is for a button sitting inside another surface (a toast). */
    size?: 'md' | 'sm'
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
    return (
        <button
            ref={props.ref}
            type={props.type ?? 'button'}
            class={`button button--${props.variant ?? 'primary'}${props.size === 'sm' ? ' button--sm' : ''}`}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            {props.children}
        </button>
    )
}
