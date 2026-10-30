import './Icon.css'
import { ICON_PATHS, type IconName } from './paths'

export type { IconName }
export { ICON_PATHS }

type IconProps = {
    name: IconName
    /** Pixels, square. 20 by default; the coolicons grid is 24. */
    size?: number
    class?: string
    /** Set only when the icon stands alone with no text or accessible name
     *  beside it. Otherwise it is decorative and hidden from assistive tech. */
    label?: string
}

// One coolicons glyph: 24x24 grid, 2px stroke, round caps and joins, painted in
// currentColor so it follows the text colour of whatever holds it.
export function Icon(props: IconProps) {
    return (
        <svg
            class={`${props.class ?? ''}`}
            width={props.size ?? 20}
            height={props.size ?? 20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden={props.label ? undefined : 'true'}
            role={props.label ? 'img' : undefined}
            aria-label={props.label}
        >
            <path d={ICON_PATHS[props.name]} />
        </svg>
    )
}
