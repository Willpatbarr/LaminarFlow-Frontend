import { afterEach, describe, expect, it, vi } from 'vitest'

import { bodyOf, ok, stubFetch } from '@/testing/fetch'

import { doc, docBody, listRoutes, startEngine } from '../testing/harness'

// Document folders. The engine is the one labels use; what these pin down is
// where a folder differs: a document (or another folder) can be filed in one the
// server has not heard of yet, and deleting one moves what it held up a level
// instead of losing it.

afterEach(() => {
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const SPECS = { id: 'f-specs', project_id: 'p-1', parent_id: null, name: 'Specs', ...stamp }
const API = { id: 'f-api', project_id: 'p-1', parent_id: 'f-specs', name: 'API', ...stamp }

async function started(extra: Parameters<typeof stubFetch>[0] = {}, documents = [doc({ id: 'd-1', version: 1 })]) {
    stubFetch({ ...listRoutes([], documents, [], { folders: [SPECS, API] }), ...extra })
    const run = await startEngine()
    await run.engine.idle()
    return run
}

const folderOf = async (db: Awaited<ReturnType<typeof startEngine>>['db'], id: string) =>
    (await db.snapshot()).documents.find((document) => document.id === id)?.folder_id

describe('hydration', () => {
    it('lists each project\'s folders as rows with a constant version', async () => {
        const { db } = await started()
        const folders = (await db.snapshot()).folders.toSorted((a, b) => a.name.localeCompare(b.name))
        expect(folders).toEqual([
            { id: 'f-api', project_id: 'p-1', parent_id: 'f-specs', name: 'API', version: 1 },
            { id: 'f-specs', project_id: 'p-1', parent_id: null, name: 'Specs', version: 1 },
        ])
    })
})

describe('filing a document', () => {
    it('sends only the folder when the edit moved it, and nothing about it otherwise', async () => {
        const puts: unknown[] = []
        const { engine } = await started({
            'PUT /api/v1/documents/d-1': async (request) => {
                const body = (await bodyOf(request)) as Record<string, unknown>
                puts.push(body)
                return ok(docBody({ id: 'd-1', version: puts.length + 1, folder_id: (body.folder_id as string) ?? null }))
            },
        })

        await engine.update('document', 'd-1', { folder_id: 'f-api' })
        await engine.idle()
        await engine.update('document', 'd-1', { title: 'Renamed' })
        await engine.idle()

        expect(puts[0]).toMatchObject({ folder_id: 'f-api' })
        expect(puts[1]).not.toHaveProperty('folder_id')
    })

    it('holds a document filed in a new folder until the folder is made, then sends the real id', async () => {
        const order: string[] = []
        let filedIn: unknown
        const { engine, db, net } = await started({
            'POST /api/v1/document-folders': async (request) => {
                order.push('folder')
                const body = (await bodyOf(request)) as Record<string, unknown>
                return ok({ ...SPECS, id: 'f-new', name: body.name, parent_id: body.parent_id ?? null })
            },
            'PUT /api/v1/documents/d-1': async (request) => {
                order.push('document')
                filedIn = ((await bodyOf(request)) as Record<string, unknown>).folder_id
                return ok(docBody({ id: 'd-1', version: 2, folder_id: 'f-new' }))
            },
        })
        net.goOffline()

        const folder = await engine.create('document_folder', { project_id: 'p-1', parent_id: null, name: 'Drafts' })
        expect(folder.id.startsWith('tmp_')).toBe(true)
        await engine.update('document', 'd-1', { folder_id: folder.id })
        expect(await folderOf(db, 'd-1')).toBe(folder.id)

        net.goOnline()
        await engine.idle()

        expect(order).toEqual(['folder', 'document'])
        expect(filedIn).toBe('f-new')
        expect(await folderOf(db, 'd-1')).toBe('f-new')
        expect((await db.snapshot()).outbox).toEqual([])
    })

    it('makes a folder inside a new folder only once the outer one exists', async () => {
        const made: Record<string, unknown>[] = []
        const { engine, db, net } = await started({
            'POST /api/v1/document-folders': async (request) => {
                const body = (await bodyOf(request)) as Record<string, unknown>
                made.push(body)
                return ok({ ...SPECS, id: `f-real-${made.length}`, name: body.name, parent_id: body.parent_id ?? null })
            },
        })
        net.goOffline()
        const outer = await engine.create('document_folder', { project_id: 'p-1', parent_id: null, name: 'Outer' })
        await engine.create('document_folder', { project_id: 'p-1', parent_id: outer.id, name: 'Inner' })

        net.goOnline()
        await engine.idle()

        expect(made).toEqual([
            { project_id: 'p-1', parent_id: null, name: 'Outer' },
            { project_id: 'p-1', parent_id: 'f-real-1', name: 'Inner' },
        ])
        const inner = (await db.snapshot()).folders.find((folder) => folder.name === 'Inner')
        expect(inner?.parent_id).toBe('f-real-1')
    })
})

describe('moving and renaming a folder', () => {
    it('sends the parent only when the folder moved', async () => {
        const puts: unknown[] = []
        const { engine } = await started({
            'PUT /api/v1/document-folders/f-api': async (request) => {
                const body = await bodyOf(request)
                puts.push(body)
                return ok({ ...API, ...(body as object) })
            },
        })

        await engine.update('document_folder', 'f-api', { name: 'Interfaces' })
        await engine.idle()
        await engine.update('document_folder', 'f-api', { parent_id: null })
        await engine.idle()

        expect(puts).toEqual([{ name: 'Interfaces' }, { name: 'Interfaces', parent_id: null }])
    })
})

describe('deleting a folder', () => {
    it('moves its documents and folders up into its parent at once, and sends one DELETE', async () => {
        let deleted = 0
        const { engine, db } = await started(
            {
                'DELETE /api/v1/document-folders/f-api': () => {
                    deleted++
                    return new Response(null, { status: 204 })
                },
            },
            [doc({ id: 'd-1', version: 1, folder_id: 'f-api' })],
        )
        // A folder inside the one being deleted.
        await engine.applyRemote({
            type: 'document_folder.created',
            folder_id: 'f-deep',
            document_folder: { ...API, id: 'f-deep', parent_id: 'f-api', name: 'Deep' },
        })

        expect(await engine.archive('document_folder', 'f-api')).toBe(true)

        const snapshot = await db.snapshot()
        expect(await folderOf(db, 'd-1')).toBe('f-specs')
        expect(snapshot.folders.find((folder) => folder.id === 'f-deep')?.parent_id).toBe('f-specs')
        // Only the delete is queued: the moves are the server's to make and announce.
        expect(snapshot.outbox.map((entry) => `${entry.entity}:${entry.kind}`)).toEqual(['document_folder:archive'])

        await engine.idle()
        expect(deleted).toBe(1)
        expect((await db.snapshot()).folders.map((folder) => folder.id).toSorted()).toEqual(['f-deep', 'f-specs'])
    })

    it('withdraws a folder that was never sent, putting what was filed in it back where the folder was', async () => {
        const { engine, db, net } = await started()
        net.goOffline()
        const folder = await engine.create('document_folder', { project_id: 'p-1', parent_id: 'f-specs', name: 'Scratch' })
        await engine.update('document', 'd-1', { folder_id: folder.id })

        await engine.archive('document_folder', folder.id)

        const snapshot = await db.snapshot()
        expect(await folderOf(db, 'd-1')).toBe('f-specs')
        expect(snapshot.outbox.map((entry) => entry.entity)).toEqual(['document'])
        expect(snapshot.outbox[0]).toMatchObject({ payload: { folder_id: 'f-specs' } })
    })

    it('applies a teammate\'s delete the same way, before their moves arrive', async () => {
        const { engine, db } = await started({}, [doc({ id: 'd-1', version: 1, folder_id: 'f-api' })])

        await engine.applyRemote({ type: 'document_folder.deleted', folder_id: 'f-api', document_folder: API })

        const snapshot = await db.snapshot()
        expect(snapshot.folders.map((folder) => folder.id)).toEqual(['f-specs'])
        expect(await folderOf(db, 'd-1')).toBe('f-specs')
    })
})
