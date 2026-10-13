import { createUniqueId, Show } from 'solid-js'

import './Input.css'

// The Input's multi-line sibling: same box, same label rule, same contract.
type TextAreaProps = {
    label: string
    value: string
    onInput: (value: string) => void
    /** Focus left the control. For a field that saves when you leave it. */
    onBlur?: () => void
    rows?: number
    placeholder?: string
    disabled?: boolean
    /** Marks the control invalid and renders the message under it. */
    error?: string
}

export function TextArea(props: TextAreaProps) {
    const id = createUniqueId()
    const errorId = `${id}-error`
    return (
        <div class="input">
            <label class="input__label t-body" for={id}>
                {props.label}
            </label>
            <textarea
                id={id}
                class="input__control input__control--multiline"
                rows={props.rows ?? 6}
                placeholder={props.placeholder}
                disabled={props.disabled}
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
