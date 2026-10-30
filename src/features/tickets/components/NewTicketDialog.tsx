import { useNavigate } from '@solidjs/router'
import { createSignal, onCleanup, Show, untrack } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { keysOf } from '@/features/shortcuts'
import { createTicket, type Status } from '@/sync'

import { descriptionCount, overMessage, titleCount } from '../limits'
import { announceCreated } from './CreatedTicketToast'

type NewTicketDialogProps = {
    projectId: string
    /** The project's statuses, in board order, for the picker. */
    statuses: Status[]
    /** The status a new ticket starts in: the project's first, or none. */
    statusId: string | null
    onClose: () => void
}

/** Per device, like the theme: whether the dialog stays open after creating. */
export const CREATE_MORE_KEY = 'lf-create-more'

function readCreateMore(): boolean {
    try {
        return localStorage.getItem(CREATE_MORE_KEY) === 'on'
    } catch {
        return false
    }
}

function saveCreateMore(on: boolean) {
    try {
        localStorage.setItem(CREATE_MORE_KEY, on ? 'on' : 'off')
    } catch {
        // Storage unavailable: the choice lasts until the dialog closes.
    }
}

// Asks for what a ticket cannot do without (a title), and what is cheap to say
// now (a description, a status), writes it to the local store, and opens it,
// or, with "Create more" on, stays open for the next one.
// The write is local, so this works offline and never waits on the network:
// the ticket has a temporary id until the server answers, and its page keeps
// working across that change.
//
// Enter in the title and Cmd/Ctrl+Enter anywhere create it; Enter in the
// description stays a new line. A ticket can have no status (the column is
// nullable, and deleting a status leaves its tickets without one), so that
// choice stays, named for what it does.
export function NewTicketDialog(props: NewTicketDialogProps) {
    const navigate = useNavigate()
    const [title, setTitle] = createSignal('')
    const [description, setDescription] = createSignal('')
    const [statusId, setStatusId] = createSignal(untrack(() => props.statusId) ?? '')
    const [saving, setSaving] = createSignal(false)
    const [more, setMore] = createSignal(readCreateMore())
    // The last ticket made while the dialog stayed open. Said inside the
    // dialog, which has the focus and covers the corner toasts; handed to the
    // toast when the dialog closes, so the way to it is not lost.
    const [last, setLast] = createSignal<{ title: string; id: string } | null>(null)
    let opened = false
    let titleField: HTMLInputElement | undefined
    // The guard against a second create while one is under way. A plain flag,
    // not the `saving` signal: Solid batches a write, so two Enters in the same
    // moment would both still read "not saving".
    let busy = false

    const count = () => titleCount(title())
    // Over the limit is shown as it is typed, and the button waits: nothing
    // over the limit is queued. Nothing is cut off either.
    const tooLong = () => overMessage('Title', count())
    const descriptionTooLong = () => overMessage('Description', descriptionCount(description()))
    const cannotCreate = () =>
        saving() || title().trim() === '' || tooLong() !== undefined || descriptionTooLong() !== undefined

    async function create() {
        if (busy || cannotCreate()) return
        busy = true
        setSaving(true)
        try {
            const made = title().trim()
            const ticket = await createTicket({
                project_id: props.projectId,
                title: made,
                description: description(),
                status_id: statusId() || null,
                assignee_id: null,
            })
            if (more()) {
                // Status stays for the next one; the words do not.
                setTitle('')
                setDescription('')
                setLast({ title: made, id: ticket.id })
                titleField?.focus()
            } else {
                props.onClose()
                navigate(`/tickets/${ticket.id}`)
            }
        } finally {
            busy = false
            setSaving(false)
        }
    }

    onCleanup(() => {
        const made = last()
        if (made && !opened) announceCreated({ title: made.title, open: () => navigate(`/tickets/${made.id}`) })
    })

    function onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Enter' || event.isComposing) return
        const chord = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
        const inTitle = event.target === titleField && !event.metaKey && !event.ctrlKey
        // Anything else (Enter in the description, on a button) is the
        // control's own.
        if (!chord && !inTitle) return
        event.preventDefault()
        void create()
    }

    return (
        <Modal
            title="New ticket"
            confirm="Create ticket"
            confirmHint={keysOf('ticket.create')}
            confirmKeys="Control+Enter Meta+Enter"
            confirmDisabled={cannotCreate()}
            onKeyDown={onKeyDown}
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <>
                <Input
                    label="Title"
                    value={title()}
                    onInput={setTitle}
                    required
                    count={count()}
                    error={tooLong()}
                    ref={(el) => {
                        titleField = el
                    }}
                />
                <TextArea
                    label="Description"
                    value={description()}
                    onInput={setDescription}
                    rows={4}
                    count={descriptionCount(description())}
                    error={descriptionTooLong()}
                />
                <Select
                    label="Status"
                    value={statusId()}
                    options={[
                        ...props.statuses.map((status) => ({
                            value: status.id,
                            label: status.name,
                        })),
                        { value: '', label: 'No status (set one later)' },
                    ]}
                    onChange={setStatusId}
                />
                <label class="new-ticket__more t-body">
                    <input
                        type="checkbox"
                        checked={more()}
                        onChange={(event) => {
                            setMore(event.currentTarget.checked)
                            saveCreateMore(event.currentTarget.checked)
                        }}
                    />{' '}
                    Create more
                </label>
                <p class="new-ticket__created t-meta" role="status">
                    <Show when={last()}>
                        {(made) => (
                            <>
                                Created “{made().title}”{' '}
                                <button
                                    type="button"
                                    class="new-ticket__open"
                                    onClick={() => {
                                        opened = true
                                        props.onClose()
                                        navigate(`/tickets/${made().id}`)
                                    }}
                                >
                                    Open ticket
                                </button>
                            </>
                        )}
                    </Show>
                </p>
            </>
        </Modal>
    )
}
