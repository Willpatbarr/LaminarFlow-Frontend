import createClient from 'openapi-fetch'
import WebSocket from 'ws'

import type { paths } from '@/api/schema'
import { createSyncEngine, type SyncEngine } from '@/sync/engine'
import { openSyncDb, type SyncDb } from '@/sync/db'
import { createSocket, type ConnectionState, type RealtimeSocket, type SocketClass } from '@/sync/socket'
import { manualConnectivity, manualVisibility } from '@/sync/testing/harness'
import type { OutboxEntry, Ticket } from '@/sync/types'

import { baseUrl, type Account } from './stack'

// One client, assembled the way store.ts assembles the app's: the real engine,
// the real IndexedDB layer (on fake-indexeddb), the real socket, the real typed
// client. What is substituted is only what Node lacks - the `WebSocket` class
// (the `ws` package, because a browser sets the cookie and Origin itself and
// Node's built-in one cannot), the browser's `online` event and tab visibility
// (manual, so a test can take the network away), and a fetch that can be told
// to fail or to hold a request.

export type RequestLog = {
  method: string
  path: string
  ifMatch: string | null
  /** The `Idempotency-Key` header, null when none was sent. */
  idempotencyKey: string | null
  body: unknown
}

type Hold = { match: (request: RequestLog) => boolean; gate: Promise<void>; seen: Promise<void>; markSeen: () => void }

export type Rig = {
  engine: SyncEngine
  db: SyncDb
  socket: RealtimeSocket | null
  /** Every request the engine made, in order. */
  requests: RequestLog[]
  /** Every change-feed frame the socket handed up, and whether the engine changed anything for it. */
  frames: { frame: { type?: string; ticket_id?: string; actor_id?: string; version?: number }; changed: Promise<boolean> }[]
  connection(): ConnectionState
  /** The browser's `offline`: the engine stops sending, the socket stops trying. */
  goOffline(): void
  goOnline(): void
  /** Cuts the live socket without a close handshake, as a dropped connection looks to the client. */
  dropConnection(): void
  /** The network breaking underneath a browser that still believes it is online. */
  setNetworkDown(down: boolean): void
  /** The next request that matches reaches the server and is carried out - and
   *  its response is thrown away, so the engine sees a network failure. This is
   *  a lost response: the write happened, and the client cannot know. `times`
   *  loses that many matching responses in a row. */
  loseNextResponse(match: (request: RequestLog) => boolean, times?: number): void
  /** Holds the next request that matches until `release()`; `reached` resolves once it is waiting. */
  hold(match: (request: RequestLog) => boolean): { reached: Promise<void>; release(): void }
  /** Stops everything and closes the database. */
  stop(): Promise<void>
}

export type RigOptions = {
  /** Open the change feed. Default true. */
  socket?: boolean
  /** Start the engine (hydrate and drain). Default true. */
  start?: boolean
  /** Reuse a database (to start a second engine on the same disk). */
  db?: SyncDb
}

let dbCount = 0

export async function startClient(account: Account, options: RigOptions = {}): Promise<Rig> {
  const db = options.db ?? (await openSyncDb(`sync-test-${++dbCount}-${Math.random().toString(36).slice(2)}`))
  const net = manualConnectivity()
  const tab = manualVisibility()
  const requests: RequestLog[] = []
  const frames: Rig['frames'] = []
  let networkDown = false
  let held: Hold | null = null
  let losing: { match: (request: RequestLog) => boolean; left: number } | null = null

  const api = createClient<paths>({
    baseUrl: baseUrl(),
    fetch: async (request) => {
      if (networkDown) throw new TypeError('fetch failed (network down in the test)')
      const body = request.method === 'GET' ? null : await request.clone().json().catch(() => null)
      const entry: RequestLog = {
        method: request.method,
        path: new URL(request.url).pathname,
        ifMatch: request.headers.get('If-Match'),
        idempotencyKey: request.headers.get('Idempotency-Key'),
        body,
      }
      requests.push(entry)
      if (held?.match(entry)) {
        const hold = held
        held = null
        hold.markSeen()
        await hold.gate
      }
      // The cookie is read per request, so a login in the middle of a test is
      // picked up by the next one - what the browser's cookie jar does.
      const headers = new Headers(request.headers)
      headers.set('Cookie', account.cookie())
      const response = await fetch(new Request(request, { headers }))
      if (losing?.match(entry)) {
        if (--losing.left <= 0) losing = null
        // The server has answered; the client never hears.
        await response.arrayBuffer()
        throw new TypeError('fetch failed (the response was lost in the test)')
      }
      return response
    },
  })

  const engine = createSyncEngine({
    db,
    api,
    accountId: account.accountId,
    connectivity: net.connectivity,
    // The defaults (1s growing to 60s) would make every deliberate failure a
    // long wait. The ratio is what matters, not the numbers.
    backoff: { baseMs: 40, maxMs: 200 },
  })

  // The cookie and Origin a browser would send on its own. The server refuses
  // an upgrade whose Origin host differs from Host, so this is the same origin.
  const origin = new URL(baseUrl()).origin
  const opened: WebSocket[] = []
  class AuthedWebSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { Cookie: account.cookie(), Origin: origin } })
      opened.push(this)
    }
  }

  let socket: RealtimeSocket | null = null
  let connection: ConnectionState = 'offline'
  if (options.socket !== false) {
    socket = createSocket({
      url: `${origin.replace(/^http/, 'ws')}/api/v1/ws`,
      WebSocketImpl: AuthedWebSocket as unknown as SocketClass,
      connectivity: net.connectivity,
      visibility: tab.visibility,
      backoff: { baseMs: 40, maxMs: 200 },
      onEvent: (frame) => {
        frames.push({ frame: frame as Rig['frames'][number]['frame'], changed: engine.applyRemote(frame) })
      },
      // The same rule as store.ts: nothing replays, so a socket that comes
      // (back) up lists again - except the very first one when the first
      // hydration is still the list.
      onOpen: ({ first }) => {
        const { hydration } = engine.status()
        if (first && (hydration === 'idle' || hydration === 'running')) return
        void engine.hydrate()
      },
      onStateChange: (next) => {
        connection = next
      },
    })
  }
  // A 401 parks the engine; a socket opened now would be refused too.
  engine.subscribe(() => socket?.setPaused(engine.status().paused))

  if (options.start !== false) {
    engine.start()
    socket?.start()
    await engine.idle()
  }

  return {
    engine,
    db,
    socket,
    requests,
    frames,
    connection: () => connection,
    goOffline: () => net.goOffline(),
    goOnline: () => net.goOnline(),
    dropConnection: () => opened.at(-1)?.terminate(),
    setNetworkDown: (down) => {
      networkDown = down
    },
    loseNextResponse(match, times = 1) {
      losing = { match, left: times }
    },
    hold(match) {
      let release!: () => void
      let markSeen!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const seen = new Promise<void>((resolve) => (markSeen = resolve))
      held = { match, gate, seen, markSeen }
      return { reached: seen, release }
    },
    async stop() {
      socket?.stop()
      await engine.stop()
      db.close()
    },
  }
}

// ── reading the local side ──────────────────────────────────────────────────

export async function localTicket(rig: Rig, id: string): Promise<Ticket | undefined> {
  return (await rig.db.snapshot()).tickets.find((ticket) => ticket.id === id)
}

export async function outbox(rig: Rig): Promise<OutboxEntry[]> {
  return (await rig.db.snapshot()).outbox
}

/** Polls until `read` returns something other than undefined/false. The engine
 *  works in the background and the server is over a socket, so "eventually" is
 *  the honest assertion; the timeout is what fails a test that never gets there. */
export async function eventually<T>(label: string, read: () => Promise<T | undefined | false> | T | undefined | false, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error(`timed out after ${ms}ms waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
