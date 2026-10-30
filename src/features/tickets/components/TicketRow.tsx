import { createSignal, For, Match, Show, Switch } from 'solid-js'

import { denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons/Icon'
import { IconButton } from '@/components/ui/IconButton'
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
    /** The ticket is no longer in the list's answer but the list is holding its
     *  place (see listView/freezeOrder): drawn dimmed and inert. */
    gone?: boolean
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

// The row's buttons are icons, quiet until the row is hovered or focused (see
// Table.css), with their words in a tooltip. The list binds no key for Edit or
// Archive (E and S belong to the ticket page), so there is no shortcut to
// show beside them yet.

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
    // The link is named by the title alone; the other cells describe it.
    const cellId = (part: string) => `ticket-row-${props.ticket.id}-${part}`
    const describedBy = () => cells().map(cellId).join(' ')

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

    // The form disappears on Save, Cancel and Escape, and the focus in it with
    // it. Put it back on this row's Edit button, so a keyboard user is not
    // dropped to the page (and the list stays frozen for them, LAM-145).
    let editButton: HTMLButtonElement | undefined
    function stopEditing() {
        setEditing(false)
        setTimeout(() => editButton?.focus())
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
        stopEditing()
        // Nothing changed queues nothing.
        if (Object.keys(patch).length > 0) void updateTicket(id(), patch)
    }

    // `undefined` when there is no conflict: the table renders the "below" box
    // only for something truthy, and an empty `<Show>` is truthy, which left a
    // 12px empty box under every row (LAM-176).
    const panel = () => {
        const found = conflicted()
        if (!found) return undefined
        return (
            <ConflictPanel
                kind={found.kind}
                conflict={found.conflict}
                mine={props.ticket}
                statuses={props.statuses}
                viewer={props.viewer}
                onKeepTheirs={() => discard(found.entryId)}
                onUseMine={() => retry(found.entryId)}
                onKeepAsNew={() => keepAsNew(found.entryId)}
            />
        )
    }

    return (
        <Show
            when={editing() && !locked()}
            fallback={
                <TableRow
                    href={`/tickets/${props.ticket.id}`}
                    labelledBy={cellId('title')}
                    describedBy={describedBy()}
                    below={panel()}
                    gone={props.gone}
                    actions={
                        <>
                            <IconButton
                                label={`Edit ${name()}`}
                                tooltip={'Edit title and status'}
                                disabled={locked()}
                                disabledReason={denial('ticket:write', 'edit tickets')}
                                ref={(el) => {
                                    editButton = el
                                }}
                                onClick={startEditing}
                            >
                                <Icon name="edit" size={16} />
                            </IconButton>
                            <IconButton
                                label={`Archive ${name()}`}
                                tooltip={'Archive ticket'}
                                disabled={locked()}
                                disabledReason={denial('ticket:write', 'archive tickets')}
                                onClick={() => void archiveWithUndo(props.ticket)}
                            >
                                <Icon name="archive" size={16} />
                            </IconButton>
                        </>
                    }
                >
                    <span class="ticket__title-cell">
                        <span class="table__text t-cell" id={cellId('title')}>
                            {name()}
                        </span>
                        <Show when={!cells().includes('label')}>
                            <LabelChips ids={props.ticket.label_ids} max={3} />
                        </Show>
                    </span>
                    <For each={cells()}>
                        {(field) => (
                            <Switch>
                                <Match when={field === 'status'}>
                                    <span id={cellId('status')}>
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
                                    <span id={cellId('assignee')} style={{ display: 'contents' }}>
                                        <AssigneeMarker assigneeId={props.ticket.assignee_id} viewer={props.viewer} />
                                    </span>
                                </Match>
                                <Match when={field === 'epic'}>
                                    <span class="table__text t-cell" data-cell="epic" id={cellId('epic')}>
                                        {nameOf(sync.epics, props.ticket.epic_id) || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'milestone'}>
                                    <span class="table__text t-cell" data-cell="milestone" id={cellId('milestone')}>
                                        {nameOf(sync.milestones, props.ticket.milestone_id) || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'label'}>
                                    <span id={cellId('label')}>
                                        <LabelChips ids={props.ticket.label_ids} max={2} />
                                    </span>
                                </Match>
                                <Match when={field === 'sprint'}>
                                    <span class="table__text t-cell" data-cell="sprint" id={cellId('sprint')}>
                                        {props.ticket.sprint_ids
                                            .map((id) => nameOf(sync.sprints, id))
                                            .filter((n) => n !== '')
                                            .join(', ') || '—'}
                                    </span>
                                </Match>
                                <Match when={field === 'updated_at'}>
                                    <span class="t-meta" id={cellId('updated_at')}>
                                        <RelativeTime at={props.ticket.updated_at} />
                                    </span>
                                </Match>
                                <Match when={field === 'position'}>
                                    <span class="t-meta" data-cell="position" id={cellId('position')}>
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
            <TableRow editing onSubmit={save} onCancel={stopEditing}>
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
                    <Button variant="ghost" size="sm" onClick={stopEditing}>
                        Cancel
                    </Button>
                </span>
            </TableRow>
        </Show>
    )
}
