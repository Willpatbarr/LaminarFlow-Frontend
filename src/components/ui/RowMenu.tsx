import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'

import { Icon } from './icons/Icon'
import { Popover } from './Popover'
import './RowMenu.css'

type RowMenuProps = {
    /** Names the trigger and the menu: "Actions for Backlog". */
    label: string
    /** `RowMenuItem`s (and `row-menu__head` captions). */
    children: JSX.Element
}

// The `⋯` menu a list row folds its actions into on a phone (LAM-188): one
// line per row, every action still one tap away. A menu in a Popover, which is
// a bottom sheet at phone width.
export function RowMenu(props: RowMenuProps) {
    return (
        <Popover
            label={props.label}
            role="menu"
            presentation="auto"
            trigger={(trigger) => (
                <button type="button" class="row-menu__trigger" aria-label={props.label} {...trigger}>
                    <Icon name="more" />
                </button>
            )}
        >
            <div class="row-menu">{props.children}</div>
        </Popover>
    )
}

type RowMenuItemProps = {
    children: JSX.Element
    onSelect: () => void
    /** Why it cannot be used now. The item stays, greyed, and says why. */
    disabledReason?: string
    destructive?: boolean
    /** For a choice among several (a colour): makes it a radio item. */
    checked?: boolean
    /** Accessible name when the visible words are not enough. */
    label?: string
}

export function RowMenuItem(props: RowMenuItemProps) {
    return (
        <button
            type="button"
            role={props.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={props.checked === undefined ? undefined : props.checked ? 'true' : 'false'}
            aria-disabled={props.disabledReason ? 'true' : undefined}
            aria-label={props.label}
            class="row-menu__item"
            data-destructive={props.destructive ? 'true' : undefined}
            onClick={() => !props.disabledReason && props.onSelect()}
        >
            {props.children}
            <Show when={props.disabledReason}>
                <span class="t-meta row-menu__reason">{props.disabledReason}</span>
            </Show>
        </button>
    )
}
