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
    isLoading,
    resolveTicketId,
    statusesForProject,
    ticketById,
    ticketSyncState,
    updateTicket,
    type Ticket,
} from '@/sync'

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

            <Input label="Title" value={title.value()} onInput={title.input} onBlur={commitTitle} />

            <TextArea
                label="Description"
                value={description.value()}
                onInput={description.input}
                onBlur={() => void description.commit()}
            />

            <div class="ticket__row">
                <Select
                    label="Status"
                    value={props.ticket.status_id ?? ''}
                    options={statusOptions()}
                    onChange={(value) => void updateTicket(id(), { status_id: value || null })}
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
