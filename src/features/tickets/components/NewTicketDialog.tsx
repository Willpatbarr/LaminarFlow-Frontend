import { useNavigate } from '@solidjs/router'
import { createSignal } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createTicket } from '@/sync'

type NewTicketDialogProps = {
    projectId: string
    /** The status a new ticket starts in: the project's first, or none. */
    statusId: string | null
    onClose: () => void
}

// Asks for the one thing a ticket cannot do without, writes it to the local
// store, and opens it. The write is local, so this works offline and never
// waits on the network: the ticket has a temporary id until the server answers,
// and its page keeps working across that change.
export function NewTicketDialog(props: NewTicketDialogProps) {
    const navigate = useNavigate()
    const [title, setTitle] = createSignal('')
    const [saving, setSaving] = createSignal(false)

    async function create() {
        setSaving(true)
        const ticket = await createTicket({
            project_id: props.projectId,
            title: title().trim(),
            description: '',
            status_id: props.statusId,
            assignee_id: null,
        })
        props.onClose()
        navigate(`/tickets/${ticket.id}`)
    }

    return (
        <Modal
            title="New ticket"
            confirm="Create ticket"
            confirmDisabled={saving() || title().trim() === ''}
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <Input label="Title" value={title()} onInput={setTitle} required />
        </Modal>
    )
}
