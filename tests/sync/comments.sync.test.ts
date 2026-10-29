import { afterEach, describe, expect, it } from 'vitest'

import { eventually, startClient, type Rig } from './support/rig'
import { fields, newAccount, newWorld, serverCreate } from './support/stack'

// Comments through the same engine, answered by the real server (LAM-112): the
// Idempotency-Key on a create, the body-only edit and its author-only 403, the
// delete, and the change feed that carries a comment under `comment`.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

// Every test shares one workspace and the comment list is the workspace's, so a
// client reads only its own ticket's.
const localComments = async (rig: Rig, ticketId: string) =>
  (await rig.db.snapshot()).comments.filter((comment) => comment.ticket_id === ticketId)
const onTicket = (id: string) => ({ filter: { op: 'and', conditions: [{ field: 'ticket_id', op: 'eq', value: id }] } })
const queue = async (rig: Rig) => (await rig.db.snapshot()).outbox

async function scene(options: Parameters<typeof startClient>[1] = { socket: false }) {
  const me = await newAccount('me')
  const other = await newAccount('other')
  const world = await newWorld(me)
  const ticket = await serverCreate(me, world.projectId, fields('Discuss me', { status_id: world.statusIds[0] }))
  const rig = await startClient(me, options)
  rigs.push(rig)
  await rig.engine.idle()
  return { me, other, ticket, rig }
}

describe('a comment made here', () => {
  it('shows at once, then takes the server id; the server has it as ours', async () => {
    const { me, ticket, rig } = await scene()
    const local = await rig.engine.create('comment', { ticket_id: ticket.id, document_id: null, body: 'Hello **there**' })
    expect(local.id.startsWith('tmp_')).toBe(true)
    expect((await localComments(rig, ticket.id)).map((c) => c.body)).toEqual(['Hello **there**'])

    await rig.engine.idle()

    const [row] = await localComments(rig, ticket.id)
    expect(row.id.startsWith('tmp_')).toBe(false)
    expect(row).toMatchObject({ author_id: me.accountId, body: 'Hello **there**' })
    expect(await queue(rig)).toEqual([])
    const listed = await me.api.POST('/api/v1/comments/list', { body: onTicket(ticket.id) })
    expect(listed.data?.items?.map((c) => c.id)).toEqual([row.id])
  })

  it('is one comment on the server however many answers are lost, every attempt carrying the one key', async () => {
    const { me, ticket, rig } = await scene()
    const isCreate = (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/v1/comments'
    rig.loseNextResponse(isCreate, 2)

    await rig.engine.create('comment', { ticket_id: ticket.id, document_id: null, body: 'Only once' })
    await eventually('answered on the third attempt', async () => ((await queue(rig)).length === 0 ? true : undefined))

    const posts = rig.requests.filter(isCreate)
    expect(posts).toHaveLength(3)
    expect(new Set(posts.map((r) => r.idempotencyKey)).size).toBe(1)
    expect(await localComments(rig, ticket.id)).toHaveLength(1)
    const listed = await me.api.POST('/api/v1/comments/list', { body: onTicket(ticket.id) })
    expect(listed.data?.items).toHaveLength(1)
  })

  it('can be edited and then deleted by its author', async () => {
    const { ticket, rig } = await scene()
    await rig.engine.create('comment', { ticket_id: ticket.id, document_id: null, body: 'v1' })
    await rig.engine.idle()
    const [made] = await localComments(rig, ticket.id)

    await rig.engine.update('comment', made.id, { body: 'v2' })
    await rig.engine.idle()
    expect((await localComments(rig, ticket.id)).map((c) => c.body)).toEqual(['v2'])
    expect(await queue(rig)).toEqual([])

    await rig.engine.archive('comment', made.id)
    await rig.engine.idle()
    expect(await localComments(rig, ticket.id)).toEqual([])
    expect(await queue(rig)).toEqual([])
  })
})

describe('someone else\'s comment', () => {
  it('cannot be edited: the server answers 403 comment_not_author and the entry parks as failed', async () => {
    const { other, ticket, rig } = await scene()
    const theirs = await other.api.POST('/api/v1/comments', { body: { ticket_id: ticket.id, body: 'Not yours' } })
    expect(theirs.response.status).toBe(200)

    // A fresh hydration: the comment arrives with it.
    await rig.engine.hydrate()
    await rig.engine.idle()
    expect((await localComments(rig, ticket.id)).map((c) => c.body)).toEqual(['Not yours'])

    await rig.engine.update('comment', theirs.data!.id, { body: 'Mine now' })
    await rig.engine.idle()
    const [entry] = await queue(rig)
    expect(entry).toMatchObject({ state: 'failed', error: { status: 403, code: 'comment_not_author' } })
  })

  it('arrives over the change feed: created, edited, deleted', async () => {
    const { other, ticket, rig } = await scene({ socket: true })
    await eventually('the socket is live', () => rig.connection() === 'live' || undefined)

    const made = await other.api.POST('/api/v1/comments', { body: { ticket_id: ticket.id, body: 'Live one' } })
    const id = made.data!.id
    await eventually('the comment appears', async () => ((await localComments(rig, ticket.id))[0]?.body === 'Live one' ? true : undefined))

    await other.api.PUT('/api/v1/comments/{id}', { params: { path: { id } }, body: { body: 'Live two' } })
    await eventually('the edit appears', async () => ((await localComments(rig, ticket.id))[0]?.body === 'Live two' ? true : undefined))

    await other.api.DELETE('/api/v1/comments/{id}', { params: { path: { id } } })
    await eventually('the comment goes', async () => ((await localComments(rig, ticket.id)).length === 0 ? true : undefined))
  })
})
