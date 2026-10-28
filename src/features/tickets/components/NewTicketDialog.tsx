import { useNavigate } from '@solidjs/router'
import { createSignal, untrack } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { createTicket, type Status } from '@/sync'

import { descriptionCount, overMessage, titleCount } from '../limits'

type NewTicketDialogProps = {
    projectId: string
    /** The project's statuses, in board order, for the picker. */
    statuses: Status[]
    /** The status a new ticket starts in: the project's first, or none. */
    statusId: string | null
    onClose: () => void
}

// Asks for what a ticket cannot do without (a title), and what is cheap to say
// now (a description, a status), writes it to the local store, and opens it.
// The write is local, so this works offline and never waits on the network:
// the ticket has a temporary id until the server answers, and its page keeps
// working across that change.
export function NewTicketDialog(props: NewTicketDialogProps) {
    const navigate = useNavigate()
    const [title, setTitle] = createSignal('')
    const [description, setDescription] = createSignal('')
    const [statusId, setStatusId] = createSignal(untrack(() => props.statusId) ?? '')
    const [saving, setSaving] = createSignal(false)

    const count = () => titleCount(title())
    // Over the limit is shown as it is typed, and the button waits: nothing
    // over the limit is queued. Nothing is cut off either.
    const tooLong = () => overMessage('Title', count())
    const descriptionTooLong = () => overMessage('Description', descriptionCount(description()))

    async function create() {
        setSaving(true)
        const ticket = await createTicket({
            project_id: props.projectId,
            title: title().trim(),
            description: description(),
            status_id: statusId() || null,
            assignee_id: null,
        })
        props.onClose()
        navigate(`/tickets/${ticket.id}`)
    }

    return (
        <Modal
            title="New ticket"
            confirm="Create ticket"
            confirmDisabled={
                saving() ||
                title().trim() === '' ||
                tooLong() !== undefined ||
                descriptionTooLong() !== undefined
            }
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <Input
                label="Title"
                value={title()}
                onInput={setTitle}
                required
                count={count()}
                error={tooLong()}
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
                    { value: '', label: 'No status' },
                    ...props.statuses.map((status) => ({ value: status.id, label: status.name })),
                ]}
                onChange={setStatusId}
            />
        </Modal>
    )
}
