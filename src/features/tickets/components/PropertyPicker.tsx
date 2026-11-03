import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'

import { Icon } from '@/components/ui/icons/Icon'
import { Popover } from '@/components/ui/Popover'

import './PropertyPicker.css'

/*
┌─ tickets ───────────────────────────────────────
│  PropertyPicker: one property of the ticket page (Status, Assignee, Epic …) as
│  a button that opens a searchable list (LAM-211)
├─ out ───────────────────────────────────────────
│      PropertyPicker   <PropertyPicker label="Status" value={…} options={…} onChange={…} />
│      PropertyHandle   what `register` hands back, to open the list from a shortcut
├─ example ───────────────────────────────────────
│      the right-hand panel on a desktop; a row of chips on a phone
*/
// The button shows the property's name and its value. Pressing it opens a
// Popover (`presentation="auto"`: a popover on a desktop, a bottom sheet on a
// phone) with a search box, the options, and, for epics, sprints and
// milestones, "Create new…" at the foot. Choosing an option saves it at once
// and closes the list; the button's accessible name is "Status: In Progress".

export type PickerOption = { value: string; label: string }

export type PropertyHandle = {
    /** Opens the list. Focus lands in its search box. */
    open: () => void
}

type PropertyPickerProps = {
    /** The property's name: "Status". */
    label: string
    /** The chosen option's value; '' is "none". */
    value: string
    /** What '' is called: "No status", "Unassigned", "None". */
    noneLabel: string
    /** Everything that can be chosen, not including "none". */
    options: PickerOption[]
    onChange: (value: string) => void
    disabled?: boolean
    /** Marks the button invalid and renders the message under it. */
    error?: string
    /** "Create new epic…": offered at the foot of the list. */
    create?: { label: string; onCreate: () => void }
    /** Receives a handle to open the list from outside (the `S` shortcut). */
    register?: (handle: PropertyHandle) => void
}

export function PropertyPicker(props: PropertyPickerProps) {
    const [open, setOpen] = createSignal(false)
    const errorId = createUniqueId()
    const shown = () =>
        props.value === '' ? props.noneLabel : (props.options.find((option) => option.value === props.value)?.label ?? props.noneLabel)
    props.register?.({ open: () => setOpen(true) })

    return (
        <div class="prop-row">
            <Popover
                label={`Set ${props.label.toLowerCase()}`}
                presentation="auto"
                align="start"
                open={open()}
                onOpenChange={setOpen}
                trigger={(trigger) => (
                    <button
                        type="button"
                        class="prop"
                        data-empty={props.value === '' ? 'true' : undefined}
                        disabled={props.disabled}
                        aria-label={`${props.label}: ${shown()}`}
                        aria-invalid={props.error ? 'true' : undefined}
                        aria-describedby={props.error ? errorId : undefined}
                        {...trigger}
                    >
                        <span class="prop__name t-meta">{props.label}</span>
                        <span class="prop__value t-body">{shown()}</span>
                    </button>
                )}
            >
                {(close) => (
                    <PickerList
                        label={props.label}
                        value={props.value}
                        noneLabel={props.noneLabel}
                        options={props.options}
                        create={props.create}
                        onPick={(value) => {
                            props.onChange(value)
                            close()
                        }}
                    />
                )}
            </Popover>
            <Show when={props.error}>
                <span id={errorId} class="input__error t-meta">{props.error}</span>
            </Show>
        </div>
    )
}

type PickerListProps = {
    label: string
    value: string
    noneLabel: string
    options: PickerOption[]
    create?: { label: string; onCreate: () => void }
    onPick: (value: string) => void
}

function PickerList(props: PickerListProps) {
    const [query, setQuery] = createSignal('')
    let list: HTMLDivElement | undefined
    let search: HTMLInputElement | undefined

    const rows = createMemo<PickerOption[]>(() => {
        const wanted = query().trim().toLocaleLowerCase()
        const all = [{ value: '', label: props.noneLabel }, ...props.options]
        return wanted === '' ? all : all.filter((option) => option.label.toLocaleLowerCase().includes(wanted))
    })

    const items = () => [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]

    function move(from: number, by: number) {
        const all = items()
        const next = from + by
        if (next < 0) search?.focus()
        else all[Math.min(next, all.length - 1)]?.focus()
    }

    return (
        <div class="picker">
            <input
                ref={(el) => {
                    search = el
                }}
                class="picker__search t-body"
                type="text"
                role="searchbox"
                aria-label={`Search ${props.label.toLowerCase()}`}
                placeholder="Search…"
                autocomplete="off"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        items()[0]?.focus()
                    } else if (event.key === 'Enter') {
                        // Not a form submit: choose the first match.
                        event.preventDefault()
                        const first = rows()[0]
                        if (first) props.onPick(first.value)
                    }
                }}
            />
            <div
                ref={(el) => {
                    list = el
                }}
                class="picker__list"
                role="listbox"
                aria-label={props.label}
            >
                <For each={rows()} keyed={(option) => option.value}>
                    {(option, index) => (
                        <button
                            type="button"
                            role="option"
                            class="picker__option t-body"
                            aria-selected={option().value === props.value ? 'true' : 'false'}
                            onClick={() => props.onPick(option().value)}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault()
                                    move(index(), 1)
                                } else if (event.key === 'ArrowUp') {
                                    event.preventDefault()
                                    move(index(), -1)
                                }
                            }}
                        >
                            <span class="picker__label">{option().label}</span>
                            <Show when={option().value === props.value}>
                                <Icon name="check" size={16} />
                            </Show>
                        </button>
                    )}
                </For>
                <Show when={rows().length === 0}>
                    <p class="picker__empty t-meta">No matches</p>
                </Show>
            </div>
            <Show when={props.create}>
                {(create) => (
                    <button type="button" class="picker__create t-body" data-popover-close onClick={() => create().onCreate()}>
                        <Icon name="plus" size={16} />
                        {create().label}
                    </button>
                )}
            </Show>
        </div>
    )
}
