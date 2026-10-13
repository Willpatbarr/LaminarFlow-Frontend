import { afterEach, describe, expect, it } from 'vitest'

import { eventually, localTicket, outbox, startClient, type Rig } from './support/rig'
import {
  fields,
  newAccount,
  newWorld,
  serverArchive,
  serverCreate,
  serverTicket,
  serverTickets,
  serverUpdate,
} from './support/stack'

// Two people editing the same ticket, one of them through the engine. The
// engine has to park the loser with the server's copy and who changed it -
// the data the conflict screen is built from - and never overwrite the winner.
// No change feed here (socket: false): the engine must not know about the
// other account's change until the server tells it, by refusing the write.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

/** Account `me` with a synced ticket (version 1), and `other`, who can change it behind `me`'s back. */
async function scene() {
  const me = await newAccount('me')
  const other = await newAccount('other')
  const world = await newWorld(me)
  const created = await serverCreate(other, world.projectId, fields('Original', { description: 'd0', status_id: world.statusIds[0] }))
  const rig = await startClient(me, { socket: false })
  rigs.push(rig)
  expect(await localTicket(rig, created.id)).toMatchObject({ title: 'Original', version: 1 })
  return { me, other, world, rig, ticket: created }
}

describe('a stale edit', () => {
  it('is parked as a conflict carrying the server\'s copy, who changed it and when', async () => {
    const { me, other, rig, ticket } = await scene()
    const theirs = await serverUpdate(other, ticket.id, 1, fields('Theirs', { description: 'by other' }))
    expect(theirs.version).toBe(2)

    await rig.engine.updateTicket(ticket.id, { title: 'Mine' })
    await rig.engine.idle()

    const [entry] = await outbox(rig)
    expect(entry).toMatchObject({ kind: 'update', state: 'conflict', ticket_id: ticket.id, base_version: 1 })
    expect(entry.error).toBeNull()
    expect(entry.conflict).toMatchObject({
      code: 'ticket_conflict',
      current: { id: ticket.id, title: 'Theirs', description: 'by other', version: 2, updated_by: other.accountId },
      changed_by: { account_id: other.accountId, display_name: other.displayName },
    })
    expect(entry.conflict?.changed_at).toBe(theirs.updated_at)

    // The server kept their version; the user's edit is still on screen.
    expect(await serverTicket(me, ticket.id)).toMatchObject({ title: 'Theirs', version: 2 })
    expect((await localTicket(rig, ticket.id))?.title).toBe('Mine')
    // And it was refused, not retried forever: one attempt was made.
    expect(rig.requests.filter((r) => r.method === 'PUT')).toHaveLength(1)
  })

  it('on keep-as-new becomes a second ticket on the server and leaves the original as the other person made it', async () => {
    const { me, other, world, rig, ticket } = await scene()
    await serverUpdate(other, ticket.id, 1, fields('Theirs'))
    await rig.engine.updateTicket(ticket.id, { title: 'Mine', description: 'my words' })
    await rig.engine.idle()
    const [entry] = await outbox(rig)
    expect(entry.state).toBe('conflict')

    const tempId = await rig.engine.keepAsNew(entry.id)
    expect(tempId).not.toBeNull()
    await rig.engine.idle()

    expect(await outbox(rig)).toEqual([])
    const onServer = await serverTickets(me, world.projectId)
    expect(onServer).toHaveLength(2)
    const original = onServer.find((t) => t.id === ticket.id)
    const copy = onServer.find((t) => t.id !== ticket.id)
    expect(original).toMatchObject({ title: 'Theirs', version: 2 })
    expect(copy).toMatchObject({ title: 'Mine', description: 'my words', project_id: world.projectId, version: 1 })

    // Locally the same two rows, and no stray temporary one.
    const local = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(local.map((t) => [t.id, t.title, t.version]).sort()).toEqual(
      [
        [ticket.id, 'Theirs', 2],
        [copy!.id, 'Mine', 1],
      ].sort(),
    )
  })

  it('on retry ("mine wins") is resent on the server\'s current version and lands as version 3', async () => {
    const { me, other, rig, ticket } = await scene()
    await serverUpdate(other, ticket.id, 1, fields('Theirs'))
    await rig.engine.updateTicket(ticket.id, { title: 'Mine' })
    await rig.engine.idle()
    const [entry] = await outbox(rig)

    expect(await rig.engine.retry(entry.id)).toBe(true)
    await rig.engine.idle()

    const puts = rig.requests.filter((r) => r.method === 'PUT')
    expect(puts.map((r) => r.ifMatch)).toEqual(['"1"', '"2"'])
    expect(await outbox(rig)).toEqual([])
    expect(await serverTicket(me, ticket.id)).toMatchObject({ title: 'Mine', version: 3 })
    expect(await localTicket(rig, ticket.id)).toMatchObject({ title: 'Mine', version: 3 })
  })

  it('on discard goes back to the server\'s copy', async () => {
    const { other, rig, ticket } = await scene()
    await serverUpdate(other, ticket.id, 1, fields('Theirs'))
    await rig.engine.updateTicket(ticket.id, { title: 'Mine' })
    await rig.engine.idle()
    const [entry] = await outbox(rig)

    expect(await rig.engine.discard(entry.id)).toBe(true)
    expect(await outbox(rig)).toEqual([])
    expect(await localTicket(rig, ticket.id)).toMatchObject({ title: 'Theirs', version: 2 })
  })
})

describe('a ticket archived underneath', () => {
  it('parks an edit as ticket_archived, with the archived copy and who archived it', async () => {
    const { me, other, rig, ticket } = await scene()
    await serverArchive(other, ticket.id, 1)

    await rig.engine.updateTicket(ticket.id, { title: 'Too late' })
    await rig.engine.idle()

    const [entry] = await outbox(rig)
    expect(entry).toMatchObject({ kind: 'update', state: 'conflict' })
    expect(entry.conflict).toMatchObject({
      code: 'ticket_archived',
      current: { id: ticket.id, title: 'Original' },
      changed_by: { account_id: other.accountId, display_name: other.displayName },
    })
    expect(entry.conflict?.current.version).toBeGreaterThan(1)
    expect(entry.conflict?.changed_at).toBeTruthy()
    // Archived is archived: the edit did not bring it back.
    expect(await serverTicket(me, ticket.id)).toBeNull()
    // The user's edit is still reachable on screen.
    expect((await localTicket(rig, ticket.id))?.title).toBe('Too late')
  })

  it('keeps an archive that collides with someone else\'s edit rather than archiving over it', async () => {
    const { me, other, rig, ticket } = await scene()
    await serverUpdate(other, ticket.id, 1, fields('Edited meanwhile'))

    await rig.engine.archiveTicket(ticket.id)
    await rig.engine.idle()

    const [entry] = await outbox(rig)
    expect(entry).toMatchObject({ kind: 'archive', state: 'conflict' })
    expect(entry.conflict).toMatchObject({ code: 'ticket_conflict', current: { title: 'Edited meanwhile', version: 2 } })
    expect(await serverTicket(me, ticket.id)).toMatchObject({ title: 'Edited meanwhile' })
    // Not removed from the screen: its page is where the user decides.
    expect(await localTicket(rig, ticket.id)).toBeDefined()
  })

  it('cannot be kept as new (an archive has no version of the user\'s to keep)', async () => {
    const { rig, ticket, other } = await scene()
    await serverUpdate(other, ticket.id, 1, fields('Edited meanwhile'))
    await rig.engine.archiveTicket(ticket.id)
    await rig.engine.idle()
    const [entry] = await eventually('the archive is parked', async () => {
      const entries = await outbox(rig)
      return entries.length > 0 ? entries : undefined
    })
    expect(await rig.engine.keepAsNew(entry.id)).toBeNull()
  })
})
