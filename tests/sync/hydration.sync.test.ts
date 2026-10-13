import { afterEach, describe, expect, it } from 'vitest'

import { eventually, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverArchive, serverCreate, serverTickets } from './support/stack'

// Hydration is "list everything, then replace what is local with it". The
// dangerous parts are the ends: stopping after the first page (silently
// dropping the rest), and never removing what someone else archived.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

/** The server's ticket list endpoint caps a page at 200, which is also what the client asks for. */
const MORE_THAN_A_PAGE = 205

describe('hydration', () => {
  it('reads every page of a list longer than one', async () => {
    const me = await newAccount('me')
    const world = await newWorld(me)
    const made: string[] = []
    // A few at a time: 205 sequential round trips would be slow for no reason.
    for (let start = 0; start < MORE_THAN_A_PAGE; start += 15) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(15, MORE_THAN_A_PAGE - start) }, (_, i) =>
          serverCreate(me, world.projectId, fields(`Ticket ${start + i}`, { status_id: world.statusIds[0] })),
        ),
      )
      made.push(...batch.map((t) => t.id))
    }

    const rig = await startClient(me, { socket: false })
    rigs.push(rig)

    const lists = rig.requests.filter((r) => r.path === '/api/v1/tickets/list')
    expect(lists.length).toBeGreaterThanOrEqual(2)
    expect(lists[0].body).not.toHaveProperty('cursor')
    expect((lists[1].body as { cursor?: string }).cursor).toBeTruthy()

    const local = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(local).toHaveLength(MORE_THAN_A_PAGE)
    expect(new Set(local.map((t) => t.id))).toEqual(new Set(made))
    expect(local.every((t) => t.version === 1)).toBe(true)

    // The rest of the picture came with it.
    const snapshot = await rig.db.snapshot()
    expect(snapshot.projects.map((p) => p.id)).toContain(world.projectId)
    expect(snapshot.teams.map((t) => t.id)).toContain(world.teamId)
    expect(snapshot.statuses.filter((s) => s.team_id === world.teamId).map((s) => s.id).sort()).toEqual([...world.statusIds].sort())
    expect(rig.engine.status()).toMatchObject({ hydrated: true, hydration: 'done' })
  }, 120_000)

  it('removes a ticket another account archived while this client was not listening', async () => {
    const me = await newAccount('me')
    const other = await newAccount('other')
    const world = await newWorld(me)
    const keep = await serverCreate(other, world.projectId, fields('Stays'))
    const doomed = await serverCreate(other, world.projectId, fields('Goes'))

    const rig = await startClient(me, { socket: false })
    rigs.push(rig)
    expect((await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)).toHaveLength(2)

    await serverArchive(other, doomed.id, 1)
    expect(await rig.engine.hydrate()).toBe(true)

    const snapshot = await rig.db.snapshot()
    expect(snapshot.tickets.filter((t) => t.project_id === world.projectId).map((t) => t.id)).toEqual([keep.id])
    expect(await serverTickets(me, world.projectId).then((rows) => rows.map((t) => t.id))).toEqual([keep.id])
  })

  it('picks up what changed while the socket was down, by listing when it reconnects', async () => {
    const me = await newAccount('me')
    const other = await newAccount('other')
    const world = await newWorld(me)
    const rig = await startClient(me)
    rigs.push(rig)
    await eventually('the socket is live', () => rig.connection() === 'live' || undefined)

    // The connection drops while the browser is offline, so the socket cannot
    // come straight back, and a change is made in the meantime. Nothing replays
    // what a closed socket missed: only listing again can find it.
    rig.goOffline()
    rig.dropConnection()
    await eventually('the socket notices', () => (rig.connection() === 'offline' ? true : undefined))
    const made = await serverCreate(other, world.projectId, fields('Made while away'))
    const listsBefore = rig.requests.filter((r) => r.path === '/api/v1/tickets/list').length

    rig.goOnline()
    const arrived = await eventually('the missed ticket is found', async () =>
      (await rig.db.snapshot()).tickets.find((t) => t.id === made.id),
    )
    expect(rig.requests.filter((r) => r.path === '/api/v1/tickets/list').length).toBeGreaterThan(listsBefore)
    expect(rig.frames.some((f) => f.frame.ticket_id === made.id)).toBe(false)
    expect(arrived.title).toBe('Made while away')
  })
})
