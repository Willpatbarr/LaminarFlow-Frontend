/** How much of a limit a field has used. `used` is counted by the caller, the
 *  way the server counts, so the field does not need to know how. */
export type Count = { used: number; max: number }

// The count appears once it is useful and not before: a "12 / 200" under every
// field all the time is noise, and one that shows up at the last moment is a
// surprise. Within a tenth of the limit is the compromise.
const SHOWN_FROM = 0.9

export function showsCount(count: Count | undefined): count is Count {
    return count !== undefined && count.used >= count.max * SHOWN_FROM
}

export function isOver(count: Count | undefined): boolean {
    return count !== undefined && count.used > count.max
}

/** The ids a field's description should list: its error, then its count. */
export function describedBy(
    props: { error?: string; count?: Count },
    errorId: string,
    countId: string,
): string | undefined {
    const ids = [props.error ? errorId : null, showsCount(props.count) ? countId : null]
    return ids.filter(Boolean).join(' ') || undefined
}
