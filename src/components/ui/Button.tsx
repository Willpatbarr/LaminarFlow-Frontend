import type { JSX } from '@solidjs/web'

import './Button.css'

// Domain-agnostic by construction: no ticket, document, or aspect appears in
// these props. That is the test for whether a component belongs in this folder.
type ButtonProps = {
    children: JSX.Element
    onClick?: () => void
    /** `submit` makes the button the form's default action. */
    type?: 'button' | 'submit'
    disabled?: boolean
}

// There is deliberately no `variant` prop. The vault leaves the variant count
// open (Button variants, status: open), and the only screens built so far -
// Login and Sign Up - use the primary skin and nothing else. Adding a variant
// later is a new optional prop, not a breaking change.
//
// Props are read as `props.x`, never destructured: destructuring takes a
// one-time snapshot and silently drops reactivity.
export function Button(props: ButtonProps) {
    return (
        <button
            type={props.type ?? 'button'}
            class="button"
            disabled={props.disabled}
            onClick={props.onClick}
        >
            {props.children}
        </button>
    )
}
