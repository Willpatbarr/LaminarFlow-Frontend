import { afterEach, describe, expect, it } from 'vitest'

import { isTempId } from '@/sync/types'

import { eventually, localTicket, outbox, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverTicket, serverTickets, type World } from './support/stack'

// Writes made through the engine, answered by the real server: the reconcile
// path that a stubbed fetch can only imitate. The question each test asks is
// the one a reconciliation bug would get wrong - does the local row, the
// outbox and the server end up agreeing?

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

async function setup(options: Parameters<typeof startClient>[1] = { socket: false }) {
  const me = await newAccount('me')
  const world = await newWorld(me)
  const rig = await startClient(me, options)
  rigs.push(rig)
  return { me, world, rig }
}

function newTicket(world: World, title: string) {
  return { project_id: world.projectId, ...fields(title, { description: 'made offline-first', status_id: world.statusIds[0] }) }
}

/** Creates through the engine and waits for the server's answer. */
async function createSynced(rig: Rig, world: World, title: string) {
  const swaps: { from: string; to: string }[] = []
  const off = rig.engine.subscribe((change) => {
    if (change.swap) swaps.push(change.swap)
  })
  const local = await rig.engine.createTicket(newTicket(world, title))
  await rig.engine.idle()
  off()
  return { local, swaps }
}

describe('create', () => {
  it('shows the ticket at once under a temporary id, then swaps in the server id at version 1', async () => {
    const { me, world, rig } = await setup()

    const swaps: { from: string; to: string }[] = []
    rig.engine.subscribe((change) => {
      if (change.swap) swaps.push(change.swap)
    })
    const local = await rig.engine.createTicket(newTicket(world, 'First ticket'))

    // Before any answer: the user's row exists, at version 0, under an id only this client knows.
    expect(isTempId(local.id)).toBe(true)
    expect(local.version).toBe(0)
    expect((await localTicket(rig, local.id))?.title).toBe('First ticket')

    await rig.engine.idle()

    expect(swaps).toHaveLength(1)
    expect(swaps[0].from).toBe(local.id)
    const realId = swaps[0].to
    expect(isTempId(realId)).toBe(false)

    const snapshot = await rig.db.snapshot()
    expect(snapshot.outbox).toEqual([])
    expect(snapshot.tickets.filter((t) => t.project_id === world.projectId)).toHaveLength(1)
    expect(await localTicket(rig, local.id)).toBeUndefined()
    const row = await localTicket(rig, realId)
    expect(row).toMatchObject({
      id: realId,
      title: 'First ticket',
      description: 'made offline-first',
      status_id: world.statusIds[0],
      version: 1,
      updated_by: me.accountId,
    })

    // And the server agrees, field for field.
    const onServer = await serverTicket(me, realId)
    expect(onServer).toMatchObject({ id: realId, title: 'First ticket', version: 1, project_id: world.projectId })
    expect(row?.updated_at).toBe(onServer?.updated_at)
  })
})

describe('update', () => {
  it('sends the version it was made on in If-Match and takes the server\'s new version back', async () => {
    const { me, world, rig } = await setup()
    const { swaps } = await createSynced(rig, world, 'Before')
    const id = swaps[0].to

    expect(await rig.engine.updateTicket(id, { title: 'After', description: 'edited' })).toBe(true)
    // Optimistic: on screen before the server has said anything.
    expect((await localTicket(rig, id))?.title).toBe('After')
    await rig.engine.idle()

    const put = rig.requests.filter((r) => r.method === 'PUT' && r.path === `/api/v1/tickets/${id}`)
    expect(put).toHaveLength(1)
    expect(put[0].ifMatch).toBe('"1"')
    expect(put[0].body).toMatchObject({ title: 'After', description: 'edited' })

    expect(await outbox(rig)).toEqual([])
    const row = await localTicket(rig, id)
    expect(row).toMatchObject({ title: 'After', description: 'edited', version: 2 })
    const onServer = await serverTicket(me, id)
    expect(onServer).toMatchObject({ title: 'After', description: 'edited', version: 2 })
    expect(row?.updated_at).toBe(onServer?.updated_at)
  })

  it('sends two edits queued behind one another in order, each on the version the last one produced', async () => {
    const { me, world, rig } = await setup()
    const { swaps } = await createSynced(rig, world, 'v1')
    const id = swaps[0].to

    // The first edit is on the wire (held), so the second cannot be folded into
    // it and has to queue behind it with a base version it does not know yet.
    const first = rig.hold((r) => r.method === 'PUT')
    await rig.engine.updateTicket(id, { title: 'v2' })
    await first.reached
    await rig.engine.updateTicket(id, { title: 'v3' })
    expect((await outbox(rig)).map((e) => [e.kind, e.state])).toEqual([
      ['update', 'pending'],
      ['update', 'pending'],
    ])
    first.release()
    await rig.engine.idle()

    const puts = rig.requests.filter((r) => r.method === 'PUT')
    expect(puts.map((r) => r.ifMatch)).toEqual(['"1"', '"2"'])
    expect(puts.map((r) => (r.body as { title: string }).title)).toEqual(['v2', 'v3'])

    expect(await outbox(rig)).toEqual([])
    expect(await localTicket(rig, id)).toMatchObject({ title: 'v3', version: 3 })
    expect(await serverTicket(me, id)).toMatchObject({ title: 'v3', version: 3 })
  })
})

describe('queued behind a create', () => {
  it('addresses an edit made under the temporary id to the real ticket, on the version the create returned', async () => {
    const { me, world, rig } = await setup()

    const create = rig.hold((r) => r.method === 'POST' && r.path === '/api/v1/tickets')
    const local = await rig.engine.createTicket(newTicket(world, 'Typed fast'))
    await create.reached
    // The id this edit names does not exist on the server yet, and the version
    // it was made on is not known until the create is answered.
    await rig.engine.updateTicket(local.id, { title: 'Typed fast, then fixed' })
    create.release()
    await rig.engine.idle()

    const sent = rig.requests.filter((r) => r.path.startsWith('/api/v1/tickets') && !r.path.endsWith('/list') && r.method !== 'GET').map((r) => [r.method, r.ifMatch])
    expect(sent).toEqual([
      ['POST', null],
      ['PUT', '"1"'],
    ])
    expect(await outbox(rig)).toEqual([])
    const onServer = await serverTickets(me, world.projectId)
    expect(onServer.map((t) => [t.title, t.version])).toEqual([['Typed fast, then fixed', 2]])
    const rows = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(rows.map((t) => [t.id, t.title, t.version])).toEqual([[onServer[0].id, 'Typed fast, then fixed', 2]])
  })
})

describe('archive', () => {
  it('hides the ticket at once, sends the version it was made on, and the server stops listing it', async () => {
    const { me, world, rig } = await setup()
    const { swaps } = await createSynced(rig, world, 'To archive')
    const id = swaps[0].to

    expect(await rig.engine.archiveTicket(id)).toBe(true)
    expect(await localTicket(rig, id)).toBeUndefined()
    await rig.engine.idle()

    const del = rig.requests.filter((r) => r.method === 'DELETE')
    expect(del.map((r) => [r.path, r.ifMatch])).toEqual([[`/api/v1/tickets/${id}`, '"1"']])
    expect(await outbox(rig)).toEqual([])
    expect(await localTicket(rig, id)).toBeUndefined()
    expect(await serverTicket(me, id)).toBeNull()
    expect(await serverTickets(me, world.projectId)).toEqual([])
  })
})

describe('offline', () => {
  it('keeps a create and an edit while the browser is offline, and sends both when it is back', async () => {
    const { me, world, rig } = await setup()
    const { swaps } = await createSynced(rig, world, 'Already synced')
    const existing = swaps[0].to
    const sentBefore = rig.requests.length

    rig.goOffline()
    rig.setNetworkDown(true)
    const created = await rig.engine.createTicket(newTicket(world, 'Made on the train'))
    await rig.engine.updateTicket(existing, { title: 'Edited on the train' })
    await rig.engine.idle()

    // Everything is on screen and nothing has gone anywhere.
    expect(rig.requests.length).toBe(sentBefore)
    expect((await outbox(rig)).map((e) => e.kind)).toEqual(['create', 'update'])
    expect((await localTicket(rig, created.id))?.title).toBe('Made on the train')
    expect((await localTicket(rig, existing))?.title).toBe('Edited on the train')
    expect((await serverTickets(me, world.projectId)).map((t) => t.title)).toEqual(['Already synced'])

    rig.setNetworkDown(false)
    rig.goOnline()
    await rig.engine.idle()

    expect(await outbox(rig)).toEqual([])
    const titles = (await serverTickets(me, world.projectId)).map((t) => t.title).sort()
    expect(titles).toEqual(['Edited on the train', 'Made on the train'])
    expect(await localTicket(rig, created.id)).toBeUndefined()
    const local = (await rig.db.snapshot()).tickets.filter((t) => t.project_id === world.projectId)
    expect(local.map((t) => [t.title, t.version]).sort()).toEqual([
      ['Edited on the train', 2],
      ['Made on the train', 1],
    ])
  })

  it('retries on its own backoff when the network fails under a browser that thinks it is online', async () => {
    const { me, world, rig } = await setup()
    const { swaps } = await createSynced(rig, world, 'Steady')
    const id = swaps[0].to

    rig.setNetworkDown(true)
    await rig.engine.updateTicket(id, { title: 'Sent into the void' })
    // No response at all says nothing about the entry: it stays pending (not
    // parked), counted, with the failure recorded as status 0.
    const [entry] = await eventually('a failed attempt is recorded', async () => {
      const entries = await outbox(rig)
      return entries[0]?.attempts >= 1 ? entries : undefined
    })
    expect(entry).toMatchObject({ state: 'pending', error: { status: 0, code: 'network' } })
    expect((await serverTicket(me, id))?.title).toBe('Steady')

    rig.setNetworkDown(false)
    await eventually('the backoff retry drains the outbox', async () => (await outbox(rig)).length === 0 || undefined)
    expect(await serverTicket(me, id)).toMatchObject({ title: 'Sent into the void', version: 2 })
    expect(await localTicket(rig, id)).toMatchObject({ title: 'Sent into the void', version: 2 })
  })
})
