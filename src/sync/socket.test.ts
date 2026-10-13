import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSocket, realtimeUrl, type ConnectionState, type SocketDeps } from './socket'
import { FakeWebSocket } from './testing/fakeSocket'
import { manualConnectivity, manualTimer, manualVisibility } from './testing/harness'

beforeEach(() => {
    FakeWebSocket.reset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

function setup(overrides: Partial<SocketDeps> = {}) {
    const clock = manualTimer()
    const net = manualConnectivity()
    const tab = manualVisibility()
    const events: unknown[] = []
    const opens: { first: boolean }[] = []
    const states: ConnectionState[] = []
    const socket = createSocket({
        url: 'ws://localhost/api/v1/ws',
        WebSocketImpl: FakeWebSocket,
        timer: clock.timer,
        connectivity: net.connectivity,
        visibility: tab.visibility,
        // The top of the range: the delay is then the whole ceiling.
        random: () => 0.999999,
        onEvent: (frame) => events.push(frame),
        onOpen: (info) => opens.push(info),
        onStateChange: (state) => states.push(state),
        ...overrides,
    })
    return { socket, clock, net, tab, events, opens, states }
}

// Waits out the backoff, lets the attempt be made, and fails it. Only for use
// when no socket is open, so the next timer is the retry and not a hello deadline.
function failNextAttempt(clock: ReturnType<typeof manualTimer>) {
    const wait = clock.nextDelay()!
    clock.advance(wait)
    FakeWebSocket.last.drop()
    return wait
}

describe('connecting', () => {
    it('opens the socket on start, and is not live until hello', () => {
        const { socket, states, events, opens } = setup()
        socket.start()

        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(FakeWebSocket.last.url).toBe('ws://localhost/api/v1/ws')
        expect(socket.state()).toBe('connecting')

        FakeWebSocket.last.open()
        expect(socket.state()).toBe('connecting')

        // An event before hello is not trusted.
        FakeWebSocket.last.receive({ type: 'ticket.updated' })
        expect(events).toEqual([])

        FakeWebSocket.last.receive({ type: 'hello' })
        expect(socket.state()).toBe('live')
        expect(opens).toEqual([{ first: true }])
        expect(states).toEqual(['connecting', 'live'])
    })

    it('hands events up once live, and ignores what is not a JSON object', () => {
        const { socket, events } = setup()
        socket.start()
        FakeWebSocket.last.hello()

        FakeWebSocket.last.receive({ type: 'ticket.updated', version: 2 })
        FakeWebSocket.last.receive('not json {')
        FakeWebSocket.last.receive('42')
        FakeWebSocket.last.receive('null')
        FakeWebSocket.last.onmessage?.(new MessageEvent('message', { data: new ArrayBuffer(4) }))
        FakeWebSocket.last.receive({ type: 'hello' })

        expect(events).toEqual([{ type: 'ticket.updated', version: 2 }])
        expect(socket.state()).toBe('live')
    })

    it('keeps going when the listener throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const seen: unknown[] = []
        const { socket } = setup({
            onEvent: (frame) => {
                seen.push(frame)
                throw new Error('boom')
            },
        })
        socket.start()
        FakeWebSocket.last.hello()

        FakeWebSocket.last.receive({ type: 'a' })
        FakeWebSocket.last.receive({ type: 'b' })

        expect(seen).toHaveLength(2)
        expect(socket.state()).toBe('live')
    })

    it('gives up on a socket that never says hello, and tries again', () => {
        const { socket, clock } = setup()
        socket.start()
        FakeWebSocket.last.open()

        clock.advance(10_000)

        expect(FakeWebSocket.instances[0].closedByClient).not.toBeNull()
        expect(socket.state()).toBe('reconnecting')
        clock.advance(clock.nextDelay()!)
        expect(FakeWebSocket.instances).toHaveLength(2)
    })

    it('does not time out once hello has arrived', () => {
        const { socket, clock } = setup()
        socket.start()
        FakeWebSocket.last.hello()

        expect(clock.nextDelay()).toBeNull()
        clock.advance(60_000)
        expect(socket.state()).toBe('live')
        expect(FakeWebSocket.last.closedByClient).toBeNull()
    })

    it('does not start while the browser is offline, and connects when it is back', () => {
        const { socket, net } = setup()
        net.goOffline()
        socket.start()
        expect(FakeWebSocket.instances).toHaveLength(0)
        expect(socket.state()).toBe('offline')

        net.goOnline()
        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(socket.state()).toBe('connecting')
    })

    it('says offline instead of backing off when the connection drops with the network gone', () => {
        const { socket, clock, net } = setup()
        socket.start()
        FakeWebSocket.last.hello()

        net.goOffline()
        FakeWebSocket.last.drop()

        expect(socket.state()).toBe('offline')
        expect(clock.nextDelay()).toBeNull()
    })

    it('never sends anything', () => {
        const { socket, clock, net, tab } = setup()
        socket.start()
        FakeWebSocket.last.hello()
        FakeWebSocket.last.receive({ type: 'ticket.updated' })
        FakeWebSocket.last.drop()
        clock.advance(clock.nextDelay()!)
        FakeWebSocket.last.hello()
        net.goOnline()
        tab.show()
        socket.stop()

        expect(FakeWebSocket.instances.length).toBeGreaterThan(1)
        for (const instance of FakeWebSocket.instances) expect(instance.sent).toEqual([])
    })
})

describe('reconnecting', () => {
    it('backs off exponentially to a cap', () => {
        const { socket, clock } = setup()
        socket.start()

        const waits: number[] = []
        // The first attempt fails at once; each later one fails when made.
        FakeWebSocket.last.drop()
        for (let i = 0; i < 9; i++) waits.push(failNextAttempt(clock))

        expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000])
        expect(socket.state()).toBe('reconnecting')
    })

    it('adds jitter, between half the ceiling and all of it', () => {
        const low = setup({ random: () => 0 })
        low.socket.start()
        FakeWebSocket.last.drop()
        expect(low.clock.nextDelay()).toBe(500)

        FakeWebSocket.reset()
        const mid = setup({ random: () => 0.5 })
        mid.socket.start()
        FakeWebSocket.last.drop()
        expect(mid.clock.nextDelay()).toBe(750)
    })

    it('starts the backoff over after a connection that reached hello', () => {
        const { socket, clock } = setup()
        socket.start()
        FakeWebSocket.last.drop()
        failNextAttempt(clock)
        failNextAttempt(clock)
        clock.advance(clock.nextDelay()!)
        FakeWebSocket.last.hello()
        expect(socket.state()).toBe('live')

        FakeWebSocket.last.drop()

        expect(socket.state()).toBe('reconnecting')
        expect(clock.nextDelay()).toBe(1_000)
    })

    it('reports a second hello as not the first', () => {
        const { socket, clock, opens } = setup()
        socket.start()
        FakeWebSocket.last.hello()
        FakeWebSocket.last.drop()
        clock.advance(clock.nextDelay()!)
        FakeWebSocket.last.hello()

        expect(opens).toEqual([{ first: true }, { first: false }])
    })

    it('reconnects at once, from the short end, when the network comes back', () => {
        const { socket, clock, net } = setup()
        socket.start()
        FakeWebSocket.last.drop()
        failNextAttempt(clock)
        failNextAttempt(clock)
        expect(clock.nextDelay()).toBe(4_000)

        net.goOnline()

        expect(FakeWebSocket.instances).toHaveLength(4)
        expect(socket.state()).toBe('reconnecting')
        // The timer that was waiting is gone: one attempt, not two. What is
        // left is the new attempt's hello deadline.
        expect(clock.nextDelay()).toBe(10_000)
        FakeWebSocket.last.drop()
        expect(clock.nextDelay()).toBe(1_000)
    })

    it('reconnects at once when the tab comes back to the front, if it is not connected', () => {
        const { socket, clock, tab } = setup()
        socket.start()
        FakeWebSocket.last.drop()
        expect(clock.nextDelay()).toBe(1_000)

        tab.show()

        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(socket.state()).toBe('reconnecting')
    })

    it('leaves a connected socket alone when the tab or the network comes back', () => {
        const { socket, net, tab } = setup()
        socket.start()
        FakeWebSocket.last.hello()

        tab.show()
        net.goOnline()

        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(socket.state()).toBe('live')
    })

    it('does not open a second socket while one is still connecting', () => {
        const { socket, tab, net } = setup()
        socket.start()

        tab.show()
        net.goOnline()

        expect(FakeWebSocket.instances).toHaveLength(1)
    })

    it('ignores what a socket it gave up on says afterwards', () => {
        const { socket, clock, events } = setup()
        socket.start()
        const old = FakeWebSocket.last
        old.hello()
        old.drop()
        clock.advance(clock.nextDelay()!)
        FakeWebSocket.last.hello()

        old.receive({ type: 'ticket.updated' })
        old.drop()

        expect(events).toEqual([])
        expect(socket.state()).toBe('live')
    })
})

describe('pausing', () => {
    it('closes the socket and tries nothing while paused', () => {
        const { socket, clock, net, tab } = setup()
        socket.start()
        FakeWebSocket.last.hello()

        socket.setPaused(true)

        expect(FakeWebSocket.instances[0].closedByClient).not.toBeNull()
        expect(socket.state()).toBe('offline')
        net.goOnline()
        tab.show()
        expect(clock.nextDelay()).toBeNull()
        expect(FakeWebSocket.instances).toHaveLength(1)
    })

    it('does not retry a connection that was failing when it was paused', () => {
        const { socket, clock } = setup()
        socket.start()
        FakeWebSocket.last.drop()
        expect(clock.nextDelay()).not.toBeNull()

        socket.setPaused(true)

        expect(clock.nextDelay()).toBeNull()
    })

    it('connects at once when unpaused', () => {
        const { socket } = setup()
        socket.start()
        socket.setPaused(true)

        socket.setPaused(false)

        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(socket.state()).toBe('reconnecting')
        FakeWebSocket.last.hello()
        expect(socket.state()).toBe('live')
    })

    it('can be paused before it is started', () => {
        const { socket } = setup()
        socket.setPaused(true)
        socket.start()
        expect(FakeWebSocket.instances).toHaveLength(0)
        socket.setPaused(false)
        expect(FakeWebSocket.instances).toHaveLength(1)
    })
})

describe('stop', () => {
    it('closes the socket, cancels the timers and drops the listeners', () => {
        const { socket, clock, net, tab, states } = setup()
        socket.start()
        FakeWebSocket.last.drop()
        failNextAttempt(clock)
        expect(clock.nextDelay()).not.toBeNull()

        socket.stop()

        expect(clock.nextDelay()).toBeNull()
        expect(socket.state()).toBe('offline')
        expect(states.at(-1)).toBe('offline')
        expect(tab.listening).toBe(0)
        net.goOnline()
        tab.show()
        expect(FakeWebSocket.instances).toHaveLength(2)
    })

    it('closes a live socket without reporting its close as a loss', () => {
        const { socket, clock, states } = setup()
        socket.start()
        const live = FakeWebSocket.last
        live.hello()

        socket.stop()
        live.drop()

        expect(live.closedByClient).not.toBeNull()
        expect(states).toEqual(['connecting', 'live', 'offline'])
        expect(clock.nextDelay()).toBeNull()
    })

    it('starts once', () => {
        const { socket } = setup()
        socket.start()
        socket.stop()
        expect(() => socket.start()).toThrow()
    })
})

describe('realtimeUrl', () => {
    it('follows the page: ws for http, wss for https, same host', () => {
        expect(realtimeUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/v1/ws')
        expect(realtimeUrl({ protocol: 'https:', host: 'app.example.com' })).toBe('wss://app.example.com/api/v1/ws')
    })
})
