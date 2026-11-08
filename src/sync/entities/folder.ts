import type { components } from '@/api/schema'

import { answer, isNullableString, isString, listAll, PAGE_SIZE, type Codec, type Outcome, type RemoteEvent } from '../http'
import type { DocFolder, DocFolderFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  document folders: a project's documents in a tree
├─ out ───────────────────────────────────────────
│      folderEntity   the registry entry
│      toFolder
*/
// Like a label, a folder is unversioned: the server keeps no version, a PUT
// carries no If-Match, there is no 409, and a frame is applied by upsert or
// remove on the id (docs/realtime.md).
//  - `document_folder.deleted` is the entity's "archived". Deleting a folder deletes
//    nothing it held: the server moves its documents and sub-folders up into its
//    parent and announces each move. The engine re-files the rows it holds the
//    same way at once, so the tree is right before those announcements arrive.
//  - a folder made offline is named by a temporary id. A document filed in it, or
//    a folder made inside it, waits for its create and then takes the real id
//    (the engine does both, as it does for a ticket's new label).
//  - the parent goes to the server only when the edit moved the folder, so a
//    rename does not put back a parent somebody else has since changed.

type FolderBody = components['schemas']['FolderBody']

export const toFolder = (body: FolderBody): DocFolder => ({
    id: body.id,
    project_id: body.project_id,
    parent_id: body.parent_id,
    name: body.name,
    version: 1,
})

const codec: Codec<DocFolder, never> = {
    row: toFolder,
    conflict: () => null,
}

export const folderFieldsOf = (folder: DocFolderFields): DocFolderFields => ({
    name: folder.name,
    parent_id: folder.parent_id,
})

function readFolder(frame: Record<string, unknown>): DocFolder | null {
    const body = frame.document_folder
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (!isString(row.id) || !isString(row.project_id) || !isNullableString(row.parent_id) || !isString(row.name)) {
        return null
    }
    // The frame's own id must be the resource's, or something is wrong with it.
    return frame.folder_id === row.id ? toFolder(row as unknown as FolderBody) : null
}

const EVENTS = { created: 'created', updated: 'updated', deleted: 'archived' } as const
const PREFIX = 'document_folder.'

function parseFolderEvent(frame: Record<string, unknown>): RemoteEvent<'document_folder', DocFolder> | null {
    if (!isString(frame.type) || !frame.type.startsWith(PREFIX)) return null
    const type = EVENTS[frame.type.slice(PREFIX.length) as keyof typeof EVENTS]
    if (!type) return null
    const row = readFolder(frame)
    return row ? { entity: 'document_folder', type, row } : null
}

export const folderEntity: Entity<'document_folder'> = {
    name: 'document_folder',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_folder_',
        fieldsOf: folderFieldsOf,
        sameFields: (a, b) => a.name === b.name && a.parent_id === b.parent_id,
        fromCreate: (id, payload) => ({ id, ...payload, version: 1 }),
        edit: (base, fields) => ({ ...base, ...fields }),
        // A folder cannot be undeleted; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({ ...folderFieldsOf(row), project_id: row.project_id }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        // Per project, as epics, sprints and milestones are: each answers one page.
        async list(api) {
            const projects = await listAll((cursor) =>
                api.POST('/api/v1/projects/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const out: DocFolder[] = []
            for (const project of projects) {
                const listed = await listAll(() =>
                    api.POST('/api/v1/document-folders/list', { body: { project_id: project.id } }),
                )
                out.push(...listed.map(toFolder))
            }
            return out
        },

        async send(api, entry): Promise<Outcome<DocFolder, never>> {
            if (entry.kind === 'unarchive') {
                return { type: 'http', error: { status: 400, code: 'unsupported', errors: [] } }
            }

            if (entry.kind === 'create') {
                const { project_id, parent_id, name } = entry.payload
                return answer(
                    entry,
                    () =>
                        api.POST('/api/v1/document-folders', {
                            params: { header: { 'Idempotency-Key': entry.idempotency_key } },
                            body: { project_id, parent_id, name },
                        }),
                    codec,
                )
            }

            const path = { id: entry.entity_id }
            if (entry.kind === 'archive') {
                return answer(entry, () => api.DELETE('/api/v1/document-folders/{id}', { params: { path } }), codec)
            }
            const { name, parent_id } = entry.payload
            const moved = entry.was !== undefined && 'parent_id' in entry.was
            return answer(
                entry,
                () =>
                    api.PUT('/api/v1/document-folders/{id}', {
                        params: { path },
                        body: moved ? { name, parent_id } : { name },
                    }),
                codec,
            )
        },

        parseEvent: parseFolderEvent,
    },
}
