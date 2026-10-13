import { createSignal, onCleanup } from 'solid-js'

import { absoluteTime, relativeTime } from '../relativeTime'

type RelativeTimeProps = {
    /** An ISO timestamp. */
    at: string
}

// How often "2 minutes ago" is looked at again. Coarse on purpose: the words
// change once a minute at the fastest.
const TICK_MS = 30_000

// "2 minutes ago", kept true while it is on screen, with the exact time for
// anyone who wants it (hover, and the machine-readable `datetime`).
export function RelativeTime(props: RelativeTimeProps) {
    const [now, setNow] = createSignal(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    onCleanup(() => clearInterval(timer))

    return (
        <time datetime={props.at} title={absoluteTime(props.at)}>
            {relativeTime(props.at, now())}
        </time>
    )
}
