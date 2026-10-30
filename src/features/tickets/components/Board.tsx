import { useLocation, useNavigate } from '@solidjs/router'
import { createMemo, createSignal, For, Show, untrack } from 'solid-js'

import { can, denial } from '@/features/auth'
import { useScope } from '@/features/shortcuts/registry'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Popover } from '@/components/ui/Popover'
import { StatusPill } from '@/components/ui/StatusPill'
import { Tooltip } from '@/components/ui/Tooltip'
import {
    archiveOnHold,
    boardHead,
    discard,
    statusesForProject,
    sync,
    ticketHead,
    ticketSyncState,
    updateBoard,
    updateTicket,
    type Board as BoardRow,
    type BoardColumn,
    type Ticket,
} from '@/sync'

import {
    cardsOf,
    columnOfStatus,
    inOrder,
    lookStatus,
    moveColumn,
    positionAt,
    renameColumn,
    setVisible,
    statusFor,
    withStatusIn,
} from '../board'
import { nameCount, overMessage } from '../limits'
import { fromSearch, type ListViewConfig } from '../listView/config'
import { matches } from '../listView/evaluate'
import { boardSearch, VIEW_PARAM, viewUrl } from '../savedViews/savedView'
import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { AssigneeMarker } from './AssigneeMarker'
import { LabelChips } from './LabelChips'
import { ListControls } from './ListControls'
import { SavedViewBar } from './SavedViewBar'
import { StatusEditor } from './StatusEditor'
import { SyncMarker } from './SyncMarker'
import { ViewSwitch } from './ViewSwitch'
import { Icon } from '@/components/ui/icons/Icon'
import './board.css'
import { Checkbox } from '@/components/ui/Checkbox'

/*
┌─ tickets ───────────────────────────────────────
│  Board: the Kanban view of one project (LAM-107)
├─ out ───────────────────────────────────────────
│      Board   <Board board={…} viewer={…} />
├─ example ───────────────────────────────────────
│      drag a card to another column  →  one updateTicket({status_id, position}) on drop
│      Space lifts a focused card, arrows move it, Space drops it, Escape puts it back
*/
// A column shows the tickets of the statuses it maps to, in `position` order.
// Nothing here keeps a copy of anything: columns come from the board row and
// cards from the ticket rows, both in the local store, so a move, a rename or
// a hide shows at once and is sent by the outbox like any other write.
//
// A drag (or a keyboard lift) is only a `lift` signal - which card, over which
// column, at which place - and the screen draws it. Nothing is written until
// the drop, and the drop is one `updateTicket`: the new status and the new
// position together. The server answers that as a single move.

type BoardProps = {
    board: BoardRow
    viewer: Viewer
}

type Lift = {
    ticketId: string
    columnId: string
    /** Where it would land among the column's other cards. */
    index: number
    by: 'mouse' | 'keyboard'
}

type Entry = { key: string; ticket: Ticket | null }

export function Board(props: BoardProps) {
    const [lift, setLift] = createSignal<Lift | null>(null)
    const [said, say] = createSignal('')
    const [editingStatuses, setEditingStatuses] = createSignal(false)
    let root: HTMLElement | undefined
    // The card keys below are handled on the card itself; this makes the help
    // sheet list them (they are declared in the shortcut registry).
    useScope('board')

    const navigate = useNavigate()
    const location = useLocation()

    const project = () => sync.projects.find((candidate) => candidate.id === props.board.project_id)
    const statuses = () => statusesForProject(props.board.project_id)

    // The board's filter is in the address, as the list's whole view is
    // (listView/config.ts), and it is all of a board's view there is: its columns
    // are the board's own. `view=<id>` is the saved view it was opened from
    // (LAM-118). The filter is run here, over the rows this device holds.
    const viewId = () => new URLSearchParams(location.search).get(VIEW_PARAM) || null
    const config = createMemo<ListViewConfig>(() => ({ filter: fromSearch(new URLSearchParams(location.search)).config.filter }))
    const setFilter = (next: ListViewConfig) => navigate(`${location.pathname}?${boardSearch(next.filter, viewId())}`, { replace: true })
    const tickets = createMemo(() =>
        sync.tickets.filter((ticket) => ticket.project_id === props.board.project_id && matches(ticket, config().filter)),
    )
    const columns = () => inOrder(props.board.columns)
    const shown = () => columns().filter((column) => column.is_visible)
    const hidden = () => columns().filter((column) => !column.is_visible)
    const cards = (column: BoardColumn) => cardsOf(column, tickets(), props.board.columns)
    const others = (column: BoardColumn) => cards(column).filter((ticket) => ticket.id !== lift()?.ticketId)
    // A column with no status has nothing to set on a card dropped in it.
    const accepts = (column: BoardColumn) => column.status_ids.length > 0

    // Tickets no column shows because no column holds their status. A hidden
    // column's tickets are not counted: hiding them was asked for.
    const unplaced = () =>
        tickets().filter((ticket) => !ticket.status_id || !columnOfStatus(props.board, ticket.status_id)).length

    const head = () => boardHead(props.board.id)

    function save(next: BoardColumn[] | null) {
        if (next) void updateBoard(props.board.id, { columns: next })
    }

    // ── lifting, moving, dropping ───────────────────────────────────────────

    function lifted(ticket: Ticket, by: Lift['by']) {
        const column = columns().find((candidate) => ticket.status_id !== null && candidate.status_ids.includes(ticket.status_id))
        if (!column) return
        setLift({ ticketId: ticket.id, columnId: column.id, index: cards(column).findIndex((card) => card.id === ticket.id), by })
    }

    function steer(next: Omit<Lift, 'ticketId' | 'by'>) {
        const now = lift()
        if (!now || (now.columnId === next.columnId && now.index === next.index)) return
        setLift({ ...now, ...next })
    }

    function where(l: Lift) {
        const column = columns().find((candidate) => candidate.id === l.columnId)
        return column ? `${column.name}, position ${l.index + 1} of ${others(column).length + 1}` : ''
    }

    function drop() {
        const l = lift()
        setLift(null)
        if (!l) return
        const ticket = tickets().find((candidate) => candidate.id === l.ticketId)
        const column = columns().find((candidate) => candidate.id === l.columnId)
        if (!ticket || !column) return
        const statusId = statusFor(column, ticket)
        if (!statusId) return
        // Dropped where it already is: nothing to write.
        const before = cards(column).findIndex((card) => card.id === ticket.id)
        if (before === l.index && statusId === ticket.status_id) return

        const moved = moveCard(ticket, column, statusId, l.index)
        if (l.by === 'keyboard') {
            // The card is rebuilt in its new column; keep the keyboard where it was.
            void moved.then(() =>
                requestAnimationFrame(() =>
                    root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(ticket.id)}"]`)?.focus(),
                ),
            )
        }
    }

    // The one write behind every move: a drag's drop, a lifted card's drop and
    // the card menu. `index` is the place among the column's other cards.
    function moveCard(ticket: Ticket, column: BoardColumn, statusId: string, index: number) {
        const rest = cards(column).filter((card) => card.id !== ticket.id)
        const moved = updateTicket(ticket.id, { status_id: statusId, position: positionAt(rest, index) })
        say(`Dropped in ${column.name}, position ${index + 1} of ${rest.length + 1}.`)
        return moved
    }

    // The card menu (LAM-184): the same move as a drop, chosen instead of dragged.
    function menuMove(ticket: Ticket, column: BoardColumn, index?: number) {
        const statusId = statusFor(column, ticket)
        if (!statusId) return
        void moveCard(ticket, column, statusId, index ?? cards(column).filter((card) => card.id !== ticket.id).length).then(() =>
            requestAnimationFrame(() =>
                root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(ticket.id)}"] .board__card-menu`)?.focus(),
            ),
        )
    }

    function cancel() {
        if (!lift()) return
        setLift(null)
        say('Move cancelled.')
    }

    function overColumn(event: DragEvent, column: BoardColumn) {
        const now = lift()
        if (!now || !accepts(column)) return
        event.preventDefault()
        const list = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
        const cardEls = [...(list?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])].filter(
            (el) => el.dataset.cardId !== now.ticketId,
        )
        const index = cardEls.filter((el) => {
            const box = el.getBoundingClientRect()
            return event.clientY > box.top + box.height / 2
        }).length
        steer({ columnId: column.id, index })
    }

    function onCardKey(event: KeyboardEvent, ticket: Ticket) {
        // Keys meant for the link inside the card are not the card's.
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
        const l = lift()
        if (!l || l.ticketId !== ticket.id) {
            if (event.key === ' ') {
                event.preventDefault()
                lifted(ticket, 'keyboard')
                say(`Picked up ${ticket.title || 'Untitled'}. Arrow keys move it, Space drops it, Escape cancels.`)
            } else if (event.key === 'Enter') {
                event.preventDefault()
                if (event.currentTarget instanceof HTMLElement) event.currentTarget.querySelector('a')?.click()
            }
            return
        }
        const column = columns().find((candidate) => candidate.id === l.columnId)
        if (!column) return
        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowDown': {
                event.preventDefault()
                const index = Math.max(0, Math.min(l.index + (event.key === 'ArrowUp' ? -1 : 1), others(column).length))
                steer({ columnId: column.id, index })
                break
            }
            case 'ArrowLeft':
            case 'ArrowRight': {
                event.preventDefault()
                const open = shown().filter(accepts)
                const at = open.findIndex((candidate) => candidate.id === column.id)
                const next = open[at + (event.key === 'ArrowLeft' ? -1 : 1)]
                if (next) steer({ columnId: next.id, index: Math.min(l.index, others(next).length) })
                break
            }
            case ' ':
            case 'Enter':
                event.preventDefault()
                drop()
                return
            case 'Escape':
                event.preventDefault()
                cancel()
                return
            default:
                return
        }
        const now = lift()
        if (now) say(where(now))
    }

    // The column's cards with a gap where the lifted card would land. The lifted
    // card itself stays where it was, faded: removing the element a drag started
    // on ends the drag without its `dragend`.
    function entries(column: BoardColumn): Entry[] {
        const l = lift()
        const all = cards(column)
        if (!l || l.columnId !== column.id) return all.map((ticket) => ({ key: ticket.id, ticket }))
        const noop = all.findIndex((card) => card.id === l.ticketId) === l.index
        const list: Entry[] = []
        let seen = 0
        let slotted = noop
        for (const ticket of all) {
            const isLifted = ticket.id === l.ticketId
            if (!isLifted && !slotted && seen === l.index) {
                list.push({ key: 'slot', ticket: null })
                slotted = true
            }
            list.push({ key: ticket.id, ticket })
            if (!isLifted) seen += 1
        }
        if (!slotted) list.push({ key: 'slot', ticket: null })
        return list
    }

    return (
        <section class="board" ref={(el) => (root = el)}>
            <header class="board__header">
                <p class="t-body">
                    <a class="icon-text" href={`/projects/${props.board.project_id}`} aria-label={`← ${project()?.name ?? 'Tickets'}`}>
                        <Icon name="chevron-left" size={16} />
                        {project()?.name ?? 'Tickets'}
                    </a>
                </p>
                <h1 class="t-screen-title">{project() ? `${project()!.name} · ${props.board.name}` : props.board.name}</h1>
                <ViewSwitch current="board" projectId={props.board.project_id} boardId={props.board.id} filter={config().filter} />
            </header>

            <Show when={project()} keyed>
                {(found) => (
                    <>
                        <SavedViewBar
                            layout="board"
                            config={config()}
                            viewId={viewId()}
                            accountId={props.viewer.accountId}
                            teamId={found.team_id}
                            projectId={found.id}
                            boardId={props.board.id}
                            onSaved={(saved) => navigate(`${location.pathname}?${boardSearch(config().filter, saved.id)}`, { replace: true })}
                            onRevert={(saved) => navigate(viewUrl(saved), { replace: true })}
                        />
                        <ListControls config={config()} onChange={setFilter} project={found} viewer={props.viewer} filterOnly />
                    </>
                )}
            </Show>

            <Show when={head()?.state === 'failed' && head()} keyed>
                {(entry) => (
                    <p class="board__problem t-meta" role="alert">
                        A change to this board was not saved: {entry.error?.errors[0]?.message ?? 'the server refused it.'}{' '}
                        <button type="button" class="board__link" onClick={() => void discard(entry.id)}>
                            Undo this change
                        </button>
                    </p>
                )}
            </Show>

            <Show when={unplaced() > 0}>
                <p class="board__note t-meta">
                    {unplaced()} {unplaced() === 1 ? 'ticket is' : 'tickets are'} not on this board: no column holds{' '}
                    {unplaced() === 1 ? 'its' : 'their'} status. Map statuses from a column’s menu.
                </p>
            </Show>

            <Show when={hidden().length > 0}>
                <p class="board__hidden t-meta">
                    Hidden columns:{' '}
                    <For each={hidden()} keyed={(column) => column.id}>
                        {(column) => (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabledReason={denial('ticket:write', 'change this board')}
                                aria-label={`Show column ${column().name}`}
                                onClick={() => save(setVisible(props.board.columns, column().id, true))}
                            >
                                {`Show ${column().name}`}
                            </Button>
                        )}
                    </For>
                </p>
            </Show>

            <div class="board__columns">
                <For each={shown()} keyed={(column) => column.id}>
                    {(column, index) => (
                        <section
                            class="board__column"
                            aria-label={column().name}
                            data-over={lift()?.columnId === column().id ? 'true' : undefined}
                            data-closed={accepts(column()) ? undefined : 'true'}
                            style={{ 'border-top-color': `var(--${hueFor(lookStatus(column(), statuses())?.color ?? '')})` }}
                            onDragOver={(event) => overColumn(event, column())}
                            onDrop={(event) => {
                                event.preventDefault()
                                if (lift()?.columnId === column().id) drop()
                            }}
                        >
                            <header class="board__column-header">
                                <h2 class="board__column-title">
                                    <StatusPill
                                        label={column().name}
                                        hue={hueFor(lookStatus(column(), statuses())?.color ?? '')}
                                        active={lookStatus(column(), statuses()) ? isStarted(lookStatus(column(), statuses())!) : false}
                                    />
                                    <span class="board__count t-meta">{cards(column()).length}</span>
                                </h2>
                                <ColumnMenu
                                    board={props.board}
                                    column={column()}
                                    first={index() === 0}
                                    last={index() === shown().length - 1}
                                    onEditStatuses={() => setEditingStatuses(true)}
                                />
                            </header>

                            <ul class="board__cards" aria-label={`${column().name} tickets`}>
                                <For each={entries(column())} keyed={(entry) => entry.key}>
                                    {(entry) => (
                                        <Show when={entry().ticket} fallback={<li class="board__slot" aria-hidden="true" />}>
                                            {(ticket) => (
                                                <Card
                                                    ticket={ticket()}
                                                    viewer={props.viewer}
                                                    showStatus={column().status_ids.length > 1}
                                                    column={column()}
                                                    destinations={shown().filter(accepts)}
                                                    siblings={cards(column())}
                                                    onMenuMove={(target, index) => menuMove(ticket(), target, index)}
                                                    lifted={lift()?.ticketId === ticket().id}
                                                    onDragStart={() => lifted(ticket(), 'mouse')}
                                                    onDragEnd={() => {
                                                        if (lift()?.by === 'mouse') setLift(null)
                                                    }}
                                                    onKey={(event) => onCardKey(event, ticket())}
                                                    onBlur={() =>
                                                        // Focus moves inside effects (a popover opening): read the lift untracked.
                                                        untrack(() => {
                                                            if (lift()?.ticketId === ticket().id && lift()?.by === 'keyboard') cancel()
                                                        })
                                                    }
                                                />
                                            )}
                                        </Show>
                                    )}
                                </For>
                            </ul>
                            <Show when={!accepts(column())}>
                                <p class="board__empty t-meta">No status in this column yet. Add one from the column menu.</p>
                            </Show>
                        </section>
                    )}
                </For>
            </div>

            <p class="visually-hidden" role="status" aria-live="assertive">
                {said()}
            </p>

            <Show when={editingStatuses() && project()} keyed>
                {(found) => (
                    <Modal title="Statuses" confirm="Done" cancel="Close" onConfirm={() => setEditingStatuses(false)} onCancel={() => setEditingStatuses(false)}>
                        <StatusEditor teamId={found.team_id} />
                    </Modal>
                )}
            </Show>
        </section>
    )
}

type CardProps = {
    ticket: Ticket
    viewer: Viewer
    /** The column holds several statuses: say which one this card is in. */
    showStatus: boolean
    lifted: boolean
    /** The column the card is in, the columns that take cards, and this column's cards in order. */
    column: BoardColumn
    destinations: BoardColumn[]
    siblings: Ticket[]
    /** Move to `column` at `index` among its other cards (the end of it, or one step up or down). */
    onMenuMove: (column: BoardColumn, index?: number) => void
    onDragStart: () => void
    onDragEnd: () => void
    onKey: (event: KeyboardEvent) => void
    onBlur: () => void
}

function Card(props: CardProps) {
    const id = () => props.ticket.id
    // A parked conflict or archive is decided on the ticket's page first.
    const locked = () => ticketHead(id())?.state === 'conflict' || archiveOnHold(id()) || !can('ticket:write')
    const status = () => sync.statuses.find((candidate) => candidate.id === props.ticket.status_id)
    const title = () => props.ticket.title || 'Untitled'
    const at = () => props.siblings.findIndex((card) => card.id === id())
    const reason = () =>
        denial('ticket:write', 'move tickets') ?? (locked() ? 'This ticket has a change waiting to be resolved on its page.' : undefined)
    const menu = (describedBy?: string) => (
        <Popover
            label={`Card actions for ${title()}`}
            role="menu"
            presentation="auto"
            trigger={(trigger) => (
                <button
                    type="button"
                    class="board__card-menu"
                    aria-label={`Card actions for ${title()}`}
                    aria-describedby={describedBy}
                    disabled={reason() !== undefined}
                    {...trigger}
                >
                    <Icon name="more" />
                </button>
            )}
        >
            <div class="board__card-actions">
                <p class="board__card-actions-head t-overline" aria-hidden="true">
                    Move to
                </p>
                <For each={props.destinations} keyed={(column) => column.id}>
                    {(column) => (
                        <button
                            type="button"
                            role="menuitem"
                            class="board__card-action"
                            aria-disabled={column().id === props.column.id ? 'true' : undefined}
                            aria-label={`Move to ${column().name}`}
                            onClick={() => column().id !== props.column.id && props.onMenuMove(column(), undefined)}
                        >
                            {column().name}
                            <Show when={column().id === props.column.id}>
                                <span class="t-meta"> (here)</span>
                            </Show>
                        </button>
                    )}
                </For>
                <hr class="board__card-actions-rule" />
                <button
                    type="button"
                    role="menuitem"
                    class="board__card-action"
                    aria-disabled={at() <= 0 ? 'true' : undefined}
                    onClick={() => at() > 0 && props.onMenuMove(props.column, at() - 1)}
                >
                    Move up
                </button>
                <button
                    type="button"
                    role="menuitem"
                    class="board__card-action"
                    aria-disabled={at() < 0 || at() >= props.siblings.length - 1 ? 'true' : undefined}
                    onClick={() => at() >= 0 && at() < props.siblings.length - 1 && props.onMenuMove(props.column, at() + 1)}
                >
                    Move down
                </button>
            </div>
        </Popover>
    )
    return (
        <li
            class="board__card"
            data-card-id={id()}
            data-lifted={props.lifted ? 'true' : undefined}
            tabindex="0"
            draggable={locked() ? 'false' : 'true'}
            aria-roledescription="draggable ticket"
            aria-label={props.ticket.title || 'Untitled'}
            onDragStart={(event) => {
                if (locked()) {
                    event.preventDefault()
                    return
                }
                event.dataTransfer?.setData('text/plain', id())
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                props.onDragStart()
            }}
            onDragEnd={() => props.onDragEnd()}
            onKeyDown={(event) => !locked() && props.onKey(event)}
            onFocusOut={() => props.onBlur()}
        >
            <a class="board__card-title t-cell" href={`/tickets/${id()}`} draggable="false">
                {title()}
            </a>
            <Show when={reason()} fallback={menu()}>
                {(why) => (
                    <Tooltip placement="above" text={why()}>
                        {(describedBy) => menu(describedBy)}
                    </Tooltip>
                )}
            </Show>
            <LabelChips ids={props.ticket.label_ids} max={3} />
            <span class="board__card-foot">
                <Show when={props.showStatus && status()}>
                    {(found) => <StatusPill label={found().name} hue={hueFor(found().color)} active={isStarted(found())} />}
                </Show>
                <AssigneeMarker assigneeId={props.ticket.assignee_id} viewer={props.viewer} />
                <SyncMarker state={ticketSyncState(id())} archive={archiveOnHold(id())} />
            </span>
        </li>
    )
}

type ColumnMenuProps = {
    board: BoardRow
    column: BoardColumn
    first: boolean
    last: boolean
    onEditStatuses: () => void
}

// The column's settings, in a Popover (a bottom sheet on phones; the disclosure pattern, not a menu: it
// holds a text field and checkboxes). It renders in a portal so the column's
// scroll area cannot clip it. Every change is a new `columns` for the board,
// written through the sync engine.
function ColumnMenu(props: ColumnMenuProps) {
    const [draft, setDraft] = createSignal<string | null>(null)
    const name = () => draft() ?? props.column.name
    const tooLong = () => overMessage('Name', nameCount(name()))
    const statuses = () => statusesForProject(props.board.project_id)
    const save = (next: BoardColumn[] | null) => {
        if (next) void updateBoard(props.board.id, { columns: next })
    }

    function commit() {
        const text = draft()
        setDraft(null)
        if (text !== null && !overMessage('Name', nameCount(text))) save(renameColumn(props.board.columns, props.column.id, text))
    }

    return (
        <Popover
            label={`Column ${props.column.name}`}
            presentation="auto"
            trigger={(trigger) => (
                <button type="button" class="board__menu-button" aria-label={`Column options for ${props.column.name}`} {...trigger}>
                    <Icon name="more" />
                </button>
            )}
        >
            {(close) => (
                <div class="board__menu-panel">
                    <form
                        onSubmit={(event) => {
                            event.preventDefault()
                            commit()
                        }}
                    >
                        <Input
                            label={`Name of column ${props.column.name}`}
                            value={name()}
                            onInput={setDraft}
                            onBlur={commit}
                            error={tooLong()}
                        />
                    </form>
                    <div class="board__menu-row">
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={props.first}
                            disabledReason={denial('ticket:write', 'change this board')}
                            aria-label={`Move ${props.column.name} left`}
                            onClick={() => {
                                close()
                                save(moveColumn(props.board.columns, props.column.id, -1))
                            }}
                        >
                            <Icon name="chevron-left" size={16} />
                            Left
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={props.last}
                            disabledReason={denial('ticket:write', 'change this board')}
                            aria-label={`Move ${props.column.name} right`}
                            onClick={() => {
                                close()
                                save(moveColumn(props.board.columns, props.column.id, 1))
                            }}
                        >
                            Right
                            <Icon name="chevron-right" size={16} />
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabledReason={denial('ticket:write', 'change this board')}
                            aria-label={`Hide column ${props.column.name}`}
                            onClick={() => {
                                close()
                                save(setVisible(props.board.columns, props.column.id, false))
                            }}
                        >
                            Hide
                        </Button>
                    </div>
                    <fieldset class="board__statuses">
                        <legend class="t-meta">Statuses shown in this column</legend>
                        <For each={statuses()} keyed={(status) => status.id}>
                            {(status) => (
                                <label class="board__status t-body" for={`board-status-${props.column.id}-${status().id}`}>
                                    <Checkbox
                                        id={`board-status-${props.column.id}-${status().id}`}
                                        checked={props.column.status_ids.includes(status().id)}
                                        onChange={(event) =>
                                            save(withStatusIn(props.board.columns, props.column.id, status().id, event.currentTarget.checked))
                                        }
                                    />
                                    {status().name}
                                    <Show
                                        when={
                                            !props.column.status_ids.includes(status().id) &&
                                            columnOfStatus(props.board, status().id)
                                        }
                                    >
                                        {(other) => <span class="t-meta"> (now in {other().name})</span>}
                                    </Show>
                                </label>
                            )}
                        </For>
                    </fieldset>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabledReason={denial('team:write', 'edit statuses')}
                        onClick={() => {
                            close()
                            props.onEditStatuses()
                        }}
                    >
                        Edit statuses…
                    </Button>
                </div>
            )}
        </Popover>
    )
}
