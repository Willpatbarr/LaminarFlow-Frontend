import { Show } from 'solid-js'

import { Button } from './Button'
import { collapseToasts, expandToasts, hiddenToastCount, toastsExpanded } from './toastStack'

// The older toasts, folded. Collapse is fine; hide is not: this is always on
// screen while any are folded, says how many, and brings them all back.
export function ToastOverflow() {
    return (
        <>
            <Show when={hiddenToastCount() > 0}>
                <Button variant="secondary" size="sm" onClick={expandToasts}>
                    {`+${hiddenToastCount()} more`}
                </Button>
            </Show>
            <Show when={toastsExpanded()}>
                <Button variant="secondary" size="sm" onClick={collapseToasts}>
                    Show fewer
                </Button>
            </Show>
        </>
    )
}
