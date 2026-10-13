import { afterEach, describe, expect, it } from 'vitest'

import { eventually, localTicket, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverArchive, serverCreate, serverUpdate } from './support/stack'

// The change feed, for real: a second account writes over HTTP, the server
// publishes, a `ws` connection carrying the first account's cookie and an
// Origin receives it, and the first engine's local store changes.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

async function scene() {
  const me = await newAccount('me')
  const other = await newAccount('other')
  const world = await newWorld(me)
  const rig = await startClient(me)
  rigs.push(rig)
  // `hello` is what makes it live; nothing before it is trusted.
  await eventually('the socket is live', () => rig.connection() === 'live' || undefined)
  return { me, other, world, rig }
}

describe('another account\'s changes', () => {
  it('arrive over the socket and land in the local store: created, updated, archived', async () => {
    const { other, world, rig } = await scene()

    const created = await serverCreate(other, world.projectId, fields('From elsewhere', { status_id: world.statusIds[0] }))
    const arrived = await eventually('the new ticket appears', () => localTicket(rig, created.id))
    expect(arrived).toMatchObject({ title: 'From elsewhere', version: 1, updated_by: other.accountId })

    await serverUpdate(other, created.id, 1, fields('Renamed elsewhere', { status_id: world.statusIds[1] }))
    const renamed = await eventually('the edit appears', async () => {
      const row = await localTicket(rig, created.id)
      return row?.version === 2 ? row : undefined
    })
    expect(renamed).toMatchObject({ title: 'Renamed elsewhere', status_id: world.statusIds[1] })

    await serverArchive(other, created.id, 2)
    await eventually('the archived ticket is removed', async () => (await localTicket(rig, created.id)) === undefined || undefined)
    expect((await rig.db.snapshot()).tickets.some((t) => t.id === created.id)).toBe(false)

    // All three came as frames the server addressed to this connection, and
    // each one changed something.
    const mine = rig.frames.filter((f) => f.frame.ticket_id === created.id)
    expect(mine.map((f) => f.frame.type)).toEqual(['ticket.created', 'ticket.updated', 'ticket.archived'])
    expect(await Promise.all(mine.map((f) => f.changed))).toEqual([true, true, true])
  })

  it('apply on top of a local edit without losing it', async () => {
    const { other, world, rig } = await scene()
    const created = await serverCreate(other, world.projectId, fields('Shared', { status_id: world.statusIds[0] }))
    await eventually('the ticket appears', () => localTicket(rig, created.id))

    // Held on the wire: the user's edit is unsent while the other change arrives.
    const hold = rig.hold((r) => r.method === 'PUT')
    await rig.engine.updateTicket(created.id, { title: 'Mine' })
    await hold.reached
    await serverUpdate(other, created.id, 1, fields('Theirs'))
    await eventually('their frame was received', () => rig.frames.some((f) => f.frame.version === 2 && f.frame.ticket_id === created.id) || undefined)
    hold.release()
    await rig.engine.idle()

    // Mine was made on version 1 and theirs got to 2 first: a real conflict,
    // parked with their copy, and the screen still shows what the user typed.
    const entries = (await rig.db.snapshot()).outbox
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ state: 'conflict', conflict: { code: 'ticket_conflict', current: { title: 'Theirs', version: 2 } } })
    expect((await localTicket(rig, created.id))?.title).toBe('Mine')
  })
})

describe('this client\'s own writes', () => {
  it('come back over the socket as echoes that change nothing and do not duplicate the row', async () => {
    const { me, world, rig } = await scene()

    const local = await rig.engine.createTicket({ project_id: world.projectId, ...fields('Mine, created here') })
    await rig.engine.idle()
    const [row] = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(row.id).not.toBe(local.id)

    await rig.engine.updateTicket(row.id, { title: 'Mine, edited here' })
    await rig.engine.idle()

    // The server published both writes to every connection, ours included.
    await eventually('both echoes arrived', () => rig.frames.filter((f) => f.frame.ticket_id === row.id).length >= 2 || undefined)
    const echoes = rig.frames.filter((f) => f.frame.ticket_id === row.id)
    expect(echoes.map((f) => [f.frame.type, f.frame.version, f.frame.actor_id])).toEqual([
      ['ticket.created', 1, me.accountId],
      ['ticket.updated', 2, me.accountId],
    ])
    // None of them was news.
    expect(await Promise.all(echoes.map((f) => f.changed))).toEqual([false, false])

    const rows = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: row.id, title: 'Mine, edited here', version: 2 })
    expect((await rig.db.snapshot()).outbox).toEqual([])
  })

  it('also arrive at a second device of the same account, which does apply them', async () => {
    const { me, world, rig } = await scene()
    const second = await startClient(me)
    rigs.push(second)
    await eventually('the second socket is live', () => second.connection() === 'live' || undefined)

    await rig.engine.createTicket({ project_id: world.projectId, ...fields('Typed on the laptop') })
    await rig.engine.idle()

    const seen = await eventually('the phone shows it', async () => {
      const rows = (await second.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
      return rows.length === 1 ? rows[0] : undefined
    })
    expect(seen).toMatchObject({ title: 'Typed on the laptop', version: 1 })
  })
})
