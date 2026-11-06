import { For, Show } from 'solid-js'

import type { AspectField } from '../api'
import { summaryLines } from '../fields'

import './AspectSummary.css'

type AspectSummaryProps = {
    /** The type's fields, in order (orderedFields). */
    fields: AspectField[]
    /** The document's stored body: field id -> markdown. */
    body: Record<string, string | undefined>
}

// Every field of an aspect and what it holds, at a glance, above the editors.
// Each line of a value is its own line in the cell. It shows what is saved, so
// a value catches up a moment after typing stops.
export function AspectSummary(props: AspectSummaryProps) {
    return (
        <Show when={props.fields.length > 0}>
            <table class="aspect-summary">
                <caption class="visually-hidden">Fields at a glance</caption>
                <thead>
                    <tr>
                        <th scope="col" class="t-overline">Field</th>
                        <th scope="col" class="t-overline">Entry</th>
                    </tr>
                </thead>
                <tbody>
                    <For each={props.fields} keyed={(field) => field.id}>
                        {(field) => {
                            const lines = () => summaryLines(props.body[field().id] ?? '')
                            return (
                                <tr>
                                    <th scope="row" class="aspect-summary__label t-body">{field().label}</th>
                                    <td class="aspect-summary__value t-body">
                                        <Show when={lines().length > 0} fallback={<span class="aspect-summary__empty">—</span>}>
                                            <For each={lines()}>{(line) => <span class="aspect-summary__line">{line}</span>}</For>
                                        </Show>
                                    </td>
                                </tr>
                            )
                        }}
                    </For>
                </tbody>
            </table>
        </Show>
    )
}
