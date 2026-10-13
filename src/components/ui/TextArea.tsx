import { createUniqueId } from 'solid-js'

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
}

export function TextArea(props: TextAreaProps) {
    const id = createUniqueId()
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
                onInput={(event) => props.onInput(event.currentTarget.value)}
                onBlur={() => props.onBlur?.()}
            />
        </div>
    )
}
