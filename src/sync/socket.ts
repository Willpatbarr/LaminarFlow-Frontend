import { systemTimer, type Connectivity, type Timer } from './engine'

/*
╔═ socket.ts ═══════════════════════════════════════════════════════════════════════════
║  sync · the WebSocket transport: connect, stay connected, hand frames up
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      createSocket       start/stop, setPaused, state
║      ConnectionState    connecting · live · reconnecting · offline
║      Visibility         "the tab is in front again", the second thing it needs
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      store.ts (owns one per running engine), socket tests
╚═══════════════════════════════════════════════════════════════════════════════════════
*/
// Transport only: it knows nothing of tickets. A parsed frame goes up through
// `onEvent`; what it means is the engine's business. No Solid in here, and the
// WebSocket class, clock, network status, tab visibility and random source all
// arrive as arguments, so a test drives it with fakes in plain Node.
//
// THE CONTRACT (backend docs/realtime.md). The server speaks first with
// `{"type":"hello"}`; until it has, the socket is not live - a proxy that
// accepts the upgrade and then buffers looks exactly like an open socket that
// never delivers. The client sends NOTHING, ever (a data frame closes the
// connection with 1008), so there is no heartbeat here: the server pings every
// 30 seconds and the browser answers, out of sight of JS. What JS can see is
// close and error events, so those, plus `online` and the tab coming back to the
// front, are the whole of liveness detection.

export type ConnectionState =
    /** The first attempt since start, or since being held back. */
    | 'connecting'
    /** `hello` has arrived. */
    | 'live'
    /** Lost, or an attempt failed; one is under way or waiting out a backoff. */
    | 'reconnecting'
    /** Nothing is being tried: the browser says it is offline, or the socket is
     *  held (the session is gone), or it was stopped. */
    | 'offline'

/** The part of a WebSocket this uses. The browser's class satisfies it. */
export interface SocketLike {
    onopen: ((event: Event) => void) | null
    onmessage: ((event: MessageEvent) => void) | null
    onclose: ((event: CloseEvent) => void) | null
    onerror: ((event: Event) => void) | null
    close(code?: number, reason?: string): void
}

export type SocketClass = new (url: string) => SocketLike

export type Visibility = {
    /** Calls `fn` each time the tab comes back to the front. Returns the unsubscribe. */
    onVisible(fn: () => void): () => void
}

export const browserVisibility: Visibility = {
    onVisible(fn) {
        const listener = () => {
            if (document.visibilityState !== 'hidden') fn()
        }
        document.addEventListener('visibilitychange', listener)
        return () => document.removeEventListener('visibilitychange', listener)
    },
}

export type SocketBackoff = { baseMs: number; maxMs: number }

// Longer ceiling than the outbox's: a socket that cannot connect is not
// losing the user's work, and a tab left open for a day should not knock on a
// restarting server every minute.
export const DEFAULT_SOCKET_BACKOFF: SocketBackoff = { baseMs: 1_000, maxMs: 30_000 }

export const DEFAULT_HELLO_TIMEOUT_MS = 10_000

export type SocketDeps = {
    /** Where to connect. A WebSocket needs an absolute `ws:`/`wss:` URL; the
     *  app builds it from `location` (`realtimeUrl`). */
    url: string
    /** Defaults to the global `WebSocket`, looked up at each connection. */
    WebSocketImpl?: SocketClass
    timer?: Timer
    connectivity?: Connectivity
    visibility?: Visibility
    /** In [0, 1). Injected so a test gets a delay it can predict. */
    random?: () => number
    backoff?: SocketBackoff
    /** How long a socket may take to produce `hello` before it is dropped
     *  and tried again. */
    helloTimeoutMs?: number
    /** A parsed JSON frame other than `hello`. Only called while live. */
    onEvent: (frame: unknown) => void
    /** The server said `hello`. `first` is true for the first one since start. */
    onOpen?: (info: { first: boolean }) => void
    onStateChange?: (state: ConnectionState) => void
}

export type RealtimeSocket = {
    /** Connects, and keeps trying until `stop()`. Once only. */
    start(): void
    /** Closes the socket and cancels every timer and listener. Final. */
    stop(): void
    /** While paused nothing is open and nothing is tried; unpausing connects at
     *  once. For a 401: reconnecting would be refused until the user signs in. */
    setPaused(paused: boolean): void
    state(): ConnectionState
}

/** The feed's URL for the page it is called from: same origin, `ws:` or `wss:`
 *  to match. */
export function realtimeUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
    return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api/v1/ws`
}

export function createSocket(deps: SocketDeps): RealtimeSocket {
    const timer = deps.timer ?? systemTimer
    const connectivity = deps.connectivity
    const visibility = deps.visibility
    const random = deps.random ?? Math.random
    const backoff = deps.backoff ?? DEFAULT_SOCKET_BACKOFF
    const helloTimeoutMs = deps.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS

    let phase: 'new' | 'running' | 'stopped' = 'new'
    let paused = false
    let state: ConnectionState = 'offline'
    // The attempt that counts. Every handler checks it is still the one, so a
    // socket we gave up on cannot report anything afterwards.
    let current: SocketLike | null = null
    let live = false
    let greeted = false
    let attempted = false
    let failures = 0
    let retry: unknown = null
    let greetingDeadline: unknown = null
    let offOnline = () => {}
    let offOffline = () => {}
    let offVisible = () => {}

    const isRunning = () => phase === 'running'
    const isOnline = () => connectivity?.isOnline() ?? true

    function setState(next: ConnectionState) {
        if (state === next) return
        state = next
        deps.onStateChange?.(next)
    }

    function clearTimers() {
        if (retry !== null) timer.clear(retry)
        if (greetingDeadline !== null) timer.clear(greetingDeadline)
        retry = null
        greetingDeadline = null
    }

    // A deliberate end: its own events are muted first, because a real
    // WebSocket reports the close we asked for like any other.
    function drop(socket: SocketLike) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
        try {
            socket.close()
        } catch {
            // Already closed; nothing more to do.
        }
    }

    // Somewhere between half the ceiling and all of it: a laptop waking up
    // with a hundred tabs should not reconnect them in the same millisecond.
    function delay(attempts: number) {
        const ceiling = Math.min(backoff.maxMs, backoff.baseMs * 2 ** (attempts - 1))
        return Math.round(ceiling * (0.5 + random() / 2))
    }

    function lost(socket: SocketLike) {
        if (current !== socket) return
        drop(socket)
        current = null
        live = false
        clearTimers()
        if (!isRunning() || paused) return

        failures += 1
        if (!isOnline()) {
            // `online` is the way back; a timer would only fail again.
            setState('offline')
            return
        }
        setState('reconnecting')
        retry = timer.set(() => {
            retry = null
            connect()
        }, delay(failures))
    }

    function handle(socket: SocketLike, data: unknown) {
        // Binary frames do not exist in this protocol; a frame that is not
        // JSON is not for us. Either way it is not worth dropping a good
        // connection over.
        if (typeof data !== 'string') return
        let frame: unknown
        try {
            frame = JSON.parse(data)
        } catch {
            return
        }
        if (typeof frame !== 'object' || frame === null) return

        if ((frame as { type?: unknown }).type === 'hello') {
            if (live) return
            live = true
            failures = 0
            if (greetingDeadline !== null) timer.clear(greetingDeadline)
            greetingDeadline = null
            setState('live')
            const first = !greeted
            greeted = true
            deps.onOpen?.({ first })
            return
        }

        // Nothing is trusted before `hello`: the path is not known to work yet.
        if (!live || current !== socket) return
        try {
            deps.onEvent(frame)
        } catch (error) {
            console.error('a realtime listener failed', error)
        }
    }

    function connect() {
        if (retry !== null) timer.clear(retry)
        retry = null
        if (!isRunning() || paused || current) return
        if (!isOnline()) {
            setState('offline')
            return
        }

        const Impl = deps.WebSocketImpl ?? (globalThis.WebSocket as unknown as SocketClass)
        setState(attempted ? 'reconnecting' : 'connecting')
        attempted = true

        let socket: SocketLike
        try {
            socket = new Impl(deps.url)
        } catch (error) {
            // A URL the browser refuses to parse. Backing off is as good a
            // answer as any; it will not get better, but it will not spin.
            console.error('could not open the realtime socket', error)
            failures += 1
            setState('reconnecting')
            retry = timer.set(() => {
                retry = null
                connect()
            }, delay(failures))
            return
        }
        current = socket
        socket.onmessage = (event) => {
            if (current === socket) handle(socket, event.data)
        }
        socket.onclose = () => lost(socket)
        socket.onerror = () => lost(socket)
        greetingDeadline = timer.set(() => {
            greetingDeadline = null
            if (current === socket && !live) lost(socket)
        }, helloTimeoutMs)
    }

    // The network or the tab came back: whatever the backoff has grown to, the
    // reason for it may be gone, so start again from the short end.
    function nudge() {
        if (!isRunning() || paused || current) return
        failures = 0
        connect()
    }

    // The browser's `offline` is authoritative. An open socket proves nothing
    // about the network: a connection that went half-open still looks open, and
    // may keep looking open for minutes. So the socket is closed here, on
    // purpose, and `online` is the way back.
    function goOffline() {
        if (!isRunning() || paused) return
        clearTimers()
        if (current) drop(current)
        current = null
        live = false
        setState('offline')
    }

    function start() {
        if (phase !== 'new') throw new Error('a socket starts once; make a new one')
        phase = 'running'
        offOnline = connectivity?.onOnline(nudge) ?? (() => {})
        offOffline = connectivity?.onOffline(goOffline) ?? (() => {})
        offVisible = visibility?.onVisible(nudge) ?? (() => {})
        connect()
    }

    function stop() {
        if (phase === 'stopped') return
        phase = 'stopped'
        offOnline()
        offOffline()
        offVisible()
        clearTimers()
        if (current) drop(current)
        current = null
        live = false
        setState('offline')
    }

    function setPaused(next: boolean) {
        if (paused === next) return
        paused = next
        if (!isRunning()) return
        if (next) {
            clearTimers()
            if (current) drop(current)
            current = null
            live = false
            setState('offline')
        } else {
            failures = 0
            connect()
        }
    }

    return { start, stop, setPaused, state: () => state }
}
