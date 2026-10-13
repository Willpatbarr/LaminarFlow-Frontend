import { Show } from 'solid-js'

import { isOver, showsCount, type Count } from './count'
import './Input.css'

type CharacterCountProps = {
    id: string
    count: Count
}

// "212 / 200", in the field's description so a screen reader hears it with the
// field. Not a live region: it changes with every key, and the error beside
// it is what says the field is wrong.
export function CharacterCount(props: CharacterCountProps) {
    return (
        <span
            id={props.id}
            class={`input__count t-meta${isOver(props.count) ? ' input__count--over' : ''}`}
        >
            {props.count.used.toLocaleString('en-US')} / {props.count.max.toLocaleString('en-US')}
        </span>
    )
}

type FieldFootProps = {
    errorId: string
    countId: string
    error?: string
    count?: Count
}

// What goes under a field: its error on the left, its count on the right. Not
// rendered at all when there is neither, so the field keeps its usual size.
export function FieldFoot(props: FieldFootProps) {
    return (
        <Show when={props.error || showsCount(props.count)}>
            <div class="input__foot">
                <Show when={props.error}>
                    <span id={props.errorId} class="input__error t-meta">
                        {props.error}
                    </span>
                </Show>
                <Show when={showsCount(props.count) ? props.count : undefined}>
                    {(count) => <CharacterCount id={props.countId} count={count()} />}
                </Show>
            </div>
        </Show>
    )
}
