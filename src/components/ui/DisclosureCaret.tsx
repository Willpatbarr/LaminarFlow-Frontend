import { Icon } from './icons/Icon'
import './DisclosureCaret.css'

// The open/closed marker of a <details> panel, in place of the browser's own
// triangle. Both carets are drawn; CSS shows the one that matches [open] on the
// enclosing <details>. Put it first in the <summary>, which needs
// `class="disclosure-summary"` to drop the native marker.
export function DisclosureCaret() {
    return (
        <span class="disclosure-caret" aria-hidden="true">
            <Icon name="caret-right" size={16} class="disclosure-caret__closed" />
            <Icon name="caret-down" size={16} class="disclosure-caret__open" />
        </span>
    )
}
