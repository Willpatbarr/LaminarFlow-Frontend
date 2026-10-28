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

type TableRowProps =
    | {
          /** Where the row goes when activated. */
          href: string
          loading?: false
          editing?: false
          /** Controls that belong to the row but cannot sit inside its link
           *  (a link may not contain buttons). Drawn over the row's end. */
          actions?: JSX.Element
          /** Something that belongs under the row, inside its item. */
          below?: JSX.Element
          /** One element per column. */
          children: JSX.Element
      }
    | {
          /** The row's placeholder: the same box, but nothing to activate. */
          loading: true
          editing?: false
          /** The placeholder cells, one per column. */
          children: JSX.Element
      }
    | {
          /** The row as a form: its cells are fields, and the row is no link. */
          editing: true
          loading?: false
          /** Enter in a field. */
          onSubmit: () => void
          /** Escape in a field. */
          onCancel: () => void
          below?: JSX.Element
          children: JSX.Element
      }

// Hover is the 2.8% wash and deliberately does not touch the border - a border
// that changes on hover makes the row look like it moved.
//
// `loading` swaps the link for a plain element wearing the same classes, so a
// placeholder row and a real one are the same height, the same grid and the
// same paddings by construction rather than by two stylesheets agreeing. The
// row is a link only when it has somewhere to go. What goes in the cells is the
// caller's: only it knows which column holds a title and which a badge.
const editingOf = (props: TableRowProps) => (props.editing === true ? props : undefined)

export function TableRow(props: TableRowProps) {
    return (
        <li class="table__item">
            <Show
                when={editingOf(props)}
                fallback={
                    <Show
                        when={props.loading}
                        fallback={
                            <>
                                <a
                                    class="table__row row"
                                    href={props.loading || props.editing ? undefined : props.href}
                                >
                                    {props.children}
                                </a>
                                <Show when={props.loading || props.editing ? undefined : props.actions}>
                                    {(actions) => <div class="table__actions">{actions()}</div>}
                                </Show>
                            </>
                        }
                    >
                        <div class="table__row row table__row--loading" aria-hidden="true">
                            {props.children}
                        </div>
                    </Show>
                }
            >
                {(editing) => (
                    <form
                        class="table__row row table__row--editing"
                        onSubmit={(event) => {
                            event.preventDefault()
                            editing().onSubmit()
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault()
                                event.stopPropagation()
                                editing().onCancel()
                            }
                        }}
                    >
                        {editing().children}
                    </form>
                )}
            </Show>
            <Show when={props.loading ? undefined : props.below}>
                {(below) => <div class="table__below">{below()}</div>}
            </Show>
        </li>
    )
}
