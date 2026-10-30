import { For } from 'solid-js'
import type { JSX } from '@solidjs/web'

import './Segmented.css'

export type SegmentedItem<T extends string> = { value: T; label: JSX.Element }

// One track, one selected segment, in two flavours that look the same:
//
//   <Segmented>     a choice that stays on the page (Light / Dark / System):
//                   a radio group, arrow keys move the choice.
//   <SegmentedNav>  a choice of page (List / Board): links, the current one
//                   marked `aria-current="page"`. Tab moves between the links.
//
// The track is --bg-base with a 1px border; the selected segment is --bg-overlay
// with --text-1, the others --text-2. Segments are 44px tall on touch (LAM-186).

export function Segmented<T extends string>(props: {
    label: string
    items: readonly SegmentedItem<T>[]
    value: T
    onChange: (value: T) => void
    class?: string
}) {
    return (
        <div class={`segmented ${props.class ?? ''}`} role="radiogroup" aria-label={props.label}>
            <For each={props.items}>
                {(item) => (
                    <button
                        type="button"
                        role="radio"
                        class="segmented__option t-meta"
                        aria-checked={props.value === item.value ? 'true' : 'false'}
                        tabindex={props.value === item.value ? 0 : -1}
                        onClick={() => props.onChange(item.value)}
                        onKeyDown={(event) => {
                            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
                            if (step === 0) return
                            event.preventDefault()
                            const at = props.items.findIndex((i) => i.value === item.value)
                            const to = props.items[(at + step + props.items.length) % props.items.length]
                            props.onChange(to.value)
                            const group = event.currentTarget.parentElement
                            queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
                        }}
                    >
                        {item.label}
                    </button>
                )}
            </For>
        </div>
    )
}

export function SegmentedNav<T extends string>(props: {
    label: string
    items: readonly (SegmentedItem<T> & { href: string })[]
    current: T
    class?: string
}) {
    return (
        <nav class={`segmented ${props.class ?? ''}`} aria-label={props.label}>
            <For each={props.items}>
                {(item) => (
                    <a
                        class="segmented__option t-meta"
                        href={item.href}
                        aria-current={props.current === item.value ? 'page' : undefined}
                    >
                        {item.label}
                    </a>
                )}
            </For>
        </nav>
    )
}
