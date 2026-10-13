import { Show } from 'solid-js'

import type { TicketSyncState } from '@/sync'

// What each state is called. LAM-70 (errors) and LAM-71 (conflicts) build the
// screens that act on the last three; here they are only named.
const LABELS: Record<Exclude<TicketSyncState, 'synced'>, string> = {
    pending: 'Not synced yet',
    unauthorized: 'Not synced: sign in again',
    failed: 'Not synced: the server refused this change',
    conflict: 'Not synced: someone else changed this ticket',
}

type SyncMarkerProps = {
    state: TicketSyncState
    /** Also write the words out, for the detail page. A row shows the dot alone. */
    withText?: boolean
}

// The per-ticket "this has changes the server does not have" marker: a dot,
// hollow while it is simply waiting and solid rust when it needs someone.
// Renders nothing for a synced ticket.
export function SyncMarker(props: SyncMarkerProps) {
    return (
        <Show when={props.state !== 'synced' && props.state} keyed>
            {(state) => (
                <span class="sync-marker" data-state={state}>
                    <span
                        class="sync-marker__dot"
                        role={props.withText ? undefined : 'img'}
                        aria-label={props.withText ? undefined : LABELS[state]}
                        aria-hidden={props.withText ? 'true' : undefined}
                        title={LABELS[state]}
                    />
                    <Show when={props.withText}>
                        <span class="t-meta">{LABELS[state]}</span>
                    </Show>
                </span>
            )}
        </Show>
    )
}
