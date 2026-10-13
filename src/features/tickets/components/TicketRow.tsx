import { Show } from 'solid-js'

import { StatusPill } from '@/components/ui/StatusPill'
import { TableRow } from '@/components/ui/Table'
import { archiveOnHold, ticketSyncState, type Status, type Ticket } from '@/sync'

import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { AssigneeMarker } from './AssigneeMarker'
import { SyncMarker } from './SyncMarker'

type TicketRowProps = {
    ticket: Ticket
    /** The ticket's status, or null when it has none this team knows. */
    status: Status | null
    viewer: Viewer
}

// One ticket in the list: a link to its page. The href follows the ticket's
// id, so a row created offline points at its real address the moment it has
// one, without the row being rebuilt.
export function TicketRow(props: TicketRowProps) {
    return (
        <TableRow href={`/tickets/${props.ticket.id}`}>
            <span class="table__text t-cell">{props.ticket.title || 'Untitled'}</span>
            <span>
                <Show when={props.status} fallback={<StatusPill label="No status" hue="slate" />}>
                    {(status) => (
                        <StatusPill
                            label={status().name}
                            hue={hueFor(status().color)}
                            active={isStarted(status())}
                        />
                    )}
                </Show>
            </span>
            <AssigneeMarker assigneeId={props.ticket.assignee_id} viewer={props.viewer} />
            <SyncMarker
                state={ticketSyncState(props.ticket.id)}
                archive={archiveOnHold(props.ticket.id)}
            />
        </TableRow>
    )
}
