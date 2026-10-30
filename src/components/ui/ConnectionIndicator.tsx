import './ConnectionIndicator.css'

export type ConnectionIndicatorState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'signed_out'

type ConnectionIndicatorProps = {
    state: ConnectionIndicatorState
    /** Changes on their way to the server right now. Shown as "Syncing 2
     *  changes" while the connection is live. Not announced: it changes with
     *  every tick, and the pending-changes row beside it has its own words. */
    syncing?: number
}

const LABELS: Record<ConnectionIndicatorState, string> = {
    connecting: 'Connecting',
    live: 'Connected',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
    signed_out: 'Signed out',
}

// Whether changes made elsewhere are arriving, as a dot and a short word, in the
// rail and in the phone's top bar. Collapsed, the word is not drawn but is still
// the hover text and the name read out.
//
// Only a change of state is announced (politely - none of these is an error,
// the app keeps working from its local copy): the live region holds the state
// word alone and is in the page before anything changes. "Syncing N changes" is
// drawn but kept out of it, so a burst of edits is not a burst of announcements.
//
// Domain-agnostic: it is handed a state and knows nothing of sockets or sessions.
export function ConnectionIndicator(props: ConnectionIndicatorProps) {
    const shown = () => {
        const n = props.syncing ?? 0
        return props.state === 'live' && n > 0 ? `Syncing ${n} ${n === 1 ? 'change' : 'changes'}` : LABELS[props.state]
    }
    return (
        <div class="connection t-meta" data-state={props.state} title={shown()}>
            <span class="connection__dot" aria-hidden="true" />
            <span class="connection__label" aria-hidden="true">
                {shown()}
            </span>
            <span class="visually-hidden" role="status" aria-live="polite">
                {LABELS[props.state]}
            </span>
        </div>
    )
}
