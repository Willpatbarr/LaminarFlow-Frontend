import { For, Show } from 'solid-js'

import { sync, type Label } from '@/sync'

import { hueFor } from '../statusLook'

/*
┌─ tickets ───────────────────────────────────────
│  LabelChips: the labels a ticket has, as small chips (LAM-104)
├─ out ───────────────────────────────────────────
│      LabelChip    <LabelChip label={…} />        - one chip
│      LabelChips   <LabelChips ids={ticket.label_ids} max={3} />
├─ example ───────────────────────────────────────
│      list rows, board cards and the ticket page all render <LabelChips/>
*/
// A label carries whatever colour its team picked; as for a status, that choice
// selects one of the sheet's hues and is never painted itself. The chip shows
// the name, so colour is never the only thing that says which label it is.
// An id the store does not know (a label deleted on another device, not yet
// heard of) draws nothing rather than a chip that says "Unknown".

export function LabelChip(props: { label: Label }) {
    const hue = () => hueFor(props.label.color)
    return (
        <span
            class="chip label-chip"
            data-label-chip={props.label.name}
            style={{
                background: `color-mix(in srgb, var(--${hue()}) var(--chip-alpha), transparent)`,
                color: `var(--${hue()}-fg)`,
            }}
        >
            {props.label.name}
        </span>
    )
}

type LabelChipsProps = {
    ids: string[]
    /** Show this many and "+n" for the rest. Omit to show all. */
    max?: number
}

export function LabelChips(props: LabelChipsProps) {
    const labels = () =>
        props.ids
            .map((id) => sync.labels.find((label) => label.id === id))
            .filter((label): label is Label => label !== undefined)
            .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    const shown = () => (props.max === undefined ? labels() : labels().slice(0, props.max))
    const more = () => labels().length - shown().length
    return (
        <Show when={labels().length > 0}>
            <ul class="label-chips" aria-label="Labels">
                <For each={shown()} keyed={(label) => label.id}>
                    {(label) => (
                        <li>
                            <LabelChip label={label()} />
                        </li>
                    )}
                </For>
                <Show when={more() > 0}>
                    <li class="label-chips__more t-meta">+{more()}</li>
                </Show>
            </ul>
        </Show>
    )
}
