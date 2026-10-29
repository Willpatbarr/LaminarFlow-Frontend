import { createUniqueId } from 'solid-js'

import { FieldFoot } from './CharacterCount'
import { describedBy, isOver, type Count } from './count'
import './Input.css'

// Controlled: the caller owns the value. `onInput` hands back the string, not
// the event, because every caller wants the string.
type InputProps = {
    /** Always visible. A placeholder is a hint, not a name. */
    label: string
    /** Keeps the label for screen readers but not the screen: for a field in a
     *  row of a list, where the column header already names it. */
    hideLabel?: boolean
    value: string
    onInput: (value: string) => void
    /** Focus left the control. For a field that saves when you leave it. */
    onBlur?: () => void
    /** The browser's `change`: for a date, the moment a date is picked. */
    onChange?: () => void
    type?: 'text' | 'email' | 'password' | 'date'
    name?: string
    autocomplete?: 'email' | 'current-password' | 'new-password' | 'given-name' | 'family-name'
    placeholder?: string
    required?: boolean
    disabled?: boolean
    /** Shows the value and lets it be selected and read out, but not changed. */
    readOnly?: boolean
    /** Marks the control invalid and renders the message under it. */
    error?: string
    /** A limit on the text, counted by the caller. Nothing is cut off: the
     *  count shows within a tenth of the limit, and over it the control is
     *  marked invalid (say why with `error`). */
    count?: Count
    /** Receives the <input>, so a form can move focus to the first invalid one. */
    ref?: (el: HTMLInputElement) => void
}

export function Input(props: InputProps) {
    // The id ties label and message to the control. It is created once in the
    // component body, which is the one place Solid allows it.
    const id = createUniqueId()
    const errorId = `${id}-error`
    const countId = `${id}-count`

    return (
        <div class="input">
            <label class={`input__label t-body${props.hideLabel ? ' visually-hidden' : ''}`} for={id}>
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
                aria-invalid={props.error || isOver(props.count) ? 'true' : undefined}
                aria-describedby={describedBy(props, errorId, countId)}
                onInput={(event) => props.onInput(event.currentTarget.value)}
                onBlur={() => props.onBlur?.()}
                onChange={() => props.onChange?.()}
            />
            <FieldFoot errorId={errorId} countId={countId} error={props.error} count={props.count} />
        </div>
    )
}
