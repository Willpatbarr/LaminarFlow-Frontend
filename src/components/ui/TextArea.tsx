import { createUniqueId } from 'solid-js'

import { FieldFoot } from './CharacterCount'
import { describedBy, isOver, type Count } from './count'
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
    /** Shows the value and lets it be selected and read out, but not changed. */
    readOnly?: boolean
    /** Marks the control invalid and renders the message under it. */
    error?: string
    /** A limit on the text, counted by the caller. Nothing is cut off: the
     *  count shows within a tenth of the limit, and over it the control is
     *  marked invalid (say why with `error`). */
    count?: Count
}

export function TextArea(props: TextAreaProps) {
    const id = createUniqueId()
    const errorId = `${id}-error`
    const countId = `${id}-count`
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
                readonly={props.readOnly}
                value={props.value}
                aria-invalid={props.error || isOver(props.count) ? 'true' : undefined}
                aria-describedby={describedBy(props, errorId, countId)}
                onInput={(event) => props.onInput(event.currentTarget.value)}
                onBlur={() => props.onBlur?.()}
            />
            <FieldFoot errorId={errorId} countId={countId} error={props.error} count={props.count} />
        </div>
    )
}
