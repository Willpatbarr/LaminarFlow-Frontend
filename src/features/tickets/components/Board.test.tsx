import { fireEvent, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { BOARD, listRoutes, ticket } from '@/sync/testing/harness'
import { openApp } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'

// The board against the real store and engine with only fetch stubbed.
let disconnect: () => void

beforeEach(() => {
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const TICKETS = [
    ticket({ id: 't-1', title: 'First', status_id: 's-todo', position: 1024 }),
    ticket({ id: 't-2', title: 'Second', status_id: 's-todo', position: 2048 }),
    ticket({ id: 't-3', title: 'Third', status_id: 's-doing', position: 1024 }),
]

async function open(extra: Parameters<typeof openApp>[1] = {}) {
    await openApp('/boards/b-1', { ...listRoutes(TICKETS, [], [BOARD]), ...extra })
    return screen.findByRole('heading', { name: 'Launch · Launch board' })
}

const titles = (column: string) =>
    within(screen.getByRole('region', { name: column })).queryAllByRole('link').map((link) => link.textContent)

describe('the board page', () => {
    it('draws a column per status with its cards in position order', async () => {
        await open()
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))
        expect(titles('In Progress')).toEqual(['Third'])
        expect(titles('Done')).toEqual([])
    })

    it('filters on the keystroke: the cards narrow within a tick and the typed text stays', async () => {
        const user = userEvent.setup()
        await open()
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))
        await user.type(screen.getByPlaceholderText('Search'), 'Sec')
        // No debounce: well under the old 250 ms wait.
        await waitFor(() => expect(titles('To Do')).toEqual(['Second']), { timeout: 100 })
        expect(screen.getByPlaceholderText('Search')).toHaveValue('Sec')
    })

    it('says so for a board the account does not have', async () => {
        await openApp('/boards/nope', listRoutes(TICKETS, [], [BOARD]))
        expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument()
    })
})

describe('moving a card', () => {
    it('with the keyboard: Space lifts, arrows steer, Space drops - one move, shown at once', async () => {
        const user = userEvent.setup()
        const moves: unknown[] = []
        await open({
            'POST /api/v1/tickets/t-1/move': async (request) => {
                moves.push(await bodyOf(request))
                return ok(ticket({ id: 't-1', title: 'First', status_id: 's-doing', position: 2048, version: 2 }))
            },
        })
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))

        const card = within(screen.getByRole('region', { name: 'To Do' })).getByRole('listitem', { name: 'First' })
        card.focus()
        await user.keyboard(' ')
        await user.keyboard('{ArrowRight}')
        await user.keyboard('{ArrowDown}')
        // Steering writes nothing.
        expect(moves).toEqual([])
        await user.keyboard(' ')

        await waitFor(() => expect(titles('In Progress')).toEqual(['Third', 'First']))
        expect(titles('To Do')).toEqual(['Second'])
        await waitFor(() => expect(moves).toEqual([{ status_id: 's-doing', position: 2048 }]))
    })

    it('Escape puts a lifted card back and writes nothing', async () => {
        const user = userEvent.setup()
        const moves: unknown[] = []
        await open({ 'POST /api/v1/tickets/t-1/move': async (r) => (moves.push(await bodyOf(r)), ok(ticket())) })
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))

        within(screen.getByRole('region', { name: 'To Do' })).getByRole('listitem', { name: 'First' }).focus()
        await user.keyboard(' {ArrowDown}{Escape}')
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(moves).toEqual([])
        expect(titles('To Do')).toEqual(['First', 'Second'])
    })

    it('by dragging: nothing is written until the drop, then one move with the column\'s status', async () => {
        const moves: unknown[] = []
        await open({
            'POST /api/v1/tickets/t-2/move': async (request) => {
                moves.push(await bodyOf(request))
                return ok(ticket({ id: 't-2', status_id: 's-done', position: 1024, version: 2 }))
            },
        })
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))

        const card = within(screen.getByRole('region', { name: 'To Do' })).getByRole('listitem', { name: 'Second' })
        const done = screen.getByRole('region', { name: 'Done' })
        // A signal written in one event is read by the next one, as in a
        // browser, where each is its own task.
        const next = () => new Promise((resolve) => setTimeout(resolve, 0))
        fireEvent.dragStart(card)
        await next()
        fireEvent.dragOver(done)
        await next()
        fireEvent.dragOver(done)
        await next()
        expect(moves).toEqual([])
        fireEvent.drop(done)

        await waitFor(() => expect(titles('Done')).toEqual(['Second']))
        await waitFor(() => expect(moves).toEqual([{ status_id: 's-done', position: 1024 }]))
    })
})

describe('the column menu', () => {
    it('renames a column, and hides one and shows it again', async () => {
        const user = userEvent.setup()
        const bodies: unknown[] = []
        // What the server holds as the changes arrive: GET answers with it.
        let server = BOARD
        await open({
            'PUT /api/v1/boards/b-1/columns/c-todo': async (request) => {
                bodies.push(await bodyOf(request))
                server = { ...server, columns: server.columns.map((c) => (c.id === 'c-todo' ? { ...c, name: 'Backlog' } : c)) }
                return ok(server.columns[0])
            },
            'PUT /api/v1/boards/b-1/columns/c-done': async (request) => {
                bodies.push(await bodyOf(request))
                server = { ...server, columns: server.columns.map((c) => (c.id === 'c-done' ? { ...c, is_visible: false } : c)) }
                return ok(server.columns[2])
            },
            'GET /api/v1/boards/b-1': () => ok(server),
        })
        await waitFor(() => expect(titles('To Do')).toEqual(['First', 'Second']))

        await user.click(screen.getByLabelText('Column options for To Do'))
        const name = screen.getByLabelText('Name of column To Do')
        await user.clear(name)
        await user.type(name, 'Backlog')
        await user.tab()
        expect(await screen.findByRole('region', { name: 'Backlog' })).toBeInTheDocument()
        await waitFor(() => expect(bodies).toContainEqual({ name: 'Backlog', is_visible: true }))

        await user.click(screen.getByLabelText('Column options for Done'))
        await user.click(screen.getByLabelText('Hide column Done'))
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Done' })).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Show column Done' })).toBeInTheDocument()
    })

    it('opens the status editor in a dialog', async () => {
        const user = userEvent.setup()
        await open()
        await user.click(await screen.findByLabelText('Column options for To Do'))
        await user.click(screen.getAllByRole('button', { name: 'Edit statuses…' })[0])
        expect(await screen.findByRole('dialog', { name: 'Statuses' })).toBeInTheDocument()
        expect(screen.getByRole('list', { name: 'Status order' })).toBeInTheDocument()
    })
})
