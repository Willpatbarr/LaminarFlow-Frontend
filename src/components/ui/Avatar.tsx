import './Avatar.css'

type AvatarProps = {
    /** Two letters. Absent draws the dashed "nobody here yet" slot instead. */
    initials?: string
    /** What a screen reader says in place of the letters, e.g. "Assigned to you". */
    label: string
    /** Pixels. Defaults to the sheet's 20. */
    size?: number
}

// From the "Pill, Chip, Avatar" specimen: initials on --accent-tint, the one
// non-status use of the accent - people are not a status hue. The empty slot
// is the specimen's AvatarStack `unassignedSlot`: dashed means "nothing here
// yet" everywhere in this system.
export function Avatar(props: AvatarProps) {
    const size = () => props.size ?? 20
    return (
        <span
            // A template literal on purpose: the pinned compiler (rc.8) wraps
            // any other dynamic `class`/`style` expression in `readShallow`,
            // which the pinned runtime (rc.7) does not export.
            class={`avatar${props.initials ? '' : ' avatar--empty'}`}
            role="img"
            aria-label={props.label}
            title={props.label}
            style={{
                width: `${size()}px`,
                height: `${size()}px`,
                'font-size': `${Math.round(size() * 0.45)}px`,
            }}
        >
            {props.initials}
        </span>
    )
}
