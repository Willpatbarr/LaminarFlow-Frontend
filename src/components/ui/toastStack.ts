import { createEffect, createSignal } from 'solid-js'

/** How many toasts show in full. Older ones fold into a "+N more" control. */
export const MAX_VISIBLE_TOASTS = 2

// Every mounted Toast, oldest first. Module level because the toasts are
// mounted by different features and share one corner of the screen.
const [stack, setStack] = createSignal<number[]>([], { ownedWrite: true })
const [expanded, setExpanded] = createSignal(false, { ownedWrite: true })
let nextId = 0

/** For Toast: joins the stack while mounted. `collapsed()` is true when this
 *  toast is one of the older ones folded away. Nothing is dropped: the toast
 *  stays mounted, and "+N more" brings it back. */
export function joinToastStack() {
    const id = nextId++
    createEffect(
        () => undefined,
        () => {
            setStack((s) => [...s, id])
            return () => {
                setStack((s) => s.filter((x) => x !== id))
                if (stack().length <= MAX_VISIBLE_TOASTS) setExpanded(false)
            }
        },
    )
    return () => !expanded() && stack().indexOf(id) >= 0 && stack().indexOf(id) < stack().length - MAX_VISIBLE_TOASTS
}

/** How many toasts are folded away right now. */
export const hiddenToastCount = () => (expanded() ? 0 : Math.max(0, stack().length - MAX_VISIBLE_TOASTS))
/** Whether the full stack is open (and can be folded again). */
export const toastsExpanded = () => expanded() && stack().length > MAX_VISIBLE_TOASTS
export const expandToasts = () => setExpanded(true)
export const collapseToasts = () => setExpanded(false)

/** For tests. */
export function resetToastStack() {
    setStack([])
    setExpanded(false)
}
