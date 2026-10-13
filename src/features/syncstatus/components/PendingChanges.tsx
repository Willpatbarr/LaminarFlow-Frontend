import { Show } from 'solid-js'

import { PendingIndicator, type PendingItem } from '@/components/ui/PendingIndicator'
import { discard, pendingSummary, type PendingReason, type PendingTicket } from '@/sync'

import { changes } from './plural'

// "3 changes waiting", "Sign in to sync 3 changes", "1 change needs attention".
function labelFor(reason: PendingReason, count: number): string {
    switch (reason) {
        case 'attention':
            return `${changes(count)} ${count === 1 ? 'needs' : 'need'} attention`
        case 'sign_in':
            return `Sign in to sync ${changes(count)}`
        case 'waiting':
            return `${changes(count)} waiting`
    }
}

function detailFor(ticket: PendingTicket): string {
    const more = ticket.changes > 1 ? ` (${changes(ticket.changes)})` : ''
    switch (ticket.state) {
        case 'pending':
            return (ticket.retrying ? 'Will retry' : 'Waiting to sync') + more
        case 'unauthorized':
            return 'Sign in to sync' + more
        case 'failed':
            return "Needs attention: the server didn't accept it" + more
        case 'conflict':
            // LAM-71: the conflict screen replaces this wording, and the
            // `href` below with it if the conflict gets a page of its own.
            return 'Needs attention: changed by someone else' + more
    }
}

function itemFor(ticket: PendingTicket): PendingItem {
    // A ticket whose row is gone locally has an archive waiting behind it:
    // there is no page to link to, so a refused one is resolved right here.
    const gone = ticket.title === null
    const refused = ticket.state === 'failed' || ticket.state === 'conflict'
    return {
        id: ticket.ticketId,
        href: gone ? undefined : `/tickets/${ticket.ticketId}`,
        label: gone ? 'Archived ticket' : ticket.title || 'Untitled',
        detail: detailFor(ticket),
        action:
            gone && refused
                ? { label: 'Discard my change', onClick: () => void discard(ticket.head.id) }
                : undefined,
    }
}

// The global "what has not reached the server" line in the side nav's foot.
// Absent when everything is synced - a quiet rail is the good news.
export function PendingChanges() {
    return (
        <Show when={pendingSummary()}>
            {(summary) => (
                <PendingIndicator
                    label={labelFor(summary().reason, summary().count)}
                    tone={summary().reason === 'attention' ? 'attention' : 'waiting'}
                    items={summary().tickets.map(itemFor)}
                />
            )}
        </Show>
    )
}
