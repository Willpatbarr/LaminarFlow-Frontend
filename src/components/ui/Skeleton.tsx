import './Skeleton.css'

/** A CSS length with its unit. A bare number is a type error on purpose: the
 *  specimen's `w={220}` hides whether that is px, and a width that is really a
 *  share of its container (`60%`) or of the type (`24ch`) reads differently from
 *  one that is a fixed size. */
export type SkeletonLength = `${number}${'%' | 'ch' | 'em' | 'rem' | 'px'}`

type SkeletonLineProps = {
    /** Defaults to the whole width of its container. */
    width?: SkeletonLength
    /** The height of the text it stands in for, not of its line box: whoever
     *  draws the line keeps the line box itself (see `.ticket__skeleton-label`). */
    height?: SkeletonLength
}

type SkeletonBoxProps = {
    width?: SkeletonLength
    /** Must match the control, chip or card it stands in for, or the layout
     *  moves when the real thing arrives. */
    height: SkeletonLength
    /** `chip` and `control` and `card` are the radius tokens; `pill` is fully
     *  rounded, so a row of them reads as labels loading rather than as text. */
    shape?: 'chip' | 'control' | 'card' | 'pill'
}

type SkeletonCircleProps = {
    /** Both the width and the height. Smaller than the avatar or monogram it
     *  stands in for and the row jumps on arrival. */
    size: SkeletonLength
}

// The shapes every container's loading state is built from (the "Skeleton
// primitives" specimen). The specimen has one component whose four uses differ
// only in size and radius; these are three, because the radius a line, a box
// and a circle want is not something a caller should have to remember.
//
// They know nothing about tickets or navs. A container - the only thing that
// knows where its own title and badge sit - composes them in its own layout and
// carries the accessible state itself (`aria-busy` and one status message), so
// every primitive is `aria-hidden`: a screen reader hears "loading" once, not
// "group, group, group" for each grey bar.
//
// Class names are template literals on purpose: the pinned compiler (rc.8)
// wraps any other dynamic `class`/`style` expression in `readShallow`, which
// the pinned runtime (rc.7) does not export.

/** A run of text. */
export function SkeletonLine(props: SkeletonLineProps) {
    return (
        <span
            class="skeleton skeleton--line"
            aria-hidden="true"
            style={{ width: props.width ?? '100%', height: props.height ?? '14px' }}
        />
    )
}

/** A chip, a field, a button, a card: anything rectangular that is not text. */
export function SkeletonBox(props: SkeletonBoxProps) {
    return (
        <span
            class={`skeleton skeleton--${props.shape ?? 'control'}`}
            aria-hidden="true"
            style={{ width: props.width ?? '100%', height: props.height }}
        />
    )
}

/** An avatar or a monogram. */
export function SkeletonCircle(props: SkeletonCircleProps) {
    return (
        <span
            class="skeleton skeleton--circle"
            aria-hidden="true"
            style={{ width: props.size, height: props.size }}
        />
    )
}
