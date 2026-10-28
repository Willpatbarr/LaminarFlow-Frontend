import type { components } from '@/api/schema'

import {
    answer,
    ifMatch,
    isNullableString,
    isString,
    listAll,
    PAGE_SIZE,
    parseEvent,
    type Codec,
} from '../http'
import type { Doc, DocConflict, DocFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  documents: the second entity (LAM-125)
├─ out ───────────────────────────────────────────
│      documentEntity   the registry entry
│      toDoc, docFieldsOf
*/
// How it differs from a ticket, and nothing else:
//  - a 409 has one code, `document_conflict`; whether the server's copy is
//    archived is `current.archived_at`. It names no author, so an update whose
//    answer was lost is recognised by the copy being identical to what was sent.
//  - a replay of a create's `Idempotency-Key` whose document was archived since
//    is the same `document_conflict`, so `conflictIsArchive` (the copy is
//    archived) is what lets the engine treat the create as done (LAM-126).
//  - the list takes no sort.
//  - team and project are fixed at creation, so they are in the create and not
//    in an edit.

type DocumentBody = components['schemas']['DocumentBody']

export function toDoc(body: DocumentBody): Doc {
    return {
        id: body.id,
        title: body.title,
        type: body.type,
        aspect_type_id: body.aspect_type_id,
        team_id: body.team_id,
        project_id: body.project_id,
        body: Object.fromEntries(Object.entries(body.body).filter((pair): pair is [string, string] => isString(pair[1]))),
        version: body.version,
        created_at: body.created_at,
        updated_at: body.updated_at,
    }
}

export function docFieldsOf(doc: DocFields): DocFields {
    return { title: doc.title, type: doc.type, aspect_type_id: doc.aspect_type_id, body: doc.body }
}

function sameBody(a: Record<string, string>, b: Record<string, string>): boolean {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key])
}

function sameFields(a: DocFields, b: DocFields): boolean {
    return (
        a.title === b.title &&
        a.type === b.type &&
        a.aspect_type_id === b.aspect_type_id &&
        sameBody(a.body, b.body)
    )
}

const codec: Codec<Doc, DocConflict> = {
    row: toDoc,
    conflict(body: Partial<components['schemas']['DocumentConflict']>) {
        if (!body.current || body.code !== 'document_conflict') return null
        return {
            code: body.code,
            current: toDoc(body.current),
            archived: body.current.archived_at !== null,
            changed_at: body.changed_at ?? body.current.updated_at,
        }
    },
}

function readDoc(row: Record<string, unknown>): Doc | null {
    const body = row.body
    if (
        !isString(row.id) ||
        !isString(row.title) ||
        (row.type !== 'normal' && row.type !== 'aspect') ||
        !isNullableString(row.aspect_type_id) ||
        !isNullableString(row.team_id) ||
        !isNullableString(row.project_id) ||
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        !isString(row.created_at) ||
        !isString(row.updated_at) ||
        typeof row.version !== 'number' ||
        !Number.isInteger(row.version) ||
        row.version < 1
    ) {
        return null
    }
    return toDoc(row as unknown as DocumentBody)
}

export const documentEntity: Entity<'document'> = {
    name: 'document',

    rules: {
        tempPrefix: 'tmp_doc_',
        fieldsOf: docFieldsOf,
        sameFields,
        fromCreate: (id, payload, { at }) => ({
            id,
            ...payload,
            version: 0,
            created_at: at,
            updated_at: at,
        }),
        edit: (base, fields, { at }) => ({ ...base, ...fields, updated_at: at }),
        restore: (archived, { at }) => ({ ...archived, updated_at: at }),
        copyOf: (row) => ({ ...docFieldsOf(row), team_id: row.team_id, project_id: row.project_id }),
        conflictIsArchive: (conflict) => conflict.archived,
        conflictIsBy: () => true,
    },

    remote: {
        async list(api) {
            const documents = await listAll((cursor) =>
                api.POST('/api/v1/documents/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            return documents.map(toDoc)
        },

        send(api, entry) {
            return answer(
                entry,
                () => {
                    if (entry.kind === 'create') {
                        return api.POST('/api/v1/documents', {
                            params: { header: { 'Idempotency-Key': entry.idempotency_key } },
                            body: entry.payload,
                        })
                    }
                    const params = { path: { id: entry.entity_id }, header: ifMatch(entry.base_version) }
                    if (entry.kind === 'update') return api.PUT('/api/v1/documents/{id}', { params, body: entry.payload })
                    if (entry.kind === 'unarchive') return api.POST('/api/v1/documents/{id}/unarchive', { params })
                    return api.DELETE('/api/v1/documents/{id}', { params })
                },
                codec,
            )
        },

        parseEvent: (frame) => parseEvent(frame, 'document', readDoc),
    },
}
