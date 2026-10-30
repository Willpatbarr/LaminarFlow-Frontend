import { createEffect, createSignal, Show } from 'solid-js'

import { Toast } from '@/components/ui/Toast'
import { sync } from '@/sync'

// "Review requested." as a toast, not a line in the page: a line above the
// document pushed everything below it down (LAM-150). Module-level because
// the dialog that asks is on a page, and the toast floats over whichever
// one is showing. No timer, as with every toast here: it stays until dismissed
// or replaced.
const [shown, setShown] = createSignal(0)

/** Says that a review was asked for. Asking again shows it again. */
export function notifyReviewRequested() {
    setShown((n) => n + 1)
}

/** For tests, and for sign-out. */
export function clearReviewRequested() {
    setShown(0)
}

export function ReviewRequestedToast() {
    createEffect(
        () => sync.active,
        (active) => {
            if (!active) clearReviewRequested()
        },
    )
    return (
        <Show when={shown() > 0}>
            <Toast hue="green" mark="✓" title="Review requested." onDismiss={clearReviewRequested} />
        </Show>
    )
}
