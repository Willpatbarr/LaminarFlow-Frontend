import { afterEach, describe, expect, it } from 'vitest'

import { eventually, startClient, type Rig } from './support/rig'
import { newAccount, newWorld, type Account, type World } from './support/stack'

// Documents through the same engine as tickets, answered by the real server
// (LAM-125): the optimistic row, the outbox, the version and ETag handling, the
// 409 shape and the change feed, none of which a stubbed fetch can vouch for.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

function must<T extends { data?: unknown; error?: unknown; response: Response }>(label: string, result: T) {
  if (result.data === undefined) throw new Error(`${label} failed: ${result.response.status} ${JSON.stringify(result.error)}`)
  return result.data as NonNullable<T['data']>
}

async function serverArchiveDoc(account: Account, id: string, version: number) {
  const result = await account.api.DELETE('/api/v1/documents/{id}', {
    params: { path: { id }, header: { 'If-Match': `"${version}"` } },
  })
  if (!result.response.ok) throw new Error(`archive failed: ${result.response.status} ${JSON.stringify(result.error)}`)
}

// Every test shares one workspace, and the document list is the workspace's, so
// a client sees other tests' documents. Each test reads only its own project's.
const scope = new WeakMap<Rig, string>()
const localDocs = async (rig: Rig) =>
  (await rig.db.snapshot()).documents.filter((doc) => doc.project_id === scope.get(rig))
const localDoc = async (rig: Rig, id: string) => (await localDocs(rig)).find((doc) => doc.id === id)
const queue = async (rig: Rig) => (await rig.db.snapshot()).outbox

function newDoc(world: World, title: string, content = 'Hello') {
  return { title, type: 'normal' as const, aspect_type_id: null, body: { content }, team_id: null, project_id: world.projectId }
}

async function serverDoc(account: Account, id: string) {
  const result = await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })
  return result.data ?? null
}

async function serverEdit(account: Account, id: string, version: number, title: string, content: string) {
  return must(
    'update document',
    await account.api.PUT('/api/v1/documents/{id}', {
      params: { path: { id }, header: { 'If-Match': `"${version}"` } },
      body: { title, type: 'normal', body: { content } },
    }),
  )
}

async function scene(options: Parameters<typeof startClient>[1] = { socket: false }) {
  const me = await newAccount('me')
  const other = await newAccount('other')
  const world = await newWorld(me)
  const rig = await startClient(me, options)
  rigs.push(rig)
  scope.set(rig, world.projectId)
  return { me, other, world, rig }
}

describe('create', () => {
  it('shows the document at once under a temporary id, then swaps in the server id at version 1', async () => {
    const { me, world, rig } = await scene()
    const swaps: { from: string; to: string }[] = []
    rig.engine.subscribe((change) => change.swap && swaps.push(change.swap))

    const local = await rig.engine.createDocument(newDoc(world, 'First document'))
    expect(local).toMatchObject({ version: 0, title: 'First document' })
    expect((await localDoc(rig, local.id))?.body).toEqual({ content: 'Hello' })

    await rig.engine.idle()

    expect(swaps).toHaveLength(1)
    const [row] = await localDocs(rig)
    expect(row).toMatchObject({ id: swaps[0].to, version: 1, title: 'First document', project_id: world.projectId })
    expect(await queue(rig)).toEqual([])
    expect(await serverDoc(me, row.id)).toMatchObject({ title: 'First document', version: 1, body: { content: 'Hello' } })
    // Documents do not take an Idempotency-Key; none was sent.
    expect(rig.requests.find((r) => r.method === 'POST' && r.path === '/api/v1/documents')?.idempotencyKey).toBeNull()
  })

  it('survives going offline: the edits made there are one create, sent when the network is back', async () => {
    const { me, world, rig } = await scene()
    rig.goOffline()

    const local = await rig.engine.createDocument(newDoc(world, 'Offline'))
    await rig.engine.updateDocument(local.id, { body: { content: 'Written on a plane' } })
    await rig.engine.idle()
    expect(await queue(rig)).toMatchObject([{ entity: 'document', kind: 'create' }])
    expect(rig.requests.filter((r) => r.path === '/api/v1/documents')).toEqual([])

    rig.goOnline()
    await rig.engine.idle()

    const [row] = await localDocs(rig)
    expect(row).toMatchObject({ version: 1, body: { content: 'Written on a plane' } })
    expect(await serverDoc(me, row.id)).toMatchObject({ title: 'Offline', body: { content: 'Written on a plane' } })
  })
})

describe('edit and archive', () => {
  it('sends the version it was made on, takes the new one, and archives and restores', async () => {
    const { me, world, rig } = await scene()
    await rig.engine.createDocument(newDoc(world, 'Plan'))
    await rig.engine.idle()
    const [created] = await localDocs(rig)

    await rig.engine.updateDocument(created.id, { title: 'Plan v2' })
    await rig.engine.idle()
    expect(await localDoc(rig, created.id)).toMatchObject({ title: 'Plan v2', version: 2 })
    expect(rig.requests.find((r) => r.method === 'PUT')?.ifMatch).toBe('"1"')

    const before = (await localDoc(rig, created.id))!
    await rig.engine.archiveDocument(created.id)
    await rig.engine.idle()
    expect(await localDocs(rig)).toEqual([])
    expect(await serverDoc(me, created.id)).toBeNull()

    expect(await rig.engine.unarchiveDocument(before)).toBe(created.id)
    await rig.engine.idle()
    expect(await queue(rig)).toEqual([])
    expect(await localDoc(rig, created.id)).toMatchObject({ title: 'Plan v2', version: 4 })
    expect(await serverDoc(me, created.id)).toMatchObject({ title: 'Plan v2', version: 4 })
  })
})

describe('a stale edit', () => {
  it('is parked as a document_conflict with the server\'s copy, and never overwrites the winner', async () => {
    const { me, other, world, rig } = await scene()
    await rig.engine.createDocument(newDoc(world, 'Shared'))
    await rig.engine.idle()
    const [created] = await localDocs(rig)
    await serverEdit(other, created.id, 1, 'Theirs', 'by other')

    await rig.engine.updateDocument(created.id, { title: 'Mine' })
    await rig.engine.idle()

    const [entry] = await queue(rig)
    expect(entry).toMatchObject({
      entity: 'document',
      kind: 'update',
      state: 'conflict',
      base_version: 1,
      conflict: { code: 'document_conflict', archived: false, current: { title: 'Theirs', version: 2, body: { content: 'by other' } } },
    })
    expect((await localDoc(rig, created.id))?.title).toBe('Mine')
    expect(await serverDoc(me, created.id)).toMatchObject({ title: 'Theirs', version: 2 })

    // "Mine wins": resent against the version the conflict showed.
    await rig.engine.retry(entry.id)
    await rig.engine.idle()
    expect(await queue(rig)).toEqual([])
    expect(await serverDoc(me, created.id)).toMatchObject({ title: 'Mine', version: 3 })
  })

  it('"keep mine as new" makes a second document and leaves theirs alone', async () => {
    const { me, other, world, rig } = await scene()
    await rig.engine.createDocument(newDoc(world, 'Shared'))
    await rig.engine.idle()
    const [created] = await localDocs(rig)
    await serverEdit(other, created.id, 1, 'Theirs', 'by other')
    await rig.engine.updateDocument(created.id, { title: 'Mine' })
    await rig.engine.idle()
    const [entry] = await queue(rig)

    const copy = await rig.engine.keepAsNew(entry.id)
    await rig.engine.idle()

    expect(copy).not.toBeNull()
    expect(await queue(rig)).toEqual([])
    const titles = (await localDocs(rig)).map((doc) => doc.title).sort()
    expect(titles).toEqual(['Mine', 'Theirs'])
    expect(await serverDoc(me, created.id)).toMatchObject({ title: 'Theirs' })
  })

  it('treats an archive of a document someone archived as done', async () => {
    const { other, world, rig } = await scene()
    await rig.engine.createDocument(newDoc(world, 'Doomed'))
    await rig.engine.idle()
    const [created] = await localDocs(rig)
    await serverArchiveDoc(other, created.id, 1)

    await rig.engine.archiveDocument(created.id)
    await rig.engine.idle()

    expect(await queue(rig)).toEqual([])
    expect(await localDocs(rig)).toEqual([])
  })
})

describe('hydration and the change feed', () => {
  it('lists the documents that were there, and receives created, updated and archived ones live', async () => {
    const me = await newAccount('me')
    const other = await newAccount('other')
    const world = await newWorld(me)
    const existing = must(
      'create document',
      await other.api.POST('/api/v1/documents', { body: { title: 'Already there', type: 'normal', project_id: world.projectId, body: { content: 'x' } } }),
    )
    const rig = await startClient(me)
    rigs.push(rig)
    scope.set(rig, world.projectId)
    await eventually('the socket is live', () => rig.connection() === 'live' || undefined)
    expect(await localDoc(rig, existing.id)).toMatchObject({ title: 'Already there', version: 1 })

    const created = must(
      'create document',
      await other.api.POST('/api/v1/documents', { body: { title: 'From elsewhere', type: 'normal', project_id: world.projectId, body: { content: 'y' } } }),
    )
    await eventually('the new document appears', async () => (await localDoc(rig, created.id)) || undefined)

    await serverEdit(other, created.id, 1, 'Renamed elsewhere', 'z')
    await eventually('the edit appears', async () => ((await localDoc(rig, created.id))?.version === 2 ? true : undefined))
    expect(await localDoc(rig, created.id)).toMatchObject({ title: 'Renamed elsewhere', body: { content: 'z' } })

    await serverArchiveDoc(other, created.id, 2)
    await eventually('the archived document is removed', async () => ((await localDoc(rig, created.id)) === undefined ? true : undefined))

    const frames = rig.frames.filter((f) => (f.frame as { document_id?: string }).document_id === created.id)
    expect(frames.map((f) => f.frame.type)).toEqual(['document.created', 'document.updated', 'document.archived'])
    expect(await Promise.all(frames.map((f) => f.changed))).toEqual([true, true, true])
  })
})
