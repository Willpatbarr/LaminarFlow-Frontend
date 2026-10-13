/** One of the eight sheet hues. */
export type Hue = 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'clay' | 'rust' | 'violet'

type StatusPillProps = {
    label: string
    hue: Hue
    /** Filled dot means the work is *in* this status; a ring means it has not
     *  begun. That distinction costs no second colour and no second word,
     *  which is what keeps a board of eight statuses readable. */
    active?: boolean
}

// From the "Pill, Chip, Avatar" specimen. The fill is the hue at --chip-alpha
// and the text its -fg, so one hue token drives both themes.
export function StatusPill(props: StatusPillProps) {
    const fg = () => `var(--${props.hue}-fg)`
    return (
        <span
            class="chip"
            style={{
                background: `color-mix(in srgb, var(--${props.hue}) var(--chip-alpha), transparent)`,
                color: fg(),
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    width: '6px',
                    height: '6px',
                    'border-radius': '50%',
                    'box-sizing': 'border-box',
                    background: props.active ? fg() : 'transparent',
                    border: props.active ? 'none' : `1.5px solid ${fg()}`,
                }}
            />
            {props.label}
        </span>
    )
}
