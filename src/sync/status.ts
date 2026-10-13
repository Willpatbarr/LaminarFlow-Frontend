import { createMemo, createRoot } from 'solid-js'

import { classify } from '@/api/errors'

import { sync } from './store'
import type { EntryState, OutboxEntry } from './types'

/*
┌─ sync ──────────────────────────────────────────
│  what the outbox adds up to, for the screens that tell the user about it
├─ out ───────────────────────────────────────────
│      syncTrouble   null, or 'network' / 'server' while changes or lists keep failing to reach the server
│      pendingSummary   null when everything is synced; else a count, the dominant reason, the tickets
├─ example ───────────────────────────────────────
│      3 entries, one failed with a 422  →  { reason: 'attention', count: 1, decisions: 0, … }
│      3 entries, one in conflict        →  { reason: 'decision', count: 1, decisions: 1, … }
│      3 entries, none failed, paused    →  { reason: 'sign_in', count: 3, … }
*/
// Derived from the store and nothing else: no timers, no engine. The wording
// belongs to the screens; this decides which story is true.

export type Trouble = 'network' | 'server'

/** Whether the server is being reached right now, as far as the last attempts
 *  say. Null while paused: a 401 is the session banner's story, not this one.
 *  A change that failed for good (422, 403) is not trouble either - retrying
 *  it changes nothing - and shows as "needs attention" instead. */
export function syncTrouble(): Trouble | null {
    if (!sync.active || sync.paused) return null
    let found: Trouble | null = null
    for (const entry of sync.outbox) {
        // `attempts` counts sends that got no usable answer, so it is the
        // difference between "queued" and "tried and failing".
        if (entry.state !== 'pending' || entry.attempts === 0 || !entry.error) continue
        // The network wins over the server: it is the more basic fact.
        if (classify(entry.error) === 'network') return 'network'
        found = 'server'
    }
    return found ?? sync.hydrationFailure
}

export type PendingReason =
    /** Something failed for good; only a person can resolve it. */
    | 'attention'
    /** Nothing failed, but a change collided with someone else's and waits for
     *  the user to choose. A normal multi-user event, not an error. */
    | 'decision'
    /** Held until the user signs in again. */
    | 'sign_in'
    /** Queued, or retrying. Nothing to do. */
    | 'waiting'

export type PendingTicket = {
    /** The id to link to. May be a temporary one; the page follows it. */
    ticketId: string
    /** Null when the local row is gone (an archive that has not been sent). */
    title: string | null
    /** The state of the head of this ticket's queue. */
    state: EntryState
    /** Whether the head has been tried and is being retried. */
    retrying: boolean
    /** Entries queued for this ticket. */
    changes: number
    /** The head entry, for a panel that offers to act on it. */
    head: OutboxEntry
}

export type PendingSummary = {
    reason: PendingReason
    /** For `attention`: the changes that failed. For `decision`: the conflicts.
     *  Otherwise every change. */
    count: number
    /** Changes in conflict, whatever the reason. */
    decisions: number
    /** Every change not on the server, whatever the reason. */
    total: number
    /** One per ticket, those needing attention first, then oldest first. */
    tickets: PendingTicket[]
}

// What needs a person, in either way: a refusal to fix or a conflict to decide.
// Both go to the top of the list; only the wording and the tone tell them apart.
const needsPerson = (state: EntryState) => state === 'failed' || state === 'conflict'

const summary = createRoot(() =>
    createMemo<PendingSummary | null>(() => {
        if (sync.outbox.length === 0) return null

        const byTicket = new Map<string, OutboxEntry[]>()
        for (const entry of sync.outbox) {
            const queue = byTicket.get(entry.ticket_id)
            if (queue) queue.push(entry)
            else byTicket.set(entry.ticket_id, [entry])
        }

        const tickets: PendingTicket[] = [...byTicket].map(([ticketId, queue]) => {
            const head = queue[0]
            return {
                ticketId,
                title: sync.tickets.find((ticket) => ticket.id === ticketId)?.title ?? null,
                state: head.state,
                retrying: head.state === 'pending' && head.attempts > 0,
                changes: queue.length,
                head,
            }
        })
        // Stable: equal rank keeps the oldest-first order the outbox is in.
        tickets.sort((a, b) => Number(needsPerson(b.state)) - Number(needsPerson(a.state)))

        const failed = sync.outbox.filter((entry) => entry.state === 'failed').length
        const decisions = sync.outbox.filter((entry) => entry.state === 'conflict').length
        const total = sync.outbox.length
        if (failed > 0) return { reason: 'attention', count: failed, decisions, total, tickets }
        if (decisions > 0) return { reason: 'decision', count: decisions, decisions, total, tickets }
        if (sync.paused || sync.outbox.some((entry) => entry.state === 'unauthorized')) {
            return { reason: 'sign_in', count: total, decisions, total, tickets }
        }
        return { reason: 'waiting', count: total, decisions, total, tickets }
    }),
)

/** Null when every change has reached the server. */
export function pendingSummary(): PendingSummary | null {
    return summary()
}
