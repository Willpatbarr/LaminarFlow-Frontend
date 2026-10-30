import { createEffect, createSignal, Show } from 'solid-js'

import { Toast } from '@/components/ui/Toast'
import { sync } from '@/sync'

/** `open` is the dialog's own way in: it closes itself, then goes to the ticket. */
type Created = { title: string; open: () => void }

// The last ticket made with "Create more" on, so the dialog that stayed open
// can say what it just did and offer a way to the ticket. One at a time:
// making another replaces it. Module level because the dialog and the shell's
// toast area are in different parts of the tree.
const [created, setCreated] = createSignal<Created | null>(null)

export const announceCreated = (ticket: Created) => setCreated(ticket)
export const clearCreatedTicket = () => setCreated(null)

// "Created “Title”" with a way to open it. Polite (role status), no timer and
// no focus movement, as with every toast here: the dialog under it is still
// being typed in.
export function CreatedTicketToast() {
    createEffect(
        () => sync.active,
        (active) => {
            if (!active) clearCreatedTicket()
        },
    )
    return (
        <Show when={created()}>
            {(ticket) => (
                <Toast
                    hue="blue"
                    mark="check"
                    title={`Created “${ticket().title}”`}
                    action="Open ticket"
                    onAction={() => {
                        const open = ticket().open
                        clearCreatedTicket()
                        open()
                    }}
                    onDismiss={clearCreatedTicket}
                />
            )}
        </Show>
    )
}
