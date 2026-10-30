import { createSignal, For, Show, untrack } from 'solid-js'

import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { MoveButtons } from '@/components/ui/MoveButtons'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { StatusPill } from '@/components/ui/StatusPill'
import {
    createStatus,
    deleteStatus,
    discard,
    isTempId,
    statusesForTeam,
    statusHead,
    sync,
    updateStatus,
    type Status,
} from '@/sync'

import { COLOURS, hueFor, isStarted } from '../statusLook'
import { nameCount, overMessage } from '../limits'
import './StatusEditor.css'

/*
┌─ tickets ───────────────────────────────────────
│  StatusEditor: rename, add, reorder and delete one team's statuses (LAM-95)
├─ out ───────────────────────────────────────────
│      StatusEditor   <StatusEditor teamId={…} />  - a self-contained section
│      reorderedIds   the ids after moving one to a new place (pure, for tests)
├─ example ───────────────────────────────────────
│      team settings renders it as the page; the board's column menu (LAM-107)
│      renders it in a Modal: <Modal title="Statuses"><StatusEditor teamId={…} /></Modal>
*/
// Every change goes through the sync engine's `status` entity, so it shows at
// once, works offline and is sent in order with everything else. The editor
// holds no copy of the statuses: it reads `statusesForTeam` and writes
// `createStatus` / `updateStatus` / `deleteStatus`, and so can be mounted
// anywhere, more than once, without the copies disagreeing.
//
// A status's place is its `position`. A move renumbers the team 1..n and
// updates only the statuses whose number changed; the engine sends that as one
// reorder (see entities/status.ts). Drag the handle, or use the Move buttons -
// dragging has no keyboard form of its own.

const CATEGORIES = [
    { value: 'not_started', label: 'Not started' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'done', label: 'Done' },
]

/** `ids` with `id` taken out and put back at index `to` (clamped). */
export function reorderedIds(ids: string[], id: string, to: number): string[] {
    const rest = ids.filter((candidate) => candidate !== id)
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id)
    return rest
}

type StatusEditorProps = {
    teamId: string
}

export function StatusEditor(props: StatusEditorProps) {
    const statuses = () => statusesForTeam(props.teamId)
    const [dragging, setDragging] = createSignal<string | null>(null)
    const [deleting, setDeleting] = createSignal<Status | null>(null)

    async function place(id: string, to: number) {
        const order = reorderedIds(
            statuses().map((status) => status.id),
            id,
            to,
        )
        const byId = new Map(statuses().map((status) => [status.id, status]))
        for (const [index, next] of order.entries()) {
            if (byId.get(next)?.position !== index + 1) await updateStatus(next, { position: index + 1 })
        }
    }

    const using = (id: string) => sync.tickets.filter((ticket) => ticket.status_id === id).length

    // The status whose place a deleted one's tickets take by default: the one
    // before it, or the first after it. Statuses not yet sent cannot be named.
    function neighbour(id: string): string | null {
        const others = statuses().filter((status) => !isTempId(status.id))
        const at = others.findIndex((status) => status.id === id)
        return (others[at - 1] ?? others[at + 1] ?? null)?.id ?? null
    }

    function askDelete(status: Status) {
        // Nothing open uses it: no question to ask. Archived tickets that do
        // are moved with it - the server refuses a delete that would strand them.
        if (using(status.id) === 0 && neighbour(status.id)) {
            void deleteStatus(status.id, neighbour(status.id))
        } else {
            setDeleting(status)
        }
    }

    return (
        <section class="status-editor" aria-label="Statuses">
            <ul class="status-editor__list" aria-label="Status order">
                <For each={statuses()} keyed={(status) => status.id}>
                    {(status, index) => (
                        <StatusRow
                            status={status()}
                            first={index() === 0}
                            last={index() === statuses().length - 1}
                            dragging={dragging() === status().id}
                            onDragStart={() => setDragging(status().id)}
                            onDragEnd={() => setDragging(null)}
                            onDropOn={() => {
                                const moved = dragging()
                                setDragging(null)
                                if (moved && moved !== status().id) void place(moved, index())
                            }}
                            onMove={(by) => void place(status().id, index() + by)}
                            onDelete={() => askDelete(status())}
                        />
                    )}
                </For>
            </ul>
            <Show when={statuses().length === 0}>
                <p class="status-editor__empty t-meta">This team has no statuses. Add one below.</p>
            </Show>

            <NewStatus teamId={props.teamId} next={() => Math.max(0, ...statuses().map((status) => status.position)) + 1} />

            <Show when={deleting()} keyed>
                {(status) => (
                    <DeleteDialog
                        status={status}
                        choices={statuses().filter((other) => other.id !== status.id && !isTempId(other.id))}
                        count={using(status.id)}
                        fallback={neighbour(status.id)}
                        onClose={() => setDeleting(null)}
                    />
                )}
            </Show>
        </section>
    )
}

type StatusRowProps = {
    status: Status
    first: boolean
    last: boolean
    dragging: boolean
    onDragStart: () => void
    onDragEnd: () => void
    onDropOn: () => void
    onMove: (by: number) => void
    onDelete: () => void
}

function StatusRow(props: StatusRowProps) {
    // The text being typed, or null while the row shows the saved name.
    const [draft, setDraft] = createSignal<string | null>(null)
    const head = () => statusHead(props.status.id)
    const name = () => draft() ?? props.status.name
    const tooLong = () => overMessage('Name', nameCount(name()))

    function commit() {
        const text = draft()?.trim()
        setDraft(null)
        if (text && text !== props.status.name && !overMessage('Name', nameCount(text))) {
            void updateStatus(props.status.id, { name: text })
        }
    }

    return (
        <li
            class="status-editor__row"
            data-dragging={props.dragging ? 'true' : undefined}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault()
                props.onDropOn()
            }}
        >
            <span
                class="status-editor__handle"
                draggable="true"
                aria-hidden="true"
                title="Drag to reorder"
                onDragStart={(event) => {
                    event.dataTransfer?.setData('text/plain', props.status.id)
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                    props.onDragStart()
                }}
                onDragEnd={() => props.onDragEnd()}
            >
                ⋮⋮
            </span>
            <StatusPill label={props.status.name} hue={hueFor(props.status.color)} active={isStarted(props.status)} />
            <form
                class="status-editor__name"
                onSubmit={(event) => {
                    event.preventDefault()
                    commit()
                }}
            >
                <Input
                    label={`Name of ${props.status.name}`}
                    hideLabel
                    value={name()}
                    onInput={setDraft}
                    onBlur={commit}
                    readOnly={!can('team:write')}
                    error={tooLong()}
                />
            </form>
            <span class="status-editor__actions">
                <MoveButtons name={props.status.name} first={props.first} last={props.last} disabledReason={denial('team:write', 'change statuses')} onMove={props.onMove} />
                <Button variant="ghost" size="sm" disabledReason={denial('team:write', 'delete statuses')} aria-label={`Delete ${props.status.name}`} onClick={() => props.onDelete()}>
                    Delete
                </Button>
            </span>
            <Show when={head()?.state === 'failed' && head()} keyed>
                {(entry) => (
                    <p class="status-editor__problem t-meta" role="alert">
                        {entry.kind === 'archive' ? 'Not deleted' : 'Not saved'}:{' '}
                        {entry.error?.errors[0]?.message ?? 'the server refused this change.'}{' '}
                        <button type="button" class="status-editor__link" onClick={() => void discard(entry.id)}>
                            Undo this change
                        </button>
                    </p>
                )}
            </Show>
        </li>
    )
}

function NewStatus(props: { teamId: string; next: () => number }) {
    const [name, setName] = createSignal('')
    const [category, setCategory] = createSignal('not_started')
    const [colour, setColour] = createSignal<string>(COLOURS[0].value)
    const tooLong = () => overMessage('Name', nameCount(name()))

    function add() {
        const text = name().trim()
        if (!text || tooLong()) return
        void createStatus({ team_id: props.teamId, name: text, color: colour(), category: category(), position: props.next() })
        setName('')
    }

    return (
        <form
            class="status-editor__new"
            aria-label="Add a status"
            onSubmit={(event) => {
                event.preventDefault()
                add()
            }}
        >
            <Input label="New status name" value={name()} onInput={setName} error={tooLong()} />
            <Select label="Category" value={category()} options={CATEGORIES} onChange={setCategory} disabled={!can('team:write')} />
            <Select label="Colour" value={colour()} options={COLOURS} onChange={setColour} disabled={!can('team:write')} />
            <Button
                type="submit"
                disabled={name().trim() === '' || tooLong() !== undefined}
                disabledReason={denial('team:write', 'add statuses')}
            >
                Add status
            </Button>
        </form>
    )
}

type DeleteDialogProps = {
    status: Status
    /** The team's other statuses: where the tickets may go. */
    choices: Status[]
    count: number
    fallback: string | null
    onClose: () => void
}

function DeleteDialog(props: DeleteDialogProps) {
    const [target, setTarget] = createSignal(untrack(() => props.fallback) ?? '')
    const none = () => props.choices.length === 0
    return (
        <Modal
            title={`Delete “${props.status.name}”`}
            consequence={
                none()
                    ? 'It is the team’s last status. It can only be deleted while no ticket exists.'
                    : `${props.count} ${props.count === 1 ? 'ticket uses' : 'tickets use'} this status. They move to the status you pick.`
            }
            confirm="Delete status"
            destructive
            onConfirm={() => {
                void deleteStatus(props.status.id, target() || null)
                props.onClose()
            }}
            onCancel={props.onClose}
        >
            <Show when={!none()}>
                <Select
                    label="Move tickets to"
                    value={target()}
                    options={props.choices.map((choice) => ({ value: choice.id, label: choice.name }))}
                    onChange={setTarget}
                />
            </Show>
        </Modal>
    )
}
