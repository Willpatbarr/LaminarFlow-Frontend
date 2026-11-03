import { createEffect, createSignal, Show } from 'solid-js'

import { Toast } from '@/components/ui/Toast'
import { sync } from '@/sync'

// "Made this an Aspect." as a toast, not a line above the title (LAM-216). Module
// level because the page that says it and the shell's toast area are in different
// parts of the tree. No timer, as with every toast here: it stays until dismissed.
const [shown, setShown] = createSignal(0)

/** Says that the document just became an Aspect. */
export function notifyMadeAspect() {
    setShown((n) => n + 1)
}

/** For tests, and for sign-out. */
export function clearMadeAspect() {
    setShown(0)
}

export function MadeAspectToast() {
    createEffect(
        () => sync.active,
        (active) => {
            if (!active) clearMadeAspect()
        },
    )
    return (
        <Show when={shown() > 0}>
            <Toast hue="green" mark="check" title="Made this an Aspect." onDismiss={clearMadeAspect} />
        </Show>
    )
}
