import { Show } from 'solid-js'

import type { TicketSyncState } from '@/sync'

// What each state is called. A conflict is "needs a decision", in the blue of
// information rather than the rust of a fault: someone else changing a ticket
// is an ordinary event, and nothing is lost.
const LABELS: Record<Exclude<TicketSyncState, 'synced'>, string> = {
    pending: 'Not synced yet',
    unauthorized: 'Not synced: sign in again',
    failed: 'Not synced: the server refused this change',
    conflict: 'Needs a decision: someone else changed this ticket',
}

// A ticket kept in the list because its archive did not go through. Said
// differently, so the row is not read as an ordinary ticket with an edit.
const ARCHIVE_LABELS: Partial<Record<keyof typeof LABELS, string>> = {
    failed: 'Not archived: the server refused the archive',
    conflict: 'Needs a decision: someone else changed this ticket before you archived it',
}

type SyncMarkerProps = {
    state: TicketSyncState
    /** Also write the words out, for the detail page. A row shows the dot alone. */
    withText?: boolean
    /** The change that is waiting is an archive (`archiveOnHold`). */
    archive?: boolean
}

// The per-ticket "this has changes the server does not have" marker: a dot,
// hollow while it is simply waiting and solid rust when it needs someone.
// Renders nothing for a synced ticket.
export function SyncMarker(props: SyncMarkerProps) {
    return (
        <Show when={props.state !== 'synced' && props.state} keyed>
            {(state) => {
                const label = () => (props.archive && ARCHIVE_LABELS[state]) || LABELS[state]
                return (
                    <span class="sync-marker" data-state={state}>
                        <span
                            class="sync-marker__dot"
                            role={props.withText ? undefined : 'img'}
                            aria-label={props.withText ? undefined : label()}
                            aria-hidden={props.withText ? 'true' : undefined}
                            title={label()}
                        />
                        <Show when={props.withText}>
                            <span class="t-meta">{label()}</span>
                        </Show>
                    </span>
                )
            }}
        </Show>
    )
}
