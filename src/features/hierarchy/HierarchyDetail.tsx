import { useNavigate } from '@solidjs/router'
import { createMemo, createSignal, Show } from 'solid-js'

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

import { descriptionCount, nameCount, overMessage } from '../tickets/limits'
import type { Viewer } from '../tickets/viewer'
import { AddTicketsToSprint } from './AddTicketsToSprint'
import { KINDS, scopeConfig, type Kind } from './kinds'
import { progressFor, scopedTickets, ScopedTickets } from './ScopedTickets'
import './hierarchy.css'
import '../tickets/components/tickets.css'

type Row = Epic | Sprint | Milestone

const lookup = (kind: Kind, id: string): Row | undefined =>
    kind === 'epic' ? epicById(id) : kind === 'sprint' ? sprintById(id) : milestoneById(id)

// A text field that saves when focus leaves it, and shows the draft until the
// store shows what was typed (a sync landing mid-word cannot overwrite it).
function draftOf(saved: () => string) {
    const [draft, setDraft] = createSignal<string | null>(null)
    return {
        value: () => draft() ?? saved(),
        input: (value: string) => setDraft(value),
        take(): string | null {
            const value = draft()
            setDraft(null)
            return value !== null && value !== saved() ? value : null
        },
    }
}

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
    const name = draftOf(() => props.row.name)
    const description = draftOf(() => (props.kind === 'sprint' ? '' : as<Epic>().description))
    const start = draftOf(() => (props.kind === 'sprint' ? (as<Sprint>().start_date ?? '') : ''))
    const end = draftOf(() => (props.kind === 'sprint' ? (as<Sprint>().end_date ?? '') : ''))
    const target = draftOf(() => (props.kind === 'milestone' ? (as<Milestone>().target_date ?? '') : ''))

    const nameOver = () => overMessage('Name', nameCount(name.value()))
    const descriptionOver = () => overMessage('Description', descriptionCount(description.value()))
    const backwards = () =>
        props.kind === 'sprint' && start.value() !== '' && end.value() !== '' && end.value() < start.value()
            ? 'The end cannot be before the start.'
            : undefined

    // Nothing blank or over its limit is queued; the text stays in the field.
    function saveName() {
        if (nameOver() || name.value().trim() === '') return
        const value = name.take()
        if (value === null) return
        const text = value.trim()
        if (text === props.row.name) return
        write({ name: text })
    }
    function saveDescription() {
        if (descriptionOver()) return
        const value = description.take()
        if (value !== null) write({ description: value })
    }
    function saveDates() {
        if (backwards()) return
        const from = start.take()
        const to = end.take()
        if (from !== null) write({ start_date: from || null })
        if (to !== null) write({ end_date: to || null })
    }
    function saveTarget() {
        const value = target.take()
        if (value !== null) write({ target_date: value || null })
    }
    function write(patch: Record<string, string | null>) {
        if (props.kind === 'epic') void updateEpic(id(), patch)
        else if (props.kind === 'sprint') void updateSprint(id(), patch)
        else void updateMilestone(id(), patch)
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
                <progress
                    class="hierarchy__bar"
                    max={Math.max(progress().total, 1)}
                    value={progress().done}
                    aria-label={`Progress of ${props.row.name}`}
                />
                <span class="t-meta">
                    {progress().total === 0
                        ? 'No tickets yet'
                        : `${progress().done} of ${progress().total} ${progress().total === 1 ? 'ticket' : 'tickets'} done (${progress().percent}%)`}
                </span>
            </div>

            <div class="hierarchy__fields">
                <Input label="Name" value={name.value()} onInput={name.input} onBlur={saveName} count={nameCount(name.value())} error={nameOver()} />
                <Show when={props.kind === 'sprint'}>
                    <Input label="Start date" type="date" value={start.value()} onInput={start.input} onBlur={saveDates} />
                    <Input label="End date" type="date" value={end.value()} onInput={end.input} onBlur={saveDates} error={backwards()} />
                </Show>
                <Show when={props.kind === 'milestone'}>
                    <Input label="Target date" type="date" value={target.value()} onInput={target.input} onBlur={saveTarget} />
                </Show>
            </div>
            <Show when={props.kind !== 'sprint'}>
                <TextArea
                    label="Description"
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
                <Button variant="danger" onClick={() => setDeleting(true)}>
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
