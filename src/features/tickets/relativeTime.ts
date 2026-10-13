/*
┌─ tickets ───────────────────────────────────────
│  "2 minutes ago", from a timestamp and a clock that is passed in
├─ out ───────────────────────────────────────────
│      relativeTime   (iso, nowMs) → "just now" · "2 minutes ago" · "3 hours ago" · "5 days ago"
│      absoluteTime   iso → "12 Jan 2026, 14:03", for the tooltip
*/
// `Intl.RelativeTimeFormat` does the words, so the language and the plurals
// are the browser's. The clock is an argument so the same call is testable and
// so the caller decides when it ticks.

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'long' })
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(iso: string, nowMs: number): string {
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return 'a while ago'
    const age = nowMs - then
    // A clock a little behind the server's makes "in 3 seconds" - which is no
    // use to anyone reading "was edited ...".
    if (age < 45_000) return 'just now'
    if (age < HOUR) return rtf.format(-Math.max(1, Math.round(age / MINUTE)), 'minute')
    if (age < DAY) return rtf.format(-Math.round(age / HOUR), 'hour')
    return rtf.format(-Math.round(age / DAY), 'day')
}

export function absoluteTime(iso: string): string {
    const then = new Date(iso)
    return Number.isNaN(then.getTime()) ? iso : absolute.format(then)
}
