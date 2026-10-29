import { createUniqueId } from 'solid-js'
import type { JSX } from '@solidjs/web'

import './Tooltip.css'

type TooltipProps = {
    /** What to say. The text is always in the DOM (hidden until hover or focus),
     *  so a screen reader gets it through `aria-describedby` and a test can
     *  find it. */
    text: string
    /** Receives the id of the tooltip, to hand to the wrapped control. */
    children: (describedBy: string) => JSX.Element
}

// Wraps a control that cannot explain itself, mainly a disabled button: a
// disabled <button> fires no hover events, so the hover target is this span.
export function Tooltip(props: TooltipProps) {
    const id = createUniqueId()
    return (
        <span class="tooltip">
            {props.children(id)}
            <span id={id} role="tooltip" class="tooltip__text t-meta">
                {props.text}
            </span>
        </span>
    )
}
