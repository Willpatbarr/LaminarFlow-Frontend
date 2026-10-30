import type { Ticket } from '@/sync'

/*
┌─ tickets/listView ──────────────────────────────
│  freezeOrder: keeps the list's rows where they are while the user is using it
├─ out ───────────────────────────────────────────
│      freezeOrder, Placed, Frozen
├─ example ───────────────────────────────────────
│      freezeOrder(lastShown, sortedNow, (id) => store.get(id), true)
*/
// An inline edit saves, "Recently updated" puts the row first, and the Archive
// button the pointer was about to press now belongs to another ticket (LAM-145).
// So while the user is interacting with the list (pointer over it, or focus in
// it) the rows keep the order they had, and the list re-sorts when they stop.
//
// What a frozen list does, each case chosen so that no row ever moves:
//   - A row whose data changed keeps its place and shows the new values. It also
//     keeps the group it was placed in (`placed`), so a status change does not
//     pull it into another group and shift the rows below.
//   - A row that stopped showing (archived, or edited out of the filter) stays
//     where it is, dimmed and inert: it cannot be clicked, and nothing under it
//     moves. It goes when the list unfreezes.
//   - A row that is new (a live update, a ticket someone created) is held back
//     and counted, for a "N new, refresh order" hint. Appending it would shift
//     every group below the one it joins.

export type Placed = {
    id: string
    /** The row's current data (the last data seen, for a row that is gone). */
    ticket: Ticket
    /** The data the row was placed by: what grouping reads while frozen. */
    placed: Ticket
    /** No longer in the list's answer: dimmed and inert until unfreeze. */
    gone: boolean
}

export type Frozen = { rows: Placed[]; held: number }

/** `previous` is what the list last showed; `fresh` is the filtered and sorted
 *  answer now; `current` finds a ticket that has left that answer but still
 *  exists. `frozen` false just shows `fresh`. */
export function freezeOrder(
    previous: Placed[],
    fresh: Ticket[],
    current: (id: string) => Ticket | undefined,
    frozen: boolean,
): Frozen {
    const before = new Map(previous.map((row) => [row.id, row]))
    // The same row object when nothing about it changed, so freezing or
    // thawing a list that has not changed rebuilds nothing (an open status
    // picker keeps its options).
    const row = (id: string, ticket: Ticket, placed: Ticket, gone: boolean): Placed => {
        const was = before.get(id)
        return was && was.ticket === ticket && was.placed === placed && was.gone === gone
            ? was
            : { id, ticket, placed, gone }
    }
    if (!frozen || previous.length === 0) {
        return { rows: fresh.map((ticket) => row(ticket.id, ticket, ticket, false)), held: 0 }
    }
    const answer = new Map(fresh.map((ticket) => [ticket.id, ticket]))
    const rows = previous.map((was): Placed => {
        // A row placed by its live ticket (the store's own object, which edits
        // change in place) is placed by a copy from here on: what it was when
        // the list froze.
        if (was.placed === was.ticket) was = { ...was, placed: { ...was.ticket } }
        const now = answer.get(was.id)
        if (now) return row(was.id, now, was.placed, false)
        return row(was.id, current(was.id) ?? was.ticket, was.placed, true)
    })
    return { rows, held: fresh.filter((ticket) => !before.has(ticket.id)).length }
}
