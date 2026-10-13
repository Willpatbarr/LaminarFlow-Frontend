import { createSignal, createUniqueId, For, Show } from 'solid-js'

import './PendingIndicator.css'

export type PendingItem = {
    id: string
    /** Where the row goes. Absent for something with no page to go to. */
    href?: string
    label: string
    /** Why it is here, in a few words. */
    detail: string
    /** A quick resolution, for a row with no page - "Discard". */
    action?: { label: string; onClick: () => void }
}

type PendingIndicatorProps = {
    /** The summary, as the button reads it: "3 changes waiting". */
    label: string
    /** `attention` draws the dot solid; `waiting` leaves it a ring, which is
     *  how the row markers draw "just not there yet" too. */
    tone: 'waiting' | 'attention'
    items: PendingItem[]
}

// What is not on the server yet, as one line in the rail's foot that opens to
// the list behind it. Domain-agnostic: it is handed words and links.
//
// A disclosure, not a menu or a dialog: a button that shows and hides a list
// in place, with `aria-expanded`. Nothing traps focus or moves it, so the rest
// of the rail stays usable with the list open; Escape closes it and puts focus
// back on the button, and choosing a link closes it so the next page is not
// covered by the last one's list.
export function PendingIndicator(props: PendingIndicatorProps) {
    const panelId = createUniqueId()
    const [open, setOpen] = createSignal(false)
    let button: HTMLButtonElement | undefined

    return (
        <div
            class="pending"
            data-tone={props.tone}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && open()) {
                    event.stopPropagation()
                    setOpen(false)
                    button?.focus()
                }
            }}
        >
            <button
                ref={(el) => {
                    button = el
                }}
                type="button"
                class="pending__button t-body"
                aria-expanded={open() ? 'true' : 'false'}
                aria-controls={panelId}
                onClick={() => setOpen(!open())}
            >
                <span class="pending__dot" aria-hidden="true" />
                <span class="pending__label">{props.label}</span>
            </button>
            <Show when={open()}>
                <ul id={panelId} class="pending__list" aria-label="Changes not synced yet">
                    <For each={props.items}>
                        {(item) => (
                            <li class="pending__item">
                                <Show
                                    when={item.href}
                                    fallback={<span class="pending__name t-cell">{item.label}</span>}
                                >
                                    {(href) => (
                                        <a
                                            class="pending__name t-cell"
                                            href={href()}
                                            onClick={() => setOpen(false)}
                                        >
                                            {item.label}
                                        </a>
                                    )}
                                </Show>
                                <span class="pending__detail t-meta">{item.detail}</span>
                                <Show when={item.action}>
                                    {(action) => (
                                        <button
                                            type="button"
                                            class="pending__action t-meta"
                                            onClick={() => action().onClick()}
                                        >
                                            {action().label}
                                        </button>
                                    )}
                                </Show>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
        </div>
    )
}
