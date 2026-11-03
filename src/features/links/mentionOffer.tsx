import { createEffect, createSignal, Show } from 'solid-js'

import type { LinkRef } from '@/components/editor/internalLinks'
import { Toast } from '@/components/ui/Toast'
import { sync, ticketById } from '@/sync'

/*
┌─ links ─────────────────────────────────────────
│  "Also link this ticket?" after a ticket is mentioned with @ in a document (LAM-225)
├─ out ───────────────────────────────────────────
│      offerTicketLink(documentId)   → (ref) => void, for the editor's onMention
│      registerDocumentLinks(documentId, links)   the Tickets section says what it holds and how to link
│      MentionLinkToast              the toast, mounted once in the shell
│      clearMentionOffer()           for tests and sign-out
*/
// A mention is not a link, and stays one unless the user says yes. The offer is
// a toast, not a line under the text: it must not move the text being typed in,
// and the toast area already keeps a stack, an overflow and a place for
// "stays until dismissed" (LAM-217). Its merge key is the document: every ticket
// mentioned meanwhile joins the one toast ("Also link these 3 tickets?"), so a
// run of mentions never stacks a toast per ticket.
//
// "Link" goes through the Tickets section's own link function, so the section
// updates at once and the ticket's Documents section follows the link event, as
// with the "Link a ticket" button. The offer belongs to the open document: when
// its Tickets section goes away, so does the offer.

/** What the Tickets section lends the offer. */
export type DocumentLinks = {
    /** Whether this ticket is linked (or is being linked) right now. */
    has: (ticketId: string) => boolean
    /** Links it as the button does. Answers '' on success, or the reason it did not. */
    link: (ticketId: string) => Promise<string>
}

const sections = new Map<string, DocumentLinks>()

type Offer = { documentId: string; ticketIds: string[]; problem: string; busy: boolean }
const [offer, setOffer] = createSignal<Offer | null>(null, { ownedWrite: true })

/** Called by the Tickets section while it is on screen. Returns how to stop. */
export function registerDocumentLinks(documentId: string, links: DocumentLinks): () => void {
    sections.set(documentId, links)
    return () => {
        if (sections.get(documentId) === links) sections.delete(documentId)
        if (offer()?.documentId === documentId) setOffer(null)
    }
}

export function clearMentionOffer() {
    setOffer(null)
}

/** The editor's `onMention` for a document: offers to link a mentioned ticket. */
export function offerTicketLink(documentId: string) {
    return (ref: LinkRef) => {
        // Documents and projects stay mentions.
        if (ref.kind !== 'ticket') return
        const id = documentId
        const section = sections.get(id)
        // Without the section there is nothing to link through, and nothing to say it is already linked.
        if (!section || section.has(ref.id)) return
        setOffer((current) => {
            if (current?.documentId !== id) return { documentId: id, ticketIds: [ref.id], problem: '', busy: false }
            if (current.ticketIds.includes(ref.id)) return { ...current, problem: '' }
            return { ...current, ticketIds: [...current.ticketIds, ref.id], problem: '' }
        })
    }
}

async function accept() {
    const open = offer()
    if (!open || open.busy) return
    const section = sections.get(open.documentId)
    if (!section) return setOffer(null)
    setOffer({ ...open, busy: true, problem: '' })
    const failed: string[] = []
    let problem = ''
    for (const id of open.ticketIds) {
        // Linked meanwhile (by the button, or by a mention made twice): nothing to say.
        if (section.has(id)) continue
        const why = await section.link(id)
        if (why) {
            failed.push(id)
            problem = why
        }
    }
    // The offer may have been dismissed, or the page left, while this was sent.
    const now = offer()
    if (!now || now.documentId !== open.documentId) return
    setOffer(failed.length === 0 ? null : { ...now, ticketIds: failed, problem, busy: false })
}

const titleOf = (id: string) => ticketById(id)?.title.trim() || 'Untitled'

export function MentionLinkToast() {
    createEffect(
        () => sync.active,
        (active) => {
            if (!active) clearMentionOffer()
        },
    )
    return (
        <Show when={offer()}>
            {(open) => {
                const many = () => open().ticketIds.length > 1
                const names = () => open().ticketIds.map(titleOf).join(', ')
                return (
                    <Show
                        when={open().problem}
                        fallback={
                            <Toast
                                hue="amber"
                                mark="check"
                                title={many() ? `Also link these ${open().ticketIds.length} tickets?` : 'Also link this ticket?'}
                                detail={names()}
                                action={open().busy ? 'Linking…' : 'Link'}
                                onAction={() => void accept()}
                                secondary="Not now"
                                onSecondary={clearMentionOffer}
                                onDismiss={clearMentionOffer}
                            />
                        }
                    >
                        <Toast
                            hue="amber"
                            role="alert"
                            title={many() ? 'Could not link these tickets.' : 'Could not link this ticket.'}
                            detail={`${open().problem} The mention is still in the text.`}
                            action="Try again"
                            onAction={() => void accept()}
                            secondary="Not now"
                            onSecondary={clearMentionOffer}
                            onDismiss={clearMentionOffer}
                        />
                    </Show>
                )
            }}
        </Show>
    )
}
