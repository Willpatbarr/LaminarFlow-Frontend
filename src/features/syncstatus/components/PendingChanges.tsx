import { Show } from 'solid-js'

import { PendingIndicator, type PendingItem } from '@/components/ui/PendingIndicator'
import { pendingSummary, type PendingSummary, type PendingTicket } from '@/sync'

import { changes } from './plural'

// "3 changes waiting", "Sign in to sync 3 changes", "1 change needs attention",
// "2 changes need a decision". A conflict is a decision, not a fault, so it is
// counted and worded apart from a refusal; when both are present, the refusal
// leads and the decisions follow.
function labelFor(summary: PendingSummary): string {
    const { count } = summary
    const needs = count === 1 ? 'needs' : 'need'
    switch (summary.reason) {
        case 'attention': {
            const base = `${changes(count)} ${needs} attention`
            return summary.decisions > 0
                ? `${base}, ${summary.decisions} ${summary.decisions === 1 ? 'needs' : 'need'} a decision`
                : base
        }
        case 'decision':
            return `${changes(count)} ${needs} a decision`
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
            // Neutral on purpose: it may be the user's own other tab.
            return (
                (ticket.head.conflict?.code === 'ticket_archived'
                    ? 'Needs a decision: archived elsewhere'
                    : 'Needs a decision: changed elsewhere') + more
            )
    }
}

function itemFor(ticket: PendingTicket): PendingItem {
    // A ticket whose row is gone locally has an archive waiting behind it and
    // no page to link to. A refused or collided archive keeps its row, so every
    // ticket that needs a person can be reached from here.
    const gone = ticket.title === null
    return {
        id: ticket.ticketId,
        href: gone ? undefined : `/tickets/${ticket.ticketId}`,
        label: gone ? 'Archived ticket' : ticket.title || 'Untitled',
        detail: detailFor(ticket),
    }
}

function toneFor(summary: PendingSummary): 'attention' | 'decision' | 'waiting' {
    if (summary.reason === 'attention' || summary.reason === 'decision') return summary.reason
    return 'waiting'
}

// The global "what has not reached the server" line in the side nav's foot.
// Absent when everything is synced - a quiet rail is the good news.
export function PendingChanges() {
    return (
        <Show when={pendingSummary()}>
            {(summary) => (
                <PendingIndicator
                    label={labelFor(summary())}
                    tone={toneFor(summary())}
                    items={summary().tickets.map(itemFor)}
                />
            )}
        </Show>
    )
}
