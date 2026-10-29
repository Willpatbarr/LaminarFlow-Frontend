/*
┌─ sync ──────────────────────────────────────────
│  ticket-document link events off the change feed (LAM-120)
├─ out ───────────────────────────────────────────
│      LinkEvent                        { linked, ticketId, documentId }
│      onLinkEvent(fn) → off            hear every link made or removed anywhere
│      publishLinkFrame(frame)          for the socket: reads a frame, tells the listeners
*/
// A link is neither a ticket's nor a document's version, so these two events
// are not rows and do not go through the engine: they carry ids only
// (`ticket.document_linked` / `ticket.document_unlinked`). The screens that
// show links listen here and ask the server for the list again, which is
// always right, rather than patching what they hold.

export type LinkEvent = { linked: boolean; ticketId: string; documentId: string }

const listeners = new Set<(event: LinkEvent) => void>()

export function onLinkEvent(fn: (event: LinkEvent) => void): () => void {
    listeners.add(fn)
    return () => {
        listeners.delete(fn)
    }
}

/** Reads one change-feed frame; does nothing for any other kind. Never throws. */
export function publishLinkFrame(frame: unknown): void {
    if (typeof frame !== 'object' || frame === null) return
    const { type, ticket_id: ticketId, document_id: documentId } = frame as Record<string, unknown>
    if (type !== 'ticket.document_linked' && type !== 'ticket.document_unlinked') return
    if (typeof ticketId !== 'string' || typeof documentId !== 'string') return
    for (const fn of [...listeners]) {
        try {
            fn({ linked: type === 'ticket.document_linked', ticketId, documentId })
        } catch (error) {
            console.error('a link listener failed', error)
        }
    }
}
