import './ConnectionIndicator.css'

export type ConnectionIndicatorState = 'connecting' | 'live' | 'reconnecting' | 'offline'

type ConnectionIndicatorProps = {
    state: ConnectionIndicatorState
}

const LABELS: Record<ConnectionIndicatorState, string> = {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
}

// Whether changes made elsewhere are arriving. Quiet when all is well: a green
// dot and no words on screen, because a rail that says "Live" all day is noise.
// The words are still there for a screen reader, and the region is in the page
// before anything changes, so going from Live to Reconnecting is announced
// (politely - it is not an error, the app keeps working from its local copy).
//
// Domain-agnostic: it is handed a state and knows nothing of sockets.
export function ConnectionIndicator(props: ConnectionIndicatorProps) {
    return (
        <div class="connection t-meta" role="status" aria-live="polite" data-state={props.state}>
            <span class="connection__dot" aria-hidden="true" />
            <span class={`connection__label${props.state === 'live' ? ' connection__label--quiet' : ''}`}>
                {LABELS[props.state]}
            </span>
        </div>
    )
}
