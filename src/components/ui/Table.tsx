import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'

import './Table.css'

type TableProps = {
    /** One per column, in order. An empty string leaves that header blank. */
    columns: string[]
    /** CSS `grid-template-columns`, shared by the header and every row. */
    template: string
    /** What to say when there are no rows. Omit to render nothing extra. */
    empty?: string
    /** `TableRow`s. */
    children: JSX.Element
}

// From the "Table Row" specimen: a raised card, a 28px overline header, rows at
// --row-h. The row height is a token because the whole list layout is built on
// it - a row that grows with its content makes a long list unscannable.
//
// It is a list of links, not a <table>: every row here is one destination, and
// a screen reader gets more from "list, 3 items, link …" than from a grid whose
// cells it has to walk. The header is decoration for the sighted, so it is
// hidden from the accessibility tree and each cell names itself instead.
export function Table(props: TableProps) {
    return (
        <div class="table" style={{ '--table-columns': props.template }}>
            <div class="table__header" aria-hidden="true">
                <For each={props.columns}>
                    {(column) => <span class="t-overline">{column}</span>}
                </For>
            </div>
            <ul class="table__rows">{props.children}</ul>
            <Show when={props.empty}>
                <p class="table__empty t-meta">{props.empty}</p>
            </Show>
        </div>
    )
}

type TableRowProps = {
    /** Where the row goes when activated. */
    href: string
    /** One element per column. */
    children: JSX.Element
}

// Hover is the 2.8% wash and deliberately does not touch the border - a border
// that changes on hover makes the row look like it moved.
export function TableRow(props: TableRowProps) {
    return (
        <li class="table__item">
            <a class="table__row row" href={props.href}>
                {props.children}
            </a>
        </li>
    )
}
