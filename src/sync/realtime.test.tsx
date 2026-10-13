import { render, screen } from '@solidjs/testing-library'
import { For } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { problem, ok, stubFetch } from '@/testing/fetch'

import { resume, startSync, stopSync, sync, ticketById, updateTicket } from './store'
import { FakeWebSocket } from './testing/fakeSocket'
import {
    deferred,
    listRoutes,
    manualConnectivity,
    manualTimer,
    manualVisibility,
    ME,
    page,
    ticket,
} from './testing/harness'

// The socket, the engine and the store together, with a fake WebSocket and a
// manual clock. The engine's rules are tested in engine.test.ts and the
// transport's in socket.test.ts; this is that they are wired to each other.

let names = 0
const freshName = () => `realtime-test-${++names}-${Math.random().toString(36).slice(2)}`

afterEach(async () => {
    await stopSync()
    vi.unstubAllGlobals()
    // The protocol has the client write nothing, whatever happened in the test.
    for (const socket of FakeWebSocket.instances) expect(socket.sent).toEqual([])
})

const settled = (check: () => void) => vi.waitFor(check)

function frame(type: string, row: ReturnType<typeof ticket>) {
    return { type, ticket_id: row.id, version: row.version, actor_id: 'acc-other', at: row.updated_at, ticket: row }
}

// Starts sync with everything injectable injected, and counts list requests.
async function open(routes: Parameters<typeof stubFetch>[0] = listRoutes([ticket()])) {
    const clock = manualTimer()
    const net = manualConnectivity()
    const tab = manualVisibility()
    const fetchMock = stubFetch(routes)
    await startSync(ME, {
        dbName: freshName(),
        timer: clock.timer,
        connectivity: net.connectivity,
        socket: {
            WebSocketImpl: FakeWebSocket,
            visibility: tab.visibility,
            random: () => 0.999999,
        },
    })
    const lists = () =>
        fetchMock.mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/v1/tickets/list')
            .length
    return { clock, net, tab, lists }
}

describe('the connection', () => {
    it('is not live until hello, and follows the socket after that', async () => {
        const { clock } = await open()
        expect(sync.connection).toBe('connecting')

        FakeWebSocket.last.open()
        expect(sync.connection).toBe('connecting')
        FakeWebSocket.last.receive({ type: 'hello' })
        expect(sync.connection).toBe('live')

        FakeWebSocket.last.drop()
        expect(sync.connection).toBe('reconnecting')

        clock.advance(clock.nextDelay()!)
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')
    })

    it('says offline the moment the browser does, without a word from the socket, and live again after online', async () => {
        const { net } = await open()
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')
        const first = FakeWebSocket.last

        net.goOffline()
        expect(sync.connection).toBe('offline')
        expect(first.closedByClient).not.toBeNull()

        net.goOnline()
        expect(sync.connection).toBe('reconnecting')
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')
    })

    it('listens for the window\'s own offline and online events by default', async () => {
        stubFetch(listRoutes())
        await startSync(ME, { dbName: freshName() })
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')

        window.dispatchEvent(new Event('offline'))
        expect(sync.connection).toBe('offline')

        window.dispatchEvent(new Event('online'))
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')
    })

    it('connects to the feed on the page\'s own origin by default', async () => {
        stubFetch(listRoutes())
        await startSync(ME, { dbName: freshName() })
        expect(FakeWebSocket.last.url).toBe(`ws://${location.host}/api/v1/ws`)
    })
})

describe('remote changes', () => {
    it('land in the store and on screen, and an echo changes nothing', async () => {
        await open()
        await settled(() => expect(sync.hydrated).toBe(true))
        render(() => (
            <ul>
                <For each={sync.tickets}>{(row) => <li>{row.title}</li>}</For>
            </ul>
        ))
        FakeWebSocket.last.hello()
        expect(screen.getByText('Write the outbox')).toBeInTheDocument()

        FakeWebSocket.last.receive(frame('ticket.updated', ticket({ title: 'Changed by someone', version: 2 })))
        expect(await screen.findByText('Changed by someone')).toBeInTheDocument()
        expect(screen.queryByText('Write the outbox')).not.toBeInTheDocument()

        FakeWebSocket.last.receive(frame('ticket.created', ticket({ id: 't-2', title: 'Brand new' })))
        expect(await screen.findByText('Brand new')).toBeInTheDocument()

        // The same version again: nothing happens, and the row is untouched.
        const row = ticketById('t-1')
        FakeWebSocket.last.receive(frame('ticket.updated', ticket({ title: 'Echo', version: 2 })))
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(ticketById('t-1')).toBe(row)
        expect(screen.queryByText('Echo')).not.toBeInTheDocument()

        FakeWebSocket.last.receive(frame('ticket.archived', ticket({ id: 't-2', version: 2 })))
        await settled(() => expect(screen.queryByText('Brand new')).not.toBeInTheDocument())
    })

    it('are ignored when malformed, and the connection survives', async () => {
        await open()
        await settled(() => expect(sync.hydrated).toBe(true))
        FakeWebSocket.last.hello()

        FakeWebSocket.last.receive('{{{')
        FakeWebSocket.last.receive({ type: 'ticket.updated', ticket: { id: 7 } })
        FakeWebSocket.last.receive({ type: 'something.new', ticket_id: 'x' })
        FakeWebSocket.last.receive(frame('ticket.updated', ticket({ title: 'Still works', version: 2 })))

        await settled(() => expect(ticketById('t-1')?.title).toBe('Still works'))
        expect(sync.connection).toBe('live')
    })
})

describe('closing the gap', () => {
    it('does not list again for the first hello while the first list is still on the wire', async () => {
        const tickets = deferred()
        const { lists } = await open({ ...listRoutes(), 'POST /api/v1/tickets/list': () => tickets.promise })
        await settled(() => expect(lists()).toBe(1))

        FakeWebSocket.last.hello()
        tickets.resolve(page([ticket()]))
        await settled(() => expect(sync.hydrated).toBe(true))
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(lists()).toBe(1)
    })

    it('lists again for the first hello when the first list had already finished', async () => {
        const { lists } = await open()
        await settled(() => expect(sync.hydrated).toBe(true))
        expect(lists()).toBe(1)

        FakeWebSocket.last.hello()

        await settled(() => expect(lists()).toBe(2))
    })

    it('lists exactly once after each reconnect', async () => {
        const { clock, lists } = await open()
        await settled(() => expect(sync.hydrated).toBe(true))
        FakeWebSocket.last.hello()
        await settled(() => expect(lists()).toBe(2))

        for (const expected of [3, 4]) {
            FakeWebSocket.last.drop()
            // Down and failing for a while does not list; only getting back does.
            clock.advance(clock.nextDelay()!)
            FakeWebSocket.last.drop()
            clock.advance(clock.nextDelay()!)
            expect(lists()).toBe(expected - 1)

            FakeWebSocket.last.hello()
            await settled(() => expect(lists()).toBe(expected))
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(lists()).toBe(expected)
        }
    })

    it('reconnects on `online` and when the tab is shown again', async () => {
        const { clock, net, tab } = await open()
        FakeWebSocket.last.hello()
        FakeWebSocket.last.drop()
        expect(FakeWebSocket.instances).toHaveLength(1)

        net.goOnline()
        expect(FakeWebSocket.instances).toHaveLength(2)

        FakeWebSocket.last.drop()
        tab.show()
        expect(FakeWebSocket.instances).toHaveLength(3)
        expect(clock.nextDelay()).not.toBe(0)
    })
})

describe('when the session is gone', () => {
    it('closes the socket on a 401, stays closed, and comes back on resume()', async () => {
        const { clock, net, tab } = await open({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => problem(401, 'unauthorized'),
        })
        await settled(() => expect(sync.hydrated).toBe(true))
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')

        await updateTicket('t-1', { title: 'Mine' })
        await settled(() => expect(sync.paused).toBe(true))

        expect(FakeWebSocket.instances[0].closedByClient).not.toBeNull()
        expect(sync.connection).toBe('offline')
        net.goOnline()
        tab.show()
        clock.advance(120_000)
        expect(FakeWebSocket.instances).toHaveLength(1)

        stubFetch({
            ...listRoutes([ticket()]),
            'PUT /api/v1/tickets/t-1': () => ok(ticket({ title: 'Mine', version: 2, updated_by: ME })),
        })
        await resume()

        expect(FakeWebSocket.instances).toHaveLength(2)
        FakeWebSocket.last.hello()
        expect(sync.connection).toBe('live')
    })

    it('does not open a socket for a session that was refused at the first list', async () => {
        const { clock } = await open({ 'POST /api/v1/teams/list': () => problem(401, 'unauthorized') })
        await settled(() => expect(sync.paused).toBe(true))

        expect(FakeWebSocket.instances[0].closedByClient).not.toBeNull()
        clock.advance(120_000)
        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(sync.connection).toBe('offline')
    })
})

describe('stopping', () => {
    it('closes the socket and cancels every timer', async () => {
        const { clock, net, tab } = await open()
        await settled(() => expect(sync.hydrated).toBe(true))
        FakeWebSocket.last.hello()
        FakeWebSocket.last.drop()
        expect(clock.nextDelay()).not.toBeNull()

        await stopSync()

        expect(clock.nextDelay()).toBeNull()
        expect(sync.connection).toBe('offline')
        net.goOnline()
        tab.show()
        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(tab.listening).toBe(0)
    })

    it('closes a live socket', async () => {
        await open()
        FakeWebSocket.last.hello()

        await stopSync()

        expect(FakeWebSocket.last.closedByClient).not.toBeNull()
    })
})
