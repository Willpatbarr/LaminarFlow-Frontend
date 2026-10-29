import type { Board, BoardColumn, Status, Ticket } from '@/sync'

/*
┌─ tickets ───────────────────────────────────────
│  the board's arithmetic: which cards a column shows, and where a dropped card lands
├─ out ───────────────────────────────────────────
│      POSITION_STEP, byPosition
│      cardsOf(column, tickets)             a column's cards in order
│      statusFor(column, ticket)            the status a card takes in a column
│      positionAt(others, index)            the position for a card dropped at `index`
│      moveColumn · setVisible · renameColumn · withStatusIn   a board's columns, edited
│      columnOfStatus, lookStatus, inOrder
├─ example ───────────────────────────────────────
│      positionAt([{position: 1024}, {position: 2048}], 1)  →  1536
*/
// No Solid in here: every decision the board makes is a function of plain rows,
// so it can be read and tested without a screen.

/** The gap the server leaves between neighbours (`positionStep` in its move.go). */
export const POSITION_STEP = 1024

/** Order within a column: by position, and the id breaks a tie, as the server does. */
export function byPosition(a: Pick<Ticket, 'position' | 'id'>, b: Pick<Ticket, 'position' | 'id'>) {
    return a.position - b.position || a.id.localeCompare(b.id)
}

/** The tickets a column shows: those of its statuses, in order. */
export function cardsOf(column: BoardColumn, tickets: Ticket[]): Ticket[] {
    return tickets.filter((ticket) => ticket.status_id !== null && column.status_ids.includes(ticket.status_id)).sort(byPosition)
}

/** The status a card has once it is in `column`: the one it already has when the
 *  column holds it (a move within a column keeps its status), otherwise the
 *  column's first. Null for a column with no statuses, which takes no cards. */
export function statusFor(column: BoardColumn, ticket: Pick<Ticket, 'status_id'>): string | null {
    if (ticket.status_id && column.status_ids.includes(ticket.status_id)) return ticket.status_id
    return column.status_ids[0] ?? null
}

/** The position for a card dropped at `index` among `others` (the column's
 *  cards without the one being moved, in order). The server's own rule: the
 *  midpoint between neighbours, a step beyond an end. When there is no whole
 *  number between two neighbours this lands on one of them, and the server
 *  renumbers the column when it gets the move. */
export function positionAt(others: Pick<Ticket, 'position'>[], index: number): number {
    const at = Math.max(0, Math.min(index, others.length))
    if (others.length === 0) return POSITION_STEP
    if (at === 0) return others[0].position - POSITION_STEP
    if (at === others.length) return others[at - 1].position + POSITION_STEP
    const low = others[at - 1].position
    return low + Math.floor((others[at].position - low) / 2)
}

// ── a board's columns, edited ───────────────────────────────────────────────
// Each returns the new `columns` for `updateBoard`, or null when the edit would
// change nothing (so nothing is queued).

const renumbered = (columns: BoardColumn[]) => columns.map((column, index) => ({ ...column, position: index + 1 }))

/** `columns` in board order. */
export function inOrder(columns: BoardColumn[]): BoardColumn[] {
    return columns.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

export function moveColumn(columns: BoardColumn[], id: string, by: number): BoardColumn[] | null {
    const ordered = inOrder(columns)
    const from = ordered.findIndex((column) => column.id === id)
    const to = from + by
    if (from < 0 || to < 0 || to >= ordered.length) return null
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    return renumbered(ordered)
}

export function renameColumn(columns: BoardColumn[], id: string, name: string): BoardColumn[] | null {
    const text = name.trim()
    const column = columns.find((candidate) => candidate.id === id)
    if (!column || text === '' || text === column.name) return null
    return columns.map((candidate) => (candidate.id === id ? { ...candidate, name: text } : candidate))
}

export function setVisible(columns: BoardColumn[], id: string, visible: boolean): BoardColumn[] | null {
    const column = columns.find((candidate) => candidate.id === id)
    if (!column || column.is_visible === visible) return null
    return columns.map((candidate) => (candidate.id === id ? { ...candidate, is_visible: visible } : candidate))
}

/** Puts a status in (`on`) or takes it out of a column. A status sits in one
 *  column of a board, so putting it in takes it out of wherever it was. */
export function withStatusIn(columns: BoardColumn[], id: string, statusId: string, on: boolean): BoardColumn[] | null {
    const target = columns.find((candidate) => candidate.id === id)
    if (!target || target.status_ids.includes(statusId) === on) return null
    return columns.map((column) => {
        if (column.id === id) {
            return { ...column, status_ids: on ? [...column.status_ids, statusId] : column.status_ids.filter((s) => s !== statusId) }
        }
        return on && column.status_ids.includes(statusId)
            ? { ...column, status_ids: column.status_ids.filter((s) => s !== statusId) }
            : column
    })
}

/** The column that holds `statusId`, if any. */
export function columnOfStatus(board: Pick<Board, 'columns'>, statusId: string): BoardColumn | undefined {
    return board.columns.find((column) => column.status_ids.includes(statusId))
}

/** The hue source for a column: its first status that the team still has. */
export function lookStatus(column: BoardColumn, statuses: Status[]): Status | undefined {
    for (const id of column.status_ids) {
        const found = statuses.find((status) => status.id === id)
        if (found) return found
    }
    return undefined
}
