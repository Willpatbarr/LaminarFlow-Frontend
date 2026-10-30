import { omit } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Icon } from './icons/Icon'
import './Checkbox.css'

type CheckboxProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'>

// The "Input, Select, Checkbox" specimen's box. A real <input type="checkbox">
// stays underneath, invisible but filling the box, so the label, Space, forms,
// the disabled state and the accessible name all work as they do natively. The
// caller keeps its own <label> and puts the words in it; this is only the box.
// The tick is the coolicons Check, not a font glyph.
export function Checkbox(props: CheckboxProps) {
    const rest = omit(props, 'class')
    return (
        <span class={`checkbox${props.class ? ` ${props.class}` : ''}`}>
            <input {...rest} class="checkbox__input" type="checkbox" />
            <span class="checkbox__box" aria-hidden="true">
                <Icon name="check" size={16} class="checkbox__tick" />
            </span>
        </span>
    )
}
