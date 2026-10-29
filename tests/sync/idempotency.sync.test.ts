import { afterEach, describe, expect, it } from 'vitest'

import { eventually, localTicket, outbox, startClient, type Rig, type RequestLog } from './support/rig'
import { fields, must, newAccount, newWorld, serverArchive, serverTickets, serverUpdate, type World } from './support/stack'

// A create whose response is lost (LAM-76), against the real server. The
// question: does the retry make a second ticket, and does it reconcile to the
// one that exists - in the state it is in NOW, which may not be the state the
// first attempt created.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

async function setup() {
  const me = await newAccount('me')
  const other = await newAccount('other')
  const world = await newWorld(me)
  const rig = await startClient(me, { socket: false })
  rigs.push(rig)
  return { me, other, world, rig }
}

const newTicket = (world: World, title: string) => ({
  project_id: world.projectId,
  ...fields(title, { description: 'made offline-first', status_id: world.statusIds[0] }),
})

const isCreate = (r: RequestLog) => r.method === 'POST' && r.path === '/api/v1/tickets'

/** Creates a ticket whose response never arrives. Resolves when the first
 *  attempt has been made and the retry is on the wire, held - so the test can
 *  do what it likes to the ticket on the server before the retry reaches it. */
async function createWithLostResponse(rig: Rig, world: World, title: string) {
  rig.loseNextResponse(isCreate)
  const local = await rig.engine.createTicket(newTicket(world, title))
  await rig.engine.idle()
  // The first attempt has failed and nothing else has happened: the 40ms
  // backoff cannot fire between the engine going idle and this line.
  const retry = rig.hold(isCreate)
  return { local, retry }
}

describe('a create whose response is lost', () => {
  it('is retried and yields exactly one ticket on the server, with the same key both times', async () => {
    const { me, world, rig } = await setup()
    rig.loseNextResponse(isCreate)

    const local = await rig.engine.createTicket(newTicket(world, 'Only once'))
    await rig.engine.idle()

    // The server has it, and the client does not know.
    expect(await serverTickets(me, world.projectId)).toHaveLength(1)
    expect(await outbox(rig)).toMatchObject([{ kind: 'create', attempts: 1, state: 'pending' }])

    await eventually('the retry is answered', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    const posts = rig.requests.filter(isCreate)
    expect(posts).toHaveLength(2)
    expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey)

    const onServer = await serverTickets(me, world.projectId)
    expect(onServer.map((t) => [t.title, t.version])).toEqual([['Only once', 1]])
    // Reconciled as a normal create: the temporary row is gone, the real one is here.
    expect(await localTicket(rig, local.id)).toBeUndefined()
    expect(await localTicket(rig, onServer[0].id)).toMatchObject({ title: 'Only once', version: 1 })
  })

  it('does not make a second ticket however many answers are lost, and every attempt carries the one key', async () => {
    const { me, world, rig } = await setup()
    rig.loseNextResponse(isCreate, 3)

    await rig.engine.createTicket(newTicket(world, 'Persistent'))
    await eventually('answered on the fourth attempt', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    const posts = rig.requests.filter(isCreate)
    expect(posts).toHaveLength(4)
    expect(new Set(posts.map((r) => r.idempotencyKey)).size).toBe(1)
    expect(await serverTickets(me, world.projectId)).toHaveLength(1)
  })

  it('reconciles to what another account did to the ticket in the meantime', async () => {
    const { me, other, world, rig } = await setup()
    const { local, retry } = await createWithLostResponse(rig, world, 'As created')
    await retry.reached

    const [created] = await serverTickets(me, world.projectId)
    await serverUpdate(other, created.id, created.version, fields('Edited by someone else', { description: 'their words', status_id: world.statusIds[1] }))
    retry.release()
    await eventually('reconciled', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    // The replay answered with the ticket as it is NOW, and that is what is shown.
    expect(await localTicket(rig, created.id)).toMatchObject({
      title: 'Edited by someone else',
      description: 'their words',
      status_id: world.statusIds[1],
      version: 2,
    })
    expect(await localTicket(rig, local.id)).toBeUndefined()
    expect(await serverTickets(me, world.projectId)).toHaveLength(1)
  })

  it('sends an edit made while the create was in doubt on the version the replay returned', async () => {
    const { me, other, world, rig } = await setup()
    const { local, retry } = await createWithLostResponse(rig, world, 'As created')
    // Queued behind the create: the first attempt may have landed, so the edit
    // is not folded into a request whose body the server would ignore.
    await rig.engine.updateTicket(local.id, { title: 'Mine, typed after' })
    await retry.reached

    const [created] = await serverTickets(me, world.projectId)
    await serverUpdate(other, created.id, created.version, fields('Theirs'))
    retry.release()
    await eventually('both sent', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    const puts = rig.requests.filter((r) => r.method === 'PUT')
    expect(puts.map((r) => [r.path, r.ifMatch])).toEqual([[`/api/v1/tickets/${created.id}`, '"2"']])
    const onServer = await serverTickets(me, world.projectId)
    expect(onServer.map((t) => [t.title, t.version])).toEqual([['Mine, typed after', 3]])
    expect(await localTicket(rig, created.id)).toMatchObject({ title: 'Mine, typed after', version: 3 })
  })

  describe('and the ticket was archived by someone else before the retry', () => {
    it('is "created, then archived": nothing is left parked and the local row is gone', async () => {
      const { me, other, world, rig } = await setup()
      const { local, retry } = await createWithLostResponse(rig, world, 'Short-lived')
      await retry.reached

      const [created] = await serverTickets(me, world.projectId)
      await serverArchive(other, created.id, created.version)
      retry.release()
      await eventually('resolved', async () => ((await outbox(rig)).length === 0 ? true : undefined))

      const snapshot = await rig.db.snapshot()
      expect(snapshot.outbox).toEqual([])
      expect(snapshot.tickets.filter((t) => t.project_id === world.projectId)).toEqual([])
      expect(await localTicket(rig, local.id)).toBeUndefined()
      // The create DID land, and was archived: no second ticket, none live.
      expect(await serverTickets(me, world.projectId)).toEqual([])
      expect(rig.requests.filter(isCreate)).toHaveLength(2)
    })

    it('parks edits queued behind it as the archived conflict, and "keep mine as new" makes exactly one new ticket under a new key', async () => {
      const { me, other, world, rig } = await setup()
      const { local, retry } = await createWithLostResponse(rig, world, 'Short-lived')
      await rig.engine.updateTicket(local.id, { title: 'Mine, typed after' })
      await retry.reached

      const [created] = await serverTickets(me, world.projectId)
      await serverArchive(other, created.id, created.version)
      retry.release()
      const [parked] = await eventually('parked', async () => {
        const entries = await outbox(rig)
        return entries[0]?.state === 'conflict' ? entries : undefined
      })

      expect(parked).toMatchObject({
        kind: 'update',
        entity_id: created.id,
        conflict: { code: 'ticket_archived', changed_by: { account_id: other.accountId } },
      })
      expect(await localTicket(rig, created.id)).toMatchObject({ title: 'Mine, typed after' })
      expect(rig.requests.filter((r) => r.method === 'PUT')).toHaveLength(0)

      const copy = await rig.engine.keepAsNew(parked.id)
      expect(copy).not.toBeNull()
      await rig.engine.idle()
      await eventually('the copy is sent', async () => ((await outbox(rig)).length === 0 ? true : undefined))

      const posts = rig.requests.filter(isCreate)
      expect(posts).toHaveLength(3)
      expect(posts[2].idempotencyKey).not.toBe(posts[0].idempotencyKey)
      const live = await serverTickets(me, world.projectId)
      expect(live.map((t) => t.title)).toEqual(['Mine, typed after'])
      expect(live[0].id).not.toBe(created.id)
      expect(await localTicket(rig, created.id)).toBeUndefined()
      expect(await localTicket(rig, live[0].id)).toMatchObject({ version: 1 })
    })
  })
})

describe('one key per create', () => {
  it('sends different keys for different tickets, and the key survives a restart of the engine', async () => {
    const { me, world, rig } = await setup()
    rig.loseNextResponse(isCreate)
    await rig.engine.createTicket(newTicket(world, 'Before the restart'))
    await rig.engine.idle()
    const keyBefore = rig.requests.filter(isCreate)[0].idempotencyKey
    await rig.engine.stop()
    rig.socket?.stop()

    // The tab is closed and reopened: a new engine over the same database.
    const again = await startClient(me, { socket: false, db: rig.db })
    rigs.push(again)
    await eventually('sent after the restart', async () => ((await outbox(again)).length === 0 ? true : undefined))
    expect(again.requests.filter(isCreate).map((r) => r.idempotencyKey)).toEqual([keyBefore])

    await again.engine.createTicket(newTicket(world, 'A different ticket'))
    await again.engine.idle()
    const keys = again.requests.filter(isCreate).map((r) => r.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keyBefore)
    expect((await serverTickets(me, world.projectId)).map((t) => t.title).sort()).toEqual([
      'A different ticket',
      'Before the restart',
    ])
  })
})

// LAM-127: the same for an entity that is not a ticket. Every create sends its stored
// key, so a lost answer on an epic's create does not make a second epic.
describe('a non-ticket create whose response is lost (LAM-127)', () => {
  it('is retried with the same key and yields exactly one epic on the server', async () => {
    const { me, world, rig } = await setup()
    const isEpicCreate = (r: RequestLog) => r.method === 'POST' && r.path === '/api/v1/epics'
    rig.loseNextResponse(isEpicCreate)

    await rig.engine.createEpic({ project_id: world.projectId, name: 'Only once', description: '' })
    await eventually('the retry is answered', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    const posts = rig.requests.filter(isEpicCreate)
    expect(posts).toHaveLength(2)
    expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey)

    const listed = must(
      'list epics',
      await me.api.POST('/api/v1/epics/list', { body: { project_id: world.projectId } }),
    )
    expect((listed.items ?? []).map((e) => e.name)).toEqual(['Only once'])
  })
})
