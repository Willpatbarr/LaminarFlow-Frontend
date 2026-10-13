import { afterEach, describe, expect, it } from 'vitest'

import { codePoints, LIMITS } from '@/features/tickets/limits'

import { eventually, outbox, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverTickets, type World } from './support/stack'

// The limits the client mirrors (LAM-76), against the server that owns them:
// that the numbers agree, that code points are counted the way this client
// counts them, and that the two new named-id refusals arrive in the shape the
// client reads.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

async function setup() {
  const me = await newAccount('me')
  const world = await newWorld(me)
  const rig = await startClient(me, { socket: false })
  rigs.push(rig)
  return { me, world, rig }
}

const create = (world: World, overrides: Parameters<typeof fields>[1] & { title: string }) => ({
  project_id: world.projectId,
  ...fields(overrides.title, { status_id: world.statusIds[0], ...overrides }),
})

async function sent(rig: Rig, ticket: ReturnType<typeof create>) {
  await rig.engine.createTicket(ticket)
  await rig.engine.idle()
  const entries = await outbox(rig)
  return entries[0]
}

describe('what the server accepts and refuses', () => {
  it('takes a title of exactly the limit in code points, even where that is twice as many UTF-16 units', async () => {
    const { me, world, rig } = await setup()
    const title = '😀'.repeat(LIMITS.ticketTitle)
    expect(title.length).toBe(LIMITS.ticketTitle * 2)

    expect(await sent(rig, create(world, { title }))).toBeUndefined()

    const onServer = await serverTickets(me, world.projectId)
    expect(onServer).toHaveLength(1)
    expect(codePoints(onServer[0].title)).toBe(LIMITS.ticketTitle)
  })

  it('refuses one more, at body.title, and parks it as failed with the field named', async () => {
    const { me, world, rig } = await setup()

    const entry = await sent(rig, create(world, { title: '😀'.repeat(LIMITS.ticketTitle + 1) }))

    expect(entry).toMatchObject({ state: 'failed', error: { status: 422 } })
    expect(entry.error?.errors.map((e) => e.location)).toContain('body.title')
    expect(await serverTickets(me, world.projectId)).toEqual([])
  })

  it('takes a description of exactly the limit and refuses one more, at body.description', async () => {
    const { me, world, rig } = await setup()

    expect(await sent(rig, create(world, { title: 'Long text', description: 'd'.repeat(LIMITS.ticketDescription) }))).toBeUndefined()
    const entry = await sent(rig, create(world, { title: 'Longer text', description: 'd'.repeat(LIMITS.ticketDescription + 1) }))

    expect(entry).toMatchObject({ state: 'failed', error: { status: 422 } })
    expect(entry.error?.errors.map((e) => e.location)).toContain('body.description')
    expect((await serverTickets(me, world.projectId)).map((t) => t.title)).toEqual(['Long text'])
  })

  it('refuses an edit past the limit the same way', async () => {
    const { me, world, rig } = await setup()
    await rig.engine.createTicket(create(world, { title: 'Fine' }))
    await rig.engine.idle()
    const [created] = await serverTickets(me, world.projectId)

    await rig.engine.updateTicket(created.id, { title: 'x'.repeat(LIMITS.ticketTitle + 1) })
    await rig.engine.idle()

    const [entry] = await outbox(rig)
    expect(entry).toMatchObject({ kind: 'update', state: 'failed', error: { status: 422 } })
    expect(entry.error?.errors.map((e) => e.location)).toContain('body.title')
  })

  it('names a status that does not exist: 422, status_not_found, at body.status_id', async () => {
    const { world, rig } = await setup()

    const entry = await sent(rig, create(world, { title: 'Bad status', status_id: '00000000-0000-4000-8000-000000000000' }))

    expect(entry).toMatchObject({ state: 'failed', error: { status: 422, code: 'status_not_found' } })
    expect(entry.error?.errors.map((e) => e.location)).toEqual(['body.status_id'])
  })

  it('names an assignee that does not exist: 422, assignee_not_found, at body.assignee_id', async () => {
    const { world, rig } = await setup()

    const entry = await sent(rig, create(world, { title: 'Bad assignee', assignee_id: '00000000-0000-4000-8000-000000000000' }))

    expect(entry).toMatchObject({ state: 'failed', error: { status: 422, code: 'assignee_not_found' } })
    expect(entry.error?.errors.map((e) => e.location)).toEqual(['body.assignee_id'])
  })

  it('lets a refused create be corrected and sent again, under the same key, as one ticket', async () => {
    const { me, world, rig } = await setup()
    await rig.engine.createTicket(create(world, { title: 'x'.repeat(LIMITS.ticketTitle + 1) }))
    await rig.engine.idle()
    const [refused] = await outbox(rig)
    expect(refused.state).toBe('failed')

    await rig.engine.updateTicket(refused.ticket_id, { title: 'Corrected' })
    await eventually('sent again', async () => ((await outbox(rig)).length === 0 ? true : undefined))

    const posts = rig.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/tickets')
    expect(posts.map((r) => r.idempotencyKey)).toHaveLength(2)
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey)
    expect((await serverTickets(me, world.projectId)).map((t) => t.title)).toEqual(['Corrected'])
  })
})
