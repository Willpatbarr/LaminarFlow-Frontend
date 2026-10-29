import { createMemo, createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { sync, ticketById } from '@/sync'

import { getDocumentTickets, linkDocument, unlinkDocument, type LinkedTicket } from './api'
import { createLinkFeed } from './feed'
import { LinkPicker, type PickOption } from './LinkPicker'
import { settledId } from './settled'
import './links.css'

/*
┌─ links ─────────────────────────────────────────
│  LinkedTickets: the "Tickets" section of the document page (LAM-120)
├─ out ───────────────────────────────────────────
│      LinkedTickets   <LinkedTickets documentId disabled />
*/
// The same links as the ticket page's Documents section, seen from the other
// end (`GET /documents/{id}`). The picker searches the tickets the local store
// holds.

type LinkedTicketsProps = {
    /** From the URL; may be a temporary id. */
    documentId: string
    disabled?: boolean
}

const titleOf = (title: string) => title.trim() || 'Untitled'

export function LinkedTickets(props: LinkedTicketsProps) {
    const feed = createLinkFeed<LinkedTicket>({
        owner: () => props.documentId,
        load: getDocumentTickets,
        concerns: (event, ownerId) => (event.documentId === ownerId ? event.ticketId : null),
    })
    const [picking, setPicking] = createSignal(false)
    const [announcement, setAnnouncement] = createSignal('')

    const candidates = createMemo<PickOption[]>(() => {
        const linked = new Set(feed.items().map((item) => item.id))
        return sync.tickets
            .filter((ticket) => !linked.has(ticket.id))
            .map((ticket) => ({ id: ticket.id, label: titleOf(ticket.title) }))
            .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    })

    async function link(ticketId: string) {
        const ticket = ticketById(ticketId)
        if (!ticket) return
        const shown: LinkedTicket = { id: ticket.id, title: ticket.title, archived_at: null }
        const ok = await feed.add(shown, async () => {
            const [theTicket, document] = await Promise.all([settledId(ticketId), settledId(props.documentId)])
            if (!theTicket.ok) return theTicket
            if (!document.ok) return document
            const sent = await linkDocument(theTicket.data, document.data)
            return sent.ok ? { ok: true as const, data: theTicket.data } : sent
        })
        if (ok) setAnnouncement(`Linked “${titleOf(shown.title)}”.`)
    }

    async function unlink(item: LinkedTicket) {
        const ok = await feed.remove(item.id, async () => {
            const [theTicket, document] = await Promise.all([settledId(item.id), settledId(props.documentId)])
            if (!theTicket.ok) return theTicket
            if (!document.ok) return document
            return unlinkDocument(theTicket.data, document.data)
        })
        if (ok) setAnnouncement(`Unlinked “${titleOf(item.title)}”.`)
    }

    return (
        <section class="links" aria-labelledby="document-tickets-heading">
            <h2 id="document-tickets-heading" class="t-section">
                Tickets
            </h2>
            <Show
                when={feed.items().length > 0}
                fallback={<p class="t-body links__none">{feed.loaded() ? 'No tickets linked.' : feed.loadProblem() ? '' : 'Loading tickets…'}</p>}
            >
                <ul class="links__list">
                    <For each={feed.items()} keyed={(item) => item.id}>
                        {(item) => (
                            <li class="links__item">
                                <a class="t-body" href={`/tickets/${item().id}`}>
                                    {titleOf(item().title)}
                                </a>
                                <Show when={item().archived_at}>
                                    <span class="t-meta">Archived</span>
                                </Show>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={props.disabled}
                                    aria-label={`Unlink ${titleOf(item().title)}`}
                                    onClick={() => void unlink(item())}
                                >
                                    Unlink
                                </Button>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
            <Show when={feed.loadProblem()}>
                <p class="t-meta links__none">Could not load the linked tickets.</p>
            </Show>
            <Show when={feed.problem()}>
                {(message) => (
                    <p class="t-meta links__problem" role="alert">
                        {message()}
                    </p>
                )}
            </Show>
            <div class="links__actions">
                <Button variant="secondary" disabled={props.disabled} onClick={() => setPicking(true)}>
                    Link a ticket
                </Button>
            </div>
            <div class="visually-hidden" aria-live="polite">
                {announcement()}
            </div>
            <Show when={picking()}>
                <LinkPicker
                    title="Link a ticket"
                    noun="ticket"
                    options={candidates()}
                    onPick={(id) => void link(id)}
                    onClose={() => setPicking(false)}
                />
            </Show>
        </section>
    )
}
