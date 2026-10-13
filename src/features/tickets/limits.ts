import type { Count } from '@/components/ui/count'

/*
┌─ tickets ───────────────────────────────────────
│  the server's length limits, and how this client counts against them
├─ out ───────────────────────────────────────────
│      LIMITS                       ticket title, ticket description, team and project name
│      codePoints                   a string's length the way the server counts it
│      titleCount · descriptionCount · nameCount   → Count for a field
│      overMessage                  "Title can be at most 200 characters; this one is 12 over."
│      BLANK_TITLE                  the sentence for a title with nothing in it
├─ example ───────────────────────────────────────
│      titleCount('  ' + 'x'.repeat(212))  →  { used: 212, max: 200 }
*/
// The numbers are the backend's (LAM-75), written down here once. They are in
// api/openapi.json as `maxLength`, but that document is every path and schema of
// the API, which no screen needs, so it is not bundled for three numbers:
// limits.test.ts reads it instead and fails the moment these drift from it.
// The server's 422 stays the authority; this only saves the round trip, and
// the screen the user is on, for the commonest mistake.
export const LIMITS = {
    ticketTitle: 200,
    ticketDescription: 50_000,
    /** Team and project names. */
    name: 100,
} as const

/** The server counts Unicode code points, not UTF-16 units: an emoji is one,
 *  where `string.length` says two. Spreading a string walks it by code point. */
export function codePoints(value: string): number {
    return [...value].length
}

// The title is sent trimmed (and refused if nothing is left), so what counts
// against its limit is what would be sent.
export const titleCount = (value: string): Count => ({
    used: codePoints(value.trim()),
    max: LIMITS.ticketTitle,
})

export const descriptionCount = (value: string): Count => ({
    used: codePoints(value),
    max: LIMITS.ticketDescription,
})

export const nameCount = (value: string): Count => ({
    used: codePoints(value.trim()),
    max: LIMITS.name,
})

export const BLANK_TITLE = 'A ticket needs a title.'

/** Words for a field that is over its limit, or undefined when it is not. */
export function overMessage(noun: string, count: Count): string | undefined {
    if (count.used <= count.max) return undefined
    return `${noun} can be at most ${count.max.toLocaleString('en-US')} characters; this one is ${(count.used - count.max).toLocaleString('en-US')} over.`
}
