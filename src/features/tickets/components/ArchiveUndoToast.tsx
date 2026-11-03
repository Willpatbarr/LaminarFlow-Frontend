import { createEffect, createSignal, Show } from 'solid-js'

import { Toast } from '@/components/ui/Toast'
import { archiveTicket, sync, unarchiveTicket, type Ticket } from '@/sync'

// The last ticket archived from this screen, as it was, so Undo can bring it
// back. One at a time: archiving another replaces the offer, because the toast
// says which ticket it is about and two stacked toasts would be two things to
// read. It lives at module level because the archive is often made on a page
// (the ticket's own) that is left a moment later.
const [archivedTicket, setArchivedTicket] = createSignal<Ticket | null>(null)

/** Archives through the outbox and offers to undo it. Resolves false if there
 *  was no such ticket. */
export async function archiveWithUndo(ticket: Ticket): Promise<boolean> {
    // A plain copy: the store's row changes under a held reference.
    const snapshot = { ...ticket }
    const found = await archiveTicket(ticket.id)
    if (found) setArchivedTicket(snapshot)
    return found
}

/** For tests, and for sign-out. */
export function clearArchiveUndo() {
    setArchivedTicket(null)
}

// "Archived “Title”" with an Undo. Undo is an unarchive entry in the outbox
// (or the withdrawal of the archive, if it has not been sent), so it works
// offline and in the same order as everything else the user did.
//
// No timer, as with every toast here: it stays until it is dismissed, used or
// replaced.
export function ArchiveUndoToast() {
    // Another account's ticket must never be offered after signing out.
    createEffect(
        () => sync.active,
        (active) => {
            if (!active) clearArchiveUndo()
        },
    )

    async function undo() {
        const ticket = archivedTicket()
        if (!ticket) return
        setArchivedTicket(null)
        await unarchiveTicket(ticket)
    }

    return (
        <Show when={archivedTicket()}>
            {(ticket) => (
                <Toast
                    hue="blue"
                    title={`Archived “${ticket().title || 'Untitled'}”`}
                    detail="It has left the list for everyone."
                    action="Undo"
                    onAction={() => void undo()}
                    onDismiss={clearArchiveUndo}
                />
            )}
        </Show>
    )
}
