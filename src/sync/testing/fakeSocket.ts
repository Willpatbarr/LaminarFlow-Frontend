import type { SocketLike } from '../socket'

// A WebSocket the test drives by hand. Every instance is kept so a test can
// ask "how many connections were made" and "did the client ever send".

export class FakeWebSocket implements SocketLike {
    static instances: FakeWebSocket[] = []

    static reset() {
        FakeWebSocket.instances = []
    }

    static get last(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1)
        if (!socket) throw new Error('no WebSocket was created')
        return socket
    }

    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    /** Anything the client wrote. The protocol has the client write nothing. */
    sent: unknown[] = []
    /** The client closed it, and how. */
    closedByClient: { code?: number; reason?: string } | null = null

    url: string

    constructor(url: string) {
        this.url = url
        FakeWebSocket.instances.push(this)
    }

    send(data: unknown) {
        this.sent.push(data)
    }

    close(code?: number, reason?: string) {
        this.closedByClient = { code, reason }
    }

    // ── the server's side ───────────────────────────────────────────────────

    /** The upgrade completed. */
    open() {
        this.onopen?.(new Event('open'))
    }

    /** A text frame; an object is sent as its JSON. */
    receive(frame: unknown) {
        const data = typeof frame === 'string' ? frame : JSON.stringify(frame)
        this.onmessage?.(new MessageEvent('message', { data }))
    }

    /** The upgrade completed and the server said hello. */
    hello() {
        this.open()
        this.receive({ type: 'hello' })
    }

    /** The connection ended (a refused handshake and a dropped one look the same). */
    drop() {
        this.onerror?.(new Event('error'))
        this.onclose?.(new CloseEvent('close', { code: 1006 }))
    }
}
