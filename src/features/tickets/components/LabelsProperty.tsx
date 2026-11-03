import { createMemo, createSignal, For, Show } from 'solid-js'

import { Icon } from '@/components/ui/icons/Icon'
import { Popover } from '@/components/ui/Popover'
import { createLabel, labelsForProject } from '@/sync'

import { nameCount, overMessage } from '../limits'
import { COLOURS, hueFor } from '../statusLook'
import { labelNamed } from './LabelEditor'
import { LabelChips } from './LabelChips'
import './PropertyPicker.css'

/*
┌─ tickets ───────────────────────────────────────
│  LabelsProperty: the ticket's labels as chips, and a "+" that opens a
│  search-or-create list (LAM-211)
├─ out ───────────────────────────────────────────
│      LabelsProperty   <LabelsProperty projectId ids onToggle … />
*/
// There is no permanent create form and no second list of checkboxes: the chips
// are the labels the ticket has; the "+" opens one list of the team's labels
// (ticked when applied; a press toggles and the list stays open) with a search
// box. Typing a name nobody has offers "Create “name”" with the colour to give
// it; Enter picks the exact match if there is one, else creates.

type LabelsPropertyProps = {
    projectId: string
    teamId: string
    /** The ticket's label ids, as they should be shown. */
    ids: string[]
    disabled?: boolean
    error?: string
    /** Apply (on) or remove (off) one label. */
    onToggle: (labelId: string, on: boolean) => void
}

export function LabelsProperty(props: LabelsPropertyProps) {
    return (
        <div class="prop-row prop-row--labels">
            <span class="prop__name t-meta">Labels</span>
            <div class="prop-labels">
                <LabelChips ids={props.ids} />
                <Popover
                    label="Add or remove labels"
                    presentation="auto"
                    align="start"
                    trigger={(trigger) => (
                        <button
                            type="button"
                            class="prop prop--add"
                            disabled={props.disabled}
                            aria-label="Add label"
                            data-empty={props.ids.length === 0 ? 'true' : undefined}
                            {...trigger}
                        >
                            <Icon name="plus" size={16} />
                            <span class="prop__add-text t-body">Label</span>
                        </button>
                    )}
                >
                    <LabelList {...props} />
                </Popover>
            </div>
            <Show when={props.error}>
                <span class="input__error t-meta">{props.error}</span>
            </Show>
        </div>
    )
}

function LabelList(props: LabelsPropertyProps) {
    const [query, setQuery] = createSignal('')
    const [colour, setColour] = createSignal<string>(COLOURS[3].value)
    let list: HTMLDivElement | undefined
    let search: HTMLInputElement | undefined

    const known = () => labelsForProject(props.projectId)
    const rows = createMemo(() => {
        const wanted = query().trim().toLocaleLowerCase()
        return wanted === '' ? known() : known().filter((label) => label.name.toLocaleLowerCase().includes(wanted))
    })
    const exact = () => (query().trim() ? labelNamed(props.teamId, query()) : undefined)
    const tooLong = () => overMessage('Name', nameCount(query()))
    const canCreate = () => props.teamId !== '' && query().trim() !== '' && !exact()

    async function create() {
        if (!canCreate() || tooLong()) return
        const name = query().trim()
        setQuery('')
        const label = await createLabel({ team_id: props.teamId, name, color: colour() })
        if (!props.ids.includes(label.id)) props.onToggle(label.id, true)
    }

    function enter() {
        const match = exact()
        if (match) {
            setQuery('')
            props.onToggle(match.id, !props.ids.includes(match.id))
        } else void create()
    }

    const items = () => [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    function move(from: number, by: number) {
        const next = from + by
        if (next < 0) search?.focus()
        else items()[Math.min(next, items().length - 1)]?.focus()
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
                aria-label="Search or create a label"
                placeholder="Search or create a label…"
                autocomplete="off"
                aria-invalid={tooLong() ? 'true' : undefined}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        items()[0]?.focus()
                    } else if (event.key === 'Enter') {
                        event.preventDefault()
                        if (query().trim()) enter()
                    }
                }}
            />
            <Show when={tooLong()}>
                <p class="input__error t-meta">{tooLong()}</p>
            </Show>
            <div
                ref={(el) => {
                    list = el
                }}
                class="picker__list"
                role="listbox"
                aria-multiselectable="true"
                aria-label="Labels"
            >
                <For each={rows()} keyed={(label) => label.id}>
                    {(label, index) => (
                        <button
                            type="button"
                            role="option"
                            class="picker__option t-body"
                            aria-selected={props.ids.includes(label().id) ? 'true' : 'false'}
                            onClick={() => props.onToggle(label().id, !props.ids.includes(label().id))}
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
                            <span class="picker__dot" aria-hidden="true" style={{ background: `var(--${hueFor(label().color)})` }} />
                            <span class="picker__label">{label().name}</span>
                            <Show when={props.ids.includes(label().id)}>
                                <Icon name="check" size={16} />
                            </Show>
                        </button>
                    )}
                </For>
                <Show when={rows().length === 0 && !canCreate()}>
                    <p class="picker__empty t-meta">{known().length === 0 ? 'This team has no labels yet. Type a name to make one.' : 'No matches'}</p>
                </Show>
            </div>
            <Show when={canCreate()}>
                <div class="picker__new">
                    <div class="picker__swatches" role="radiogroup" aria-label="Label colour">
                        <For each={COLOURS}>
                            {(option) => (
                                <button
                                    type="button"
                                    role="radio"
                                    class="picker__swatch"
                                    aria-checked={colour() === option.value ? 'true' : 'false'}
                                    aria-label={option.label}
                                    style={{ background: `var(--${option.value})` }}
                                    onClick={() => setColour(option.value)}
                                />
                            )}
                        </For>
                    </div>
                    <button type="button" class="picker__create t-body" disabled={tooLong() !== undefined} onClick={() => void create()}>
                        <Icon name="plus" size={16} />
                        Create “{query().trim()}”
                    </button>
                </div>
            </Show>
        </div>
    )
}

