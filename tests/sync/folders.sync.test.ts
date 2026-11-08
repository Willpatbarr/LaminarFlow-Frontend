import { afterEach, describe, expect, it } from 'vitest'

import { startClient, type Rig } from './support/rig'
import { newAccount, newWorld, type Account } from './support/stack'

// Document folders answered by the real server: a folder made offline, a
// document filed in it before the server has heard of either, and a delete that
// moves what the folder held up a level instead of losing it.

let rigs: Rig[] = []
afterEach(async () => {
  await Promise.all(rigs.map((rig) => rig.stop()))
  rigs = []
})

async function serverDoc(account: Account, id: string) {
  const result = await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })
  return result.data ?? null
}

async function serverFolders(account: Account, projectId: string) {
  const result = await account.api.POST('/api/v1/document-folders/list', { body: { project_id: projectId } })
  return result.data?.items ?? []
}

async function scene() {
  const me = await newAccount('me')
  const world = await newWorld(me)
  const rig = await startClient(me, { socket: false })
  rigs.push(rig)
  return { me, world, rig }
}

describe('document folders', () => {
  it('files a document in a folder made offline, then sends both with the real id', async () => {
    const { me, world, rig } = await scene()
    rig.goOffline()

    const outer = await rig.engine.create('document_folder', { project_id: world.projectId, parent_id: null, name: 'Specs' })
    const inner = await rig.engine.create('document_folder', { project_id: world.projectId, parent_id: outer.id, name: 'API' })
    const document = await rig.engine.createDocument({
      title: 'Auth',
      type: 'normal',
      aspect_type_id: null,
      body: { content: 'Tokens' },
      team_id: null,
      project_id: world.projectId,
      folder_id: inner.id,
    })
    await rig.engine.idle()

    rig.goOnline()
    await rig.engine.idle()

    const snapshot = await rig.db.snapshot()
    expect(snapshot.outbox).toEqual([])
    const folders = await serverFolders(me, world.projectId)
    const realOuter = folders.find((folder) => folder.name === 'Specs')!
    const realInner = folders.find((folder) => folder.name === 'API')!
    expect(realInner.parent_id).toBe(realOuter.id)

    const local = snapshot.documents.find((row) => row.title === 'Auth' && row.project_id === world.projectId)!
    expect(local.id).not.toBe(document.id)
    expect(local.folder_id).toBe(realInner.id)
    expect(await serverDoc(me, local.id)).toMatchObject({ folder_id: realInner.id })
  })

  it('deleting a folder keeps its document, one level up, here and on the server', async () => {
    const { me, world, rig } = await scene()
    const outer = await rig.engine.create('document_folder', { project_id: world.projectId, parent_id: null, name: 'Outer' })
    await rig.engine.idle()
    const outerId = (await rig.db.snapshot()).folders.find((folder) => folder.name === 'Outer' && folder.project_id === world.projectId)!.id
    expect(outerId).not.toBe(outer.id)
    const inner = await rig.engine.create('document_folder', { project_id: world.projectId, parent_id: outerId, name: 'Inner' })
    await rig.engine.idle()
    const innerId = (await rig.db.snapshot()).folders.find((folder) => folder.name === 'Inner' && folder.project_id === world.projectId)!.id
    expect(innerId).not.toBe(inner.id)
    await rig.engine.createDocument({
      title: 'Kept',
      type: 'normal',
      aspect_type_id: null,
      body: { content: '' },
      team_id: null,
      project_id: world.projectId,
      folder_id: innerId,
    })
    await rig.engine.idle()
    const kept = (await rig.db.snapshot()).documents.find((row) => row.title === 'Kept' && row.project_id === world.projectId)!

    await rig.engine.archive('document_folder', innerId)
    expect((await rig.db.snapshot()).documents.find((row) => row.id === kept.id)?.folder_id).toBe(outerId)
    await rig.engine.idle()

    expect((await rig.db.snapshot()).outbox).toEqual([])
    expect((await serverFolders(me, world.projectId)).map((folder) => folder.name)).toEqual(['Outer'])
    expect(await serverDoc(me, kept.id)).toMatchObject({ folder_id: outerId, version: kept.version + 1 })
  })
})
