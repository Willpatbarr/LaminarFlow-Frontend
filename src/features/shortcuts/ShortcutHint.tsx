import { Show } from 'solid-js'

import { hintFor, type ShortcutId } from './registry'
import './shortcuts.css'

// The key, as text beside the thing it does. Hidden from the accessibility tree
// so it does not change the control's name; the control says it with
// `aria-keyshortcuts` instead. Nothing renders when the shortcut is not on offer.
export function ShortcutHint(props: { id: ShortcutId }) {
    return (
        <Show when={hintFor(props.id)}>
            {(keys) => (
                <kbd class="shortcut-hint t-meta" aria-hidden="true">
                    {keys()}
                </kbd>
            )}
        </Show>
    )
}
