import { createSignal, For, Match, Show, Switch } from 'solid-js'

import { denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonBox, SkeletonCircle, SkeletonLine, type SkeletonLength } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { TableRow } from '@/components/ui/Table'
import {
    archiveOnHold,
    discard,
    keepAsNew,
    retry,
    sync,
    ticketHead,
    ticketSyncState,
    updateTicket,
    type Status,
    type Ticket,
} from '@/sync'

import { BLANK_TITLE, overMessage, titleCount } from '../limits'
import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { AssigneeMarker } from './AssigneeMarker'
import { archiveWithUndo } from './ArchiveUndoToast'
import { ConflictPanel } from './ConflictPanel'
import { LabelChips } from './LabelChips'
import { RelativeTime } from './RelativeTime'
import { SyncMarker } from './SyncMarker'

type LoadedRow = {
    loading?: false
    ticket: Ticket
    /** The ticket's status, or null when it has none this team knows. */
    status: Status | null
    /** Every status of the ticket's project, for the status picker. */
    statuses: Status[]
    viewer: Viewer
    /** The columns to draw after the title, in order, as ticket field names
     *  (the saved view `columns`). Omit for status and assignee. */
    columns?: string[]
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
            {(row) => <LoadedTicketRow {...row()} />}
        </Show>
    )
}

// A ticket in the list. The row is a link; the buttons beside it are not part
// of the link. "Edit" turns the title and status into fields in place; "Archive"
// archives at once and offers Undo (see ArchiveUndoToast), so there is no
// confirmation to click through.
//
// Both go through the same engine calls as the ticket page, so they are as
// offline-proof: the row changes the moment the local store does. A collision
// with someone else's change shows the same ConflictPanel as the page, under
// the row.
const DEFAULT_CELLS = ['status', 'assignee']

function LoadedTicketRow(props: LoadedRow) {
    const cells = () => props.columns ?? DEFAULT_CELLS
    const nameOf = (rows: { id: string; name: string }[], id: string | null) =>
        id === null ? '' : (rows.find((row) => row.id === id)?.name ?? '')

    const [editing, setEditing] = createSignal(false)
    const [title, setTitle] = createSignal('')
    const [statusId, setStatusId] = createSignal('')
    const [blankTried, setBlankTried] = createSignal(false)

    const id = () => props.ticket.id
    const name = () => props.ticket.title || 'Untitled'

    // The parked change that collided with someone else's, if the head of this
    // ticket's queue is one.
    const conflicted = () => {
        const head = ticketHead(id())
        return head?.state === 'conflict' && head.conflict
            ? {
                  entryId: head.id,
                  kind: head.kind === 'archive' ? ('archive' as const) : ('update' as const),
                  conflict: head.conflict,
              }
            : null
    }
    // Read-only until the user decides, as on the page.
    const locked = () => conflicted() !== null || archiveOnHold(id())

    const tooLong = () => overMessage('Title', titleCount(title()))
    const titleError = () => tooLong() ?? (blankTried() && title().trim() === '' ? BLANK_TITLE : undefined)

    const statusOptions = () => {
        const options = props.statuses.map((status) => ({ value: status.id, label: status.name }))
        const current = props.ticket.status_id
        if (current && !options.some((option) => option.value === current)) {
            options.push({ value: current, label: 'Unknown status' })
        }
        return [{ value: '', label: 'No status' }, ...options]
    }

    function startEditing() {
        setTitle(props.ticket.title)
        setStatusId(props.ticket.status_id ?? '')
        setBlankTried(false)
        setEditing(true)
    }

    function save() {
        const next = title().trim()
        if (next === '') {
            setBlankTried(true)
            return
        }
        if (tooLong()) return
        const patch: { title?: string; status_id?: string | null } = {}
        if (next !== props.ticket.title) patch.title = next
        if ((statusId() || null) !== props.ticket.status_id) patch.status_id = statusId() || null
        setEditing(false)
        // Nothing changed queues nothing.
        if (Object.keys(patch).length > 0) void updateTicket(id(), patch)
    }

    const panel = () => (
        <Show when={conflicted()}>
            {(found) => (
                <ConflictPanel
                    kind={found().kind}
                    conflict={found().conflict}
                    mine={props.ticket}
                    statuses={props.statuses}
                    viewer={props.viewer}
                    onKeepTheirs={() => discard(found().entryId)}
                    onUseMine={() => retry(found().entryId)}
                    onKeepAsNew={() => keepAsNew(found().entryId)}
                />
            )}
        </Show>
    )

    return (
        <Show
            when={editing() && !locked()}
            fallback={
                <TableRow
                    href={`/tickets/${props.ticket.id}`}
                    below={panel()}
                    actions={
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={locked()}
                                disabledReason={denial('ticket:write', 'edit tickets')}
                                aria-label={`Edit ${name()}`}
                                onClick={startEditing}
                            >
                                Edit
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={locked()}
                                disabledReason={denial('ticket:write', 'archive tickets')}
                                aria-label={`Archive ${name()}`}
                                onClick={() => void archiveWithUndo(props.ticket)}
                            >
                                Archive
                            </Button>
                        </>
                    }
                >
                    <span class="ticket__title-cell">
                        <span class="table__text t-cell">{name()}</span>
                        <Show when={!cells().includes('label')}>
                            <LabelChips ids={props.ticket.label_ids} max={3} />
                        </Show>
                    </span>
                    <For each={cells()}>
                        {(field) => (
                            <Switch>
                                <Match when={field === 'status'}>
                                    <span>
                                        <Show
                                            when={props.status}
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
                                </Match>
                                <Match when={field === 'assignee'}>
                                    <AssigneeMarker assigneeId={props.ticket.assignee_id} viewer={props.viewer} />
                                </Match>
                                <Match when={field === 'epic'}>
                                    <span class="table__text t-cell" data-cell="epic">
                                        {nameOf(sync.epics, props.ticket.epic_id) || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'milestone'}>
                                    <span class="table__text t-cell" data-cell="milestone">
                                        {nameOf(sync.milestones, props.ticket.milestone_id) || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'label'}>
                                    <span>
                                        <LabelChips ids={props.ticket.label_ids} max={2} />
                                    </span>
                                </Match>
                                <Match when={field === 'sprint'}>
                                    <span class="table__text t-cell" data-cell="sprint">
                                        {props.ticket.sprint_ids
                                            .map((id) => nameOf(sync.sprints, id))
                                            .filter((n) => n !== '')
                                            .join(', ') || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'updated_at'}>
                                    <span class="t-meta">
                                        <RelativeTime at={props.ticket.updated_at} />
                                    </span>
                                </Match>
                                <Match when={field === 'position'}>
                                    <span class="t-meta" data-cell="position">
                                        {props.ticket.position}
                                    </span>
                                </Match>
                            </Switch>
                        )}
                    </For>
                    <SyncMarker
                        state={ticketSyncState(props.ticket.id)}
                        archive={archiveOnHold(props.ticket.id)}
                    />
                </TableRow>
            }
        >
            <TableRow editing onSubmit={save} onCancel={() => setEditing(false)}>
                <Input
                    label="Title"
                    hideLabel
                    ref={(el) => {
                        // Typing is what editing is for: start in the title.
                        queueMicrotask(() => el.focus())
                    }}
                    value={title()}
                    onInput={(value) => {
                        setBlankTried(false)
                        setTitle(value)
                    }}
                    count={titleCount(title())}
                    error={titleError()}
                />
                <Select
                    label="Status"
                    hideLabel
                    value={statusId()}
                    options={statusOptions()}
                    onChange={setStatusId}
                />
                <span class="table__edit-actions">
                    <Button type="submit" size="sm">
                        Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                        Cancel
                    </Button>
                </span>
            </TableRow>
        </Show>
    )
}
