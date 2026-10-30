import { createSignal, untrack } from 'solid-js'

type Begin = () => string

// Which field a page-level "Request review" acts on (LAM-150): the field text
// is selected in. A field says so with `selectionIn(key)(begin)` and says it has
// no selection with `(null)`. A field letting go never clears another field's
// claim, so the button can only ever act on text that is selected right now.
export function createReviewTarget() {
    const [target, setTarget] = createSignal<{ key: string; begin: Begin } | null>(null)
    const selectionIn = (key: string) => (begin: Begin | null) => {
        if (begin) setTarget({ key, begin })
        else if (untrack(target)?.key === key) setTarget(null)
    }
    return { target, selectionIn }
}
