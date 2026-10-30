import './ProgressBar.css'

/** A done-of-total bar: a real `role="progressbar"` (a `<progress>` element
 *  cannot be styled the same in every browser), 6 px tall, filled with the accent.
 *  The "n of m done" words are the caller's, beside it; `valuetext` repeats them
 *  for screen readers. */
export function ProgressBar(props: { done: number; total: number; label: string; valueText?: string }) {
    const max = () => Math.max(props.total, 1)
    const share = () => Math.min(100, Math.max(0, (props.done / max()) * 100))
    return (
        <div
            class="progress-bar"
            role="progressbar"
            aria-label={props.label}
            aria-valuemin={0}
            aria-valuemax={max()}
            aria-valuenow={props.done}
            aria-valuetext={props.valueText ?? `${props.done} of ${props.total} done`}
        >
            <div class="progress-bar__fill" style={{ width: `${share()}%` }} />
        </div>
    )
}
