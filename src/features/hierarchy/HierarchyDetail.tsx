import { useNavigate } from '@solidjs/router'
import { createMemo, createSignal, Show } from 'solid-js'

import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { TextArea } from '@/components/ui/TextArea'
import { session } from '@/features/auth'
import {
    deleteEpic,
    deleteMilestone,
    deleteSprint,
    discard,
    epicById,
    epicHead,
    isLoading,
    resolveId,
    milestoneById,
    milestoneHead,
    sprintById,
    sprintHead,
    updateEpic,
    updateMilestone,
    updateSprint,
    type Epic,
    type Milestone,
    type Sprint,
} from '@/sync'

import { createAutosave } from '../documents/autosave'
import { descriptionCount, nameCount, overMessage } from '../tickets/limits'
import type { Viewer } from '../tickets/viewer'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { AddTicketsToSprint } from './AddTicketsToSprint'
import { KINDS, scopeConfig, type Kind } from './kinds'
import { progressFor, scopedTickets, ScopedTickets } from './ScopedTickets'
import './hierarchy.css'
import '../tickets/components/tickets.css'

type Row = Epic | Sprint | Milestone

// A new row's temporary id and its real id are the same row, so the server's
// answer mid-edit does not flush the draft early (as TicketDetail does).
const sameRow = (a: string, b: string) => resolveId(a) === resolveId(b)

const lookup = (kind: Kind, id: string): Row | undefined =>
    kind === 'epic' ? epicById(id) : kind === 'sprint' ? sprintById(id) : milestoneById(id)

// /epics/:id, /sprints/:id, /milestones/:id: the item's fields, how far along
// its tickets are, and the tickets themselves. Every edit is a write to the
// local store, so it is as offline-proof as a ticket edit.
export function HierarchyDetail(props: { kind: Kind; id: string; viewer: Viewer }) {
    const busy = () => session.status === 'unknown' || isLoading()
    const row = createMemo(() => lookup(props.kind, props.id))
    return (
        <section class="tickets" aria-busy={busy() ? 'true' : undefined}>
            <p class="t-meta">
                <a href={KINDS[props.kind].path}>← {KINDS[props.kind].plural[0].toUpperCase() + KINDS[props.kind].plural.slice(1)}</a>
            </p>
            <Show
                when={row()}
                fallback={
                    <Show
                        when={busy()}
                        fallback={
                            <>
                                <h1 class="t-screen-title">Not found</h1>
                                <p class="t-body">
                                    This {KINDS[props.kind].singular} may have been deleted, or the address may be wrong.
                                </p>
                            </>
                        }
                    >
                        <p class="visually-hidden" role="status">
                            Loading…
                        </p>
                    </Show>
                }
            >
                {(found) => <Loaded kind={props.kind} row={found()} viewer={props.viewer} />}
            </Show>
        </section>
    )
}

function Loaded(props: { kind: Kind; row: Row; viewer: Viewer }) {
    const navigate = useNavigate()
    const info = () => KINDS[props.kind]
    const id = () => props.row.id
    const [deleting, setDeleting] = createSignal(false)
    const projectId = () => props.row.project_id

    const config = createMemo(() => scopeConfig(props.kind, id()))
    const tickets = scopedTickets(projectId, config)
    const progress = () => progressFor(projectId(), tickets())

    const head = () => (props.kind === 'epic' ? epicHead(id()) : props.kind === 'sprint' ? sprintHead(id()) : milestoneHead(id()))
    const failed = () => {
        const entry = head()
        return entry?.state === 'failed' ? entry : undefined
    }

    const as = <T extends Row>() => props.row as T
    // The name and description save while typing (about a second after the last
    // key), on blur, on leaving the page and on closing the tab. `context.base` is
    // the version the edit began from; `context.key` the row it began on.
    const name = createAutosave(
        () => props.row.name,
        (value, context) => write({ name: value.trim() }, context.key),
        {
            delay: 1000,
            base: () => props.row.version,
            key: id,
            same: sameRow,
            canSave: (value) => value.trim() !== '' && !overMessage('Name', nameCount(value)),
        },
    )
    const description = createAutosave(
        () => (props.kind === 'sprint' ? '' : as<Epic>().description),
        (value, context) => write({ description: value }, context.key),
        {
            delay: 1000,
            base: () => props.row.version,
            key: id,
            same: sameRow,
            canSave: (value) => !overMessage('Description', descriptionCount(value)),
        },
    )
    // Dates save like the text fields: about a second after the last change, not
    // on every valid value typing passes through (0002-, 0020-, 0202-, 2026-).
    // A range that ends before it starts is never saved.
    const date = (saved: () => string, field: string, canSave: (value: string) => boolean = () => true) =>
        createAutosave(saved, (value, context) => write({ [field]: value || null }, context.key), {
            delay: 1000,
            base: () => props.row.version,
            key: id,
            same: sameRow,
            canSave,
        })
    const start = date(
        () => (props.kind === 'sprint' ? (as<Sprint>().start_date ?? '') : ''),
        'start_date',
        (value) => value === '' || end.value() === '' || end.value() >= value,
    )
    const end = date(
        () => (props.kind === 'sprint' ? (as<Sprint>().end_date ?? '') : ''),
        'end_date',
        (value) => value === '' || start.value() === '' || value >= start.value(),
    )
    const target = date(() => (props.kind === 'milestone' ? (as<Milestone>().target_date ?? '') : ''), 'target_date')

    const nameOver = () => overMessage('Name', nameCount(name.value()))
    const descriptionOver = () => overMessage('Description', descriptionCount(description.value()))
    const backwards = () =>
        props.kind === 'sprint' && start.value() !== '' && end.value() !== '' && end.value() < start.value()
            ? 'The end cannot be before the start.'
            : undefined

    // Nothing blank or over its limit is queued; the text stays in the field.
    function saveName() {
        void name.flush()
    }
    function saveDescription() {
        void description.flush()
    }
    const saveDates = () => {
        void start.flush()
        void end.flush()
    }
    const saveTarget = () => void target.flush()
    function write(patch: Record<string, string | null>, rowId: string | null = null) {
        const target = rowId ?? id()
        if (props.kind === 'epic') return updateEpic(target, patch)
        if (props.kind === 'sprint') return updateSprint(target, patch)
        return updateMilestone(target, patch)
    }

    async function remove() {
        setDeleting(false)
        if (props.kind === 'epic') await deleteEpic(id())
        else if (props.kind === 'sprint') await deleteSprint(id())
        else await deleteMilestone(id())
        navigate(info().path)
    }

    return (
        <>
            <h1 class="t-screen-title">{props.row.name}</h1>

            <div class="hierarchy__progress">
                <ProgressBar
                    done={progress().done}
                    total={progress().total}
                    label={`Progress of ${props.row.name}`}
                    valueText={`${progress().done} of ${progress().total} ${progress().total === 1 ? 'ticket' : 'tickets'} done`}
                />
                <span class="t-meta">
                    {progress().total === 0
                        ? 'No tickets yet'
                        : `${progress().done} of ${progress().total} ${progress().total === 1 ? 'ticket' : 'tickets'} done (${progress().percent}%)`}
                </span>
            </div>

            <div class="hierarchy__fields">
                <Input label="Name" readOnly={!can('ticket:write')} value={name.value()} onInput={name.input} onBlur={saveName} count={nameCount(name.value())} error={nameOver()} />
                <Show when={props.kind === 'sprint'}>
                    <Input label="Start date" readOnly={!can('ticket:write')} type="date" value={start.value()} onInput={start.input} onBlur={saveDates} />
                    <Input label="End date" readOnly={!can('ticket:write')} type="date" value={end.value()} onInput={end.input} onBlur={saveDates} error={backwards()} />
                </Show>
                <Show when={props.kind === 'milestone'}>
                    <Input label="Target date" readOnly={!can('ticket:write')} type="date" value={target.value()} onInput={target.input} onBlur={saveTarget} />
                </Show>
            </div>
            <Show when={props.kind !== 'sprint'}>
                <TextArea
                    label="Description"
                    readOnly={!can('ticket:write')}
                    value={description.value()}
                    onInput={description.input}
                    onBlur={saveDescription}
                    rows={4}
                    count={descriptionCount(description.value())}
                    error={descriptionOver()}
                />
            </Show>

            <Show when={failed()} keyed>
                {(entry) => (
                    <p class="hierarchy__problem t-meta" role="alert">
                        Not saved: {entry.error?.errors[0]?.message ?? 'the server refused this change.'}{' '}
                        <button type="button" class="status-editor__link" onClick={() => void discard(entry.id)}>
                            Undo this change
                        </button>
                    </p>
                )}
            </Show>

            <Show when={props.kind === 'sprint'}>
                <AddTicketsToSprint sprintId={id()} projectId={projectId()} />
            </Show>

            <h2 class="t-section">Tickets</h2>
            <ScopedTickets
                projectId={projectId()}
                tickets={tickets()}
                config={config()}
                viewer={props.viewer}
                empty={`No tickets are in this ${info().singular}.`}
            />

            <div>
                <Button variant="danger" disabledReason={denial('ticket:write', 'delete this')} onClick={() => setDeleting(true)}>
                    Delete {info().singular}
                </Button>
            </div>
            <Show when={deleting()}>
                <Modal
                    title={`Delete “${props.row.name}”?`}
                    consequence={
                        tickets().length === 0
                            ? `No ticket is in this ${info().singular}.`
                            : `${tickets().length} ${tickets().length === 1 ? 'ticket stays' : 'tickets stay'}, ${props.kind === 'sprint' ? 'no longer in this sprint' : `with no ${info().singular}`}. Nothing else is touched.`
                    }
                    confirm={`Delete ${info().singular}`}
                    destructive
                    onConfirm={() => void remove()}
                    onCancel={() => setDeleting(false)}
                />
            </Show>
        </>
    )
}
