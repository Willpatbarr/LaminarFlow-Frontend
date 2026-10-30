import { createUniqueId, For, Show } from 'solid-js'

import { Icon, type IconName } from './icons/Icon'
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
    /** Keeps the label for screen readers but not the screen. */
    hideLabel?: boolean
    value: string
    options: SelectOption[]
    onChange: (value: string) => void
    disabled?: boolean
    /** A decorative coolicon at the start of the field (the team picker's group). */
    icon?: IconName
    ref?: (el: HTMLSelectElement) => void
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
            <label class={`input__label t-body${props.hideLabel ? ' visually-hidden' : ''}`} for={id}>
                {props.label}
            </label>
            <div class="select">
            <select
                id={id}
                ref={props.ref}
                class={`input__control select__control${props.icon ? ' input__control--icon' : ''}`}
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
            <Show when={props.icon}>
                {(icon) => <Icon name={icon()} size={16} class="input__icon" />}
            </Show>
            </div>
            <Show when={props.error}>
                <span id={errorId} class="input__error t-meta">
                    {props.error}
                </span>
            </Show>
        </div>
    )
}
