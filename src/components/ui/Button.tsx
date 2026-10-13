import type { JSX } from '@solidjs/web'

// Domain-agnostic by construction: no ticket, document, or aspect appears in
// these props. That is the test for whether a component belongs in this folder.
type ButtonProps = {
    children: JSX.Element
    onClick?: () => void
}

// Props are read as `props.x`, never destructured: destructuring takes a
// one-time snapshot and silently drops reactivity.
export function Button(props: ButtonProps) {
    return (
        <button type="button" class="button" onClick={props.onClick}>
            {props.children}
        </button>
    )
}
