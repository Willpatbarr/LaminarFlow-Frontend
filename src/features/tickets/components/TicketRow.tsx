import { Show } from 'solid-js'

import { SkeletonBox, SkeletonCircle, SkeletonLine, type SkeletonLength } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { TableRow } from '@/components/ui/Table'
import { archiveOnHold, ticketSyncState, type Status, type Ticket } from '@/sync'

import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { AssigneeMarker } from './AssigneeMarker'
import { SyncMarker } from './SyncMarker'

type LoadedRow = {
    loading?: false
    ticket: Ticket
    /** The ticket's status, or null when it has none this team knows. */
    status: Status | null
    viewer: Viewer
}

type LoadingRow = {
    loading: true
    /** How much of the title column the placeholder takes. A column of bars of
     *  one length looks like a table of identical rows; the list varies it. */
    titleWidth?: SkeletonLength
}

type TicketRowProps = LoadedRow | LoadingRow

// The row's data, or nothing while it is loading. Narrowing here keeps the
// loaded markup below free of casts.
const loaded = (props: TicketRowProps): LoadedRow | undefined =>
    props.loading ? undefined : props

// One ticket in the list: a link to its page. The href follows the ticket's
// id, so a row created offline points at its real address the moment it has
// one, without the row being rebuilt.
//
// While loading it draws its own placeholder in the same `TableRow`: a title
// line, a pill where the status goes, a circle where the assignee does. The
// real row shows the sync marker only for a ticket with something unsent, so
// the placeholder leaves that column empty too.
export function TicketRow(props: TicketRowProps) {
    return (
        <Show
            when={loaded(props)}
            fallback={
                <TableRow loading>
                    <span>
                        <SkeletonLine
                            width={props.loading ? (props.titleWidth ?? '60%') : '60%'}
                            height="13px"
                        />
                    </span>
                    <span>
                        <SkeletonBox shape="pill" width="72px" height="21px" />
                    </span>
                    <SkeletonCircle size="20px" />
                </TableRow>
            }
        >
            {(row) => (
                <TableRow href={`/tickets/${row().ticket.id}`}>
                    <span class="table__text t-cell">{row().ticket.title || 'Untitled'}</span>
                    <span>
                        <Show
                            when={row().status}
                            fallback={<StatusPill label="No status" hue="slate" />}
                        >
                            {(status) => (
                                <StatusPill
                                    label={status().name}
                                    hue={hueFor(status().color)}
                                    active={isStarted(status())}
                                />
                            )}
                        </Show>
                    </span>
                    <AssigneeMarker assigneeId={row().ticket.assignee_id} viewer={row().viewer} />
                    <SyncMarker
                        state={ticketSyncState(row().ticket.id)}
                        archive={archiveOnHold(row().ticket.id)}
                    />
                </TableRow>
            )}
        </Show>
    )
}
