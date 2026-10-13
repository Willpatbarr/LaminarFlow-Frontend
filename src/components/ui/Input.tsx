import { createUniqueId, Show } from 'solid-js'

import './Input.css'

// Controlled: the caller owns the value. `onInput` hands back the string, not
// the event, because every caller wants the string.
type InputProps = {
    /** Always visible. A placeholder is a hint, not a name. */
    label: string
    value: string
    onInput: (value: string) => void
    /** Focus left the control. For a field that saves when you leave it. */
    onBlur?: () => void
    type?: 'text' | 'email' | 'password'
    name?: string
    autocomplete?: 'email' | 'current-password' | 'new-password' | 'given-name' | 'family-name'
    placeholder?: string
    required?: boolean
    disabled?: boolean
    /** Shows the value and lets it be selected and read out, but not changed. */
    readOnly?: boolean
    /** Marks the control invalid and renders the message under it. */
    error?: string
    /** Receives the <input>, so a form can move focus to the first invalid one. */
    ref?: (el: HTMLInputElement) => void
}

export function Input(props: InputProps) {
    // The id ties label and message to the control. It is created once in the
    // component body, which is the one place Solid allows it.
    const id = createUniqueId()
    const errorId = `${id}-error`

    return (
        <div class="input">
            <label class="input__label t-body" for={id}>
                {props.label}
            </label>
            <input
                id={id}
                ref={props.ref}
                class="input__control"
                type={props.type ?? 'text'}
                name={props.name}
                autocomplete={props.autocomplete}
                placeholder={props.placeholder}
                required={props.required}
                disabled={props.disabled}
                readonly={props.readOnly}
                value={props.value}
                aria-invalid={props.error ? 'true' : undefined}
                aria-describedby={props.error ? errorId : undefined}
                onInput={(event) => props.onInput(event.currentTarget.value)}
                onBlur={() => props.onBlur?.()}
            />
            <Show when={props.error}>
                <span id={errorId} class="input__error t-meta">
                    {props.error}
                </span>
            </Show>
        </div>
    )
}
