import { describe, expect, it } from 'vitest'

import type { BoardColumn, Ticket } from '@/sync'

import { cardsOf, inOrder, moveColumn, positionAt, renameColumn, setVisible, statusFor, withStatusIn } from './board'

const col = (id: string, position: number, status_ids: string[], extra: Partial<BoardColumn> = {}): BoardColumn => ({
    id,
    name: id,
    position,
    is_visible: true,
    status_ids,
    ...extra,
})
const card = (id: string, status_id: string | null, position: number) => ({ id, status_id, position }) as Ticket

describe('positionAt', () => {
    const others = [{ position: 1024 }, { position: 2048 }, { position: 3072 }]
    it('takes the midpoint between neighbours', () => {
        expect(positionAt(others, 1)).toBe(1536)
        expect(positionAt(others, 2)).toBe(2560)
    })
    it('goes a step beyond either end, and starts an empty column at one step', () => {
        expect(positionAt(others, 0)).toBe(0)
        expect(positionAt(others, 3)).toBe(4096)
        expect(positionAt([], 0)).toBe(1024)
    })
    it('clamps an index outside the column', () => {
        expect(positionAt(others, 99)).toBe(4096)
        expect(positionAt(others, -4)).toBe(0)
    })
    it('lands on the lower neighbour when no whole number fits (the server renumbers)', () => {
        expect(positionAt([{ position: 5 }, { position: 6 }], 1)).toBe(5)
    })
})

describe('cardsOf', () => {
    it('shows the tickets of the column\'s statuses by position, then id', () => {
        const tickets = [card('b', 'a', 2), card('x', 'z', 1), card('a', 'a', 2), card('c', 'a', 1), card('n', null, 0)]
        expect(cardsOf(col('c1', 1, ['a']), tickets).map((t) => t.id)).toEqual(['c', 'a', 'b'])
    })

    it('shows a ticket in the first column that maps its status only (LAM-134)', () => {
        const columns = [col('later', 2, ['a', 'b']), col('first', 1, ['a']), col('empty', 3, [])]
        const tickets = [card('t1', 'a', 1), card('t2', 'b', 1)]
        expect(cardsOf(columns[1], tickets, columns).map((t) => t.id)).toEqual(['t1'])
        expect(cardsOf(columns[0], tickets, columns).map((t) => t.id)).toEqual(['t2'])
        expect(cardsOf(columns[2], tickets, columns)).toEqual([])
    })
})

describe('statusFor', () => {
    it('keeps the card\'s own status when the column holds it, otherwise takes the first', () => {
        const column = col('c', 1, ['s1', 's2'])
        expect(statusFor(column, { status_id: 's2' })).toBe('s2')
        expect(statusFor(column, { status_id: 'other' })).toBe('s1')
        expect(statusFor(col('empty', 1, []), { status_id: 's1' })).toBeNull()
    })
})

describe('editing columns', () => {
    const columns = [col('a', 1, ['s1']), col('b', 2, ['s2']), col('c', 3, ['s3'])]

    it('moves a column and renumbers, or says nothing changed at the ends', () => {
        expect(moveColumn(columns, 'c', -1)?.map((c) => [c.id, c.position])).toEqual([['a', 1], ['c', 2], ['b', 3]])
        expect(moveColumn(columns, 'a', -1)).toBeNull()
        expect(moveColumn(columns, 'c', 1)).toBeNull()
    })

    it('puts columns in order by position, then id', () => {
        expect(inOrder([col('z', 1, []), col('y', 1, []), col('a', 0, [])]).map((c) => c.id)).toEqual(['a', 'y', 'z'])
    })

    it('renames by trimmed text, and ignores a blank or unchanged name', () => {
        expect(renameColumn(columns, 'a', '  Backlog ')?.[0].name).toBe('Backlog')
        expect(renameColumn(columns, 'a', '   ')).toBeNull()
        expect(renameColumn(columns, 'a', 'a')).toBeNull()
    })

    it('hides and shows', () => {
        expect(setVisible(columns, 'b', false)?.[1].is_visible).toBe(false)
        expect(setVisible(columns, 'b', true)).toBeNull()
    })

    it('puts a status in one column only: adding it takes it out of the column that had it', () => {
        const next = withStatusIn(columns, 'a', 's2', true)!
        expect(next.map((c) => c.status_ids)).toEqual([['s1', 's2'], [], ['s3']])
        expect(withStatusIn(columns, 'a', 's1', true)).toBeNull()
        expect(withStatusIn(next, 'a', 's2', false)!.map((c) => c.status_ids)).toEqual([['s1'], [], ['s3']])
    })
})
