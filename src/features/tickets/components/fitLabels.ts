/*
┌─ tickets ───────────────────────────────────────
│  fitLabels: how many label chips fit on one line (LAM-196)
├─ out ───────────────────────────────────────────
│      hiddenCount   hiddenCount(ends, room, moreWidth, gap) - chips that do not fit
│      observeFit    observeFit(wrap, list, measure)         - re-measure when either resizes
*/

/** How many of the chips, counted from the end, do not fit in `room` pixels.
 *  `ends[i]` is where chip i ends, measured from the line's start with all the
 *  chips laid out. When any are hidden the "+N" chip takes the end of the line
 *  (`moreWidth`, after a `gap`), and the chips before it must clear it. */
export function hiddenCount(ends: number[], room: number, moreWidth: number, gap: number): number {
    if (ends.length === 0 || room <= 0) return 0
    if (ends[ends.length - 1] <= room) return 0
    const fitting = ends.filter((end) => end + gap + moreWidth <= room).length
    return ends.length - fitting
}

type Measure = () => (() => void) | undefined

const jobs = new Map<Element, Measure>()
let queued = new Set<Measure>()
let frame = 0
let observer: ResizeObserver | undefined

// One frame at a time: every row's reads run first, then every row's writes, so
// a list of hundreds of rows lays out once per frame instead of once per row.
function flush() {
    frame = 0
    const batch = queued
    queued = new Set()
    const writes: (() => void)[] = []
    for (const measure of batch) {
        const write = measure()
        if (write) writes.push(write)
    }
    for (const write of writes) write()
}

function schedule(measure: Measure) {
    queued.add(measure)
    if (!frame) frame = requestAnimationFrame(flush)
}

/** Calls `measure` (reads, returning a write) once now and again whenever the
 *  line or the chips inside it change size. One observer is shared by every row.
 *  Where there is no ResizeObserver (a test environment) it does nothing.
 *  Returns the cleanup. */
export function observeFit(wrap: Element, list: Element, measure: Measure): (() => void) | undefined {
    if (typeof ResizeObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return undefined
    observer ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
            const found = jobs.get(entry.target)
            if (found) schedule(found)
        }
    })
    jobs.set(wrap, measure)
    jobs.set(list, measure)
    observer.observe(wrap)
    observer.observe(list)
    return () => {
        observer?.unobserve(wrap)
        observer?.unobserve(list)
        jobs.delete(wrap)
        jobs.delete(list)
        queued.delete(measure)
    }
}
