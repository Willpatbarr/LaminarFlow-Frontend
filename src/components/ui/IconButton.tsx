import type { JSX } from '@solidjs/web'

import { Tooltip } from './Tooltip'

import './IconButton.css'

type IconButtonProps = {
    /** The accessible name. Icons name nothing, so this is required. */
    label: string
    /** The tooltip: what it does, with its shortcut when it has one. Defaults to the label. */
    tooltip?: string
    /** The 16px icon, an <svg aria-hidden>. */
    children: JSX.Element
    onClick?: () => void
    disabled?: boolean
    /** Disables the button and says why in the tooltip. */
    disabledReason?: string
}

// A compact square button for a row's own actions. Quiet until its row is
// hovered or holds focus (the colour change is in the stylesheet that places
// it); never hidden, and always a real button in the tab order. The tooltip is
// always in the DOM, so a touch screen and a screen reader get the same words.
export function IconButton(props: IconButtonProps) {
    return (
        <Tooltip placement="above" text={props.disabledReason ?? props.tooltip ?? props.label}>
            {(describedBy) => (
                <button
                    type="button"
                    class="icon-button"
                    aria-label={props.label}
                    aria-describedby={describedBy}
                    disabled={props.disabled || props.disabledReason !== undefined}
                    onClick={props.onClick}
                >
                    {props.children}
                </button>
            )}
        </Tooltip>
    )
}
