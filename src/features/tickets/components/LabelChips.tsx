import { createSignal, For, onSettled, Show } from 'solid-js'

import { sync, type Label } from '@/sync'

import { hueFor } from '../statusLook'
import { Tooltip } from '@/components/ui/Tooltip'
import { hiddenCount, observeFit } from './fitLabels'

/*
┌─ tickets ───────────────────────────────────────
│  LabelChips: the labels a ticket has, as small chips (LAM-104)
├─ out ───────────────────────────────────────────
│      LabelChip    <LabelChip label={…} />        - one chip
│      LabelChips   <LabelChips ids={ticket.label_ids} max={3} fit />
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
    /** On a table row: in the table's grid layout show as many chips as fit on
     *  one line and a "+N" chip, with the hidden names, for the rest (LAM-196).
     *  In the stacked layout this is `max` as above. */
    fit?: boolean
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
            <Show
                when={props.fit}
                fallback={
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
                }
            >
                <FittedLabelChips labels={labels()} max={props.max} />
            </Show>
        </Show>
    )
}

// The chips of a table row. Every chip is always in the DOM and laid out on one
// line; the line is as wide as the cell gives it and clips what does not fit.
// The chips that do not fit are `visibility: hidden` (so they are measured but
// not seen or read) and a "+N" chip, outside the clip so its tooltip can leave
// the cell, takes their place. The stylesheet turns all of this on only in the
// grid layout; stacked rows show `max` chips and the plain "+n" as before.
function FittedLabelChips(props: { labels: Label[]; max?: number }) {
    const [hidden, setHidden] = createSignal(0)
    let wrap!: HTMLSpanElement
    let list!: HTMLUListElement
    let sizer!: HTMLSpanElement

    // Reads only; the write is returned for the batch to run after every row has read.
    const measure = () => {
        const items = Array.from(list.children).filter(
            (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.fit !== undefined,
        )
        const ends = items.map((el) => el.offsetLeft + el.offsetWidth)
        const next = hiddenCount(ends, wrap.clientWidth, sizer.offsetWidth, 4)
        return () => setHidden(next)
    }
    onSettled(() => observeFit(wrap, list, measure))

    const total = () => props.labels.length
    const hiddenLabels = () => props.labels.slice(total() - Math.min(hidden(), total()))
    const names = () => hiddenLabels().map((label) => label.name).join(', ')
    const overMax = (index: number) => props.max !== undefined && index >= props.max
    return (
        <span class="label-fit" ref={wrap}>
            <span class="label-fit__clip">
                <ul class="label-chips" aria-label="Labels" ref={list}>
                    <For each={props.labels} keyed={(label) => label.id}>
                        {(label, index) => (
                            <li
                                data-fit=""
                                data-over-max={overMax(index()) ? '' : undefined}
                                data-fit-hidden={index() >= total() - hidden() ? '' : undefined}
                            >
                                <LabelChip label={label()} />
                            </li>
                        )}
                    </For>
                    <Show when={props.max !== undefined && total() > props.max}>
                        <li class="label-chips__more label-fit__plain t-meta">+{total() - (props.max ?? 0)}</li>
                    </Show>
                </ul>
            </span>
            {/* The widest "+N" this line can need, unseen, so the room it takes is known. */}
            <span class="chip label-fit__sizer" aria-hidden="true" ref={sizer}>
                +{total()}
            </span>
            <Show when={hidden() > 0}>
                <Tooltip placement="above" text={names()}>
                    {() => (
                        <span
                            class="chip label-fit__more"
                            role="img"
                            aria-label={`${hidden()} more ${hidden() === 1 ? 'label' : 'labels'}: ${names()}`}
                        >
                            +{hidden()}
                        </span>
                    )}
                </Tooltip>
            </Show>
        </span>
    )
}
