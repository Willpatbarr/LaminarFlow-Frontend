import { useNavigate } from '@solidjs/router'
import {
    createEffect,
    createMemo,
    createSignal,
    createUniqueId,
    Match,
    Show,
    Switch,
    untrack,
} from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import {
    archiveTicket,
    discard,
    isLoading,
    resolveTicketId,
    statusesForProject,
    ticketById,
    ticketHead,
    ticketSyncState,
    updateTicket,
    type Ticket,
} from '@/sync'

import { describeFailure } from '../entryFailure'
import type { Viewer } from '../viewer'
import { SyncMarker } from './SyncMarker'
import { TicketsPending } from './TicketsPending'
import './tickets.css'

type TicketDetailProps = {
    /** From the URL. May be a temporary id, or one that has since been replaced. */
    id: string
    viewer: Viewer
    /** Force the placeholder. See TicketList. */
    loading?: boolean
}

// The ticket page at /tickets/:id.
//
// A ticket created offline is opened under a temporary id. When the server
// answers, the store renames the row in place and remembers old -> new, so
// `ticketById` keeps returning the SAME row for either id: nothing here
// re-mounts, a field being typed in keeps its focus and its text, and the only
// visible change is the address bar, which is replaced (not pushed) below.
export function TicketDetail(props: TicketDetailProps) {
    const navigate = useNavigate()
    const ticket = createMemo(() => ticketById(props.id))

    createEffect(
        () => resolveTicketId(props.id),
        (resolved) => {
            if (resolved !== untrack(() => props.id)) {
                navigate(`/tickets/${resolved}`, { replace: true })
            }
        },
    )

    return (
        <section class="tickets ticket">
            <p class="t-meta">
                <a href="/">← Tickets</a>
            </p>
            <Switch
                fallback={
                    <>
                        <h1 class="t-screen-title">Ticket not found</h1>
                        <p class="t-body">
                            It may have been archived, or the address may be wrong.
                        </p>
                    </>
                }
            >
                <Match when={props.loading || isLoading()}>
                    <TicketsPending />
                </Match>
                <Match when={ticket()}>
                    {(found) => <TicketEditor ticket={found()} viewer={props.viewer} />}
                </Match>
            </Switch>
        </section>
    )
}

// A text field that saves when focus leaves it. While the user is typing, the
// field shows their draft and ignores the store, so a sync landing mid-word
// cannot overwrite it; once the store shows what was typed, the draft is
// dropped and the field follows the store again.
function createDraft(saved: () => string, save: (value: string) => Promise<unknown>) {
    const [draft, setDraft] = createSignal<string | null>(null)
    return {
        value: () => draft() ?? saved(),
        input: (value: string) => {
            setDraft(value)
        },
        async commit() {
            const value = draft()
            if (value === null) return
            if (value !== saved()) await save(value)
            // Unless they have started typing again in the meantime.
            if (draft() === value) setDraft(null)
        },
        reset: () => {
            setDraft(null)
        },
    }
}

type TicketEditorProps = {
    ticket: Ticket
    viewer: Viewer
}

// HOW IT SAVES: there is no Save button. Title and description save when focus
// leaves the field (and the title also on Enter); status and assignee save the
// moment they change. Every save is a write to the local store, so it never
// waits and never fails here - what the server makes of it shows in the marker.
//
// WHEN THE SERVER REFUSES IT (422, 403, 404 ...): the entry is parked as
// `failed` and this page says so, at the field when the server named one. The
// text on screen is still the user's - the row is the server's copy with their
// entry replayed on top - and editing a field and leaving it folds the new
// value into that same entry and sends it again (the engine's `updateTicket`
// does that for a failed head), so there is nothing here to "reopen".
function TicketEditor(props: TicketEditorProps) {
    const navigate = useNavigate()
    const [confirmingArchive, setConfirmingArchive] = createSignal(false)
    const assigneeLabelId = createUniqueId()

    const id = () => props.ticket.id
    const statuses = createMemo(() => statusesForProject(props.ticket.project_id))

    const title = createDraft(
        () => props.ticket.title,
        (value) => updateTicket(id(), { title: value.trim() }),
    )
    const description = createDraft(
        () => props.ticket.description,
        (value) => updateTicket(id(), { description: value }),
    )

    function commitTitle() {
        // A ticket with no title is a row nobody can find again: put the old
        // one back instead of saving the blank.
        if (title.value().trim() === '') title.reset()
        else void title.commit()
    }

    const statusOptions = () => {
        const options = statuses().map((status) => ({ value: status.id, label: status.name }))
        // A status this team no longer has is still the ticket's until someone
        // changes it; without its own option the select would show a lie.
        const current = props.ticket.status_id
        if (current && !options.some((option) => option.value === current)) {
            options.push({ value: current, label: 'Unknown status' })
        }
        return [{ value: '', label: 'No status' }, ...options]
    }

    // The refusal, if the head of this ticket's queue is one. Read through the
    // store so it appears and goes as the engine parks and unparks the entry.
    const refused = createMemo(() => {
        const head = ticketHead(id())
        return head?.state === 'failed' && head.error
            ? { entryId: head.id, ...describeFailure(head.error) }
            : null
    })

    const assignedToMe = () => props.ticket.assignee_id === props.viewer.accountId
    const assignedElsewhere = () => props.ticket.assignee_id !== null && !assignedToMe()

    function archive() {
        // Leave first: the row disappears the moment it is archived, and this
        // page would show "not found" for a frame on the way out.
        const archiving = id()
        setConfirmingArchive(false)
        navigate('/')
        void archiveTicket(archiving)
    }

    return (
        <form
            class="ticket__form"
            onSubmit={(event) => {
                // Enter in the title: save it, do not reload the page.
                event.preventDefault()
                commitTitle()
            }}
        >
            <div class="ticket__status-line" role="status">
                <SyncMarker state={ticketSyncState(id())} withText />
            </div>

            <Show when={refused()}>
                {(failure) => (
                    <div class="ticket__failure" role="alert">
                        <Show
                            when={failure().fieldShaped}
                            fallback={<p class="t-body">{failure().form}</p>}
                        >
                            <p class="t-body">
                                The server didn't accept this change. Fix the marked field and
                                it will send again.
                            </p>
                            <Show when={failure().form}>
                                <p class="t-meta">{failure().form}</p>
                            </Show>
                        </Show>
                        <div>
                            <Button variant="secondary" onClick={() => void discard(failure().entryId)}>
                                Discard my change
                            </Button>
                        </div>
                    </div>
                )}
            </Show>

            <Input
                label="Title"
                value={title.value()}
                onInput={title.input}
                onBlur={commitTitle}
                error={refused()?.fields.title}
            />

            <TextArea
                label="Description"
                value={description.value()}
                onInput={description.input}
                onBlur={() => void description.commit()}
                error={refused()?.fields.description}
            />

            <div class="ticket__row">
                <Select
                    label="Status"
                    value={props.ticket.status_id ?? ''}
                    options={statusOptions()}
                    onChange={(value) => void updateTicket(id(), { status_id: value || null })}
                    error={refused()?.fields.status}
                />

                <div class="input">
                    <span class="input__label t-body" id={assigneeLabelId}>
                        Assignee
                    </span>
                    <div class="ticket__assignee" role="group" aria-labelledby={assigneeLabelId}>
                        <Show
                            when={!assignedElsewhere()}
                            fallback={<span class="t-body">Someone else</span>}
                        >
                            <span class="t-body">{assignedToMe() ? 'You' : 'Unassigned'}</span>
                            <Button
                                variant="secondary"
                                onClick={() =>
                                    void updateTicket(id(), {
                                        assignee_id: assignedToMe() ? null : props.viewer.accountId,
                                    })
                                }
                            >
                                {assignedToMe() ? 'Unassign' : 'Assign to me'}
                            </Button>
                        </Show>
                    </div>
                    <Show when={refused()?.fields.assignee}>
                        <span class="input__error t-meta">{refused()?.fields.assignee}</span>
                    </Show>
                </div>
            </div>

            <p class="t-meta ticket__hint">Changes are saved as you make them.</p>

            <div class="ticket__danger">
                <Button variant="danger" onClick={() => setConfirmingArchive(true)}>
                    Archive ticket
                </Button>
            </div>

            <Show when={confirmingArchive()}>
                <Modal
                    title={`Archive “${props.ticket.title || 'Untitled'}”?`}
                    consequence="It leaves the list for everyone. Its comments are kept."
                    confirm="Archive"
                    destructive
                    onConfirm={archive}
                    onCancel={() => setConfirmingArchive(false)}
                />
            </Show>
        </form>
    )
}
