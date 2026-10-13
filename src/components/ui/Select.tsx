import { createUniqueId, For, Show } from 'solid-js'

import './Input.css'
import './Select.css'

export type SelectOption = {
    value: string
    label: string
}

// Controlled, like Input: the caller owns the value and gets the new one back
// as a string.
type SelectProps = {
    label: string
    value: string
    options: SelectOption[]
    onChange: (value: string) => void
    disabled?: boolean
    /** Marks the control invalid and renders the message under it. */
    error?: string
}

// A native <select> in the Input's box, from the "Input, Select, Checkbox"
// specimen: a select is a field, not a button, and the caret is the only thing
// marking it. Native on purpose - the keyboard, the screen reader and the
// phone's picker all already work.
export function Select(props: SelectProps) {
    const id = createUniqueId()
    const errorId = `${id}-error`
    return (
        <div class="input">
            <label class="input__label t-body" for={id}>
                {props.label}
            </label>
            <select
                id={id}
                class="input__control select__control"
                disabled={props.disabled}
                aria-invalid={props.error ? 'true' : undefined}
                aria-describedby={props.error ? errorId : undefined}
                onChange={(event) => props.onChange(event.currentTarget.value)}
            >
                <For each={props.options}>
                    {(option) => (
                        <option value={option.value} selected={option.value === props.value}>
                            {option.label}
                        </option>
                    )}
                </For>
            </select>
            <Show when={props.error}>
                <span id={errorId} class="input__error t-meta">
                    {props.error}
                </span>
            </Show>
        </div>
    )
}
