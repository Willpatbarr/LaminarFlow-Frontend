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
//  - the team is fixed at creation. The project can be changed (LAM-138, `null`
//    is "team-wide"), but the server leaves it alone when a PUT omits it, so an
//    update names it only when this edit changed it: `was` has the key.

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
    return { title: doc.title, type: doc.type, aspect_type_id: doc.aspect_type_id, project_id: doc.project_id, body: doc.body }
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
        a.project_id === b.project_id &&
        sameBody(a.body, b.body)
    )
}

// LAM-166. A document's body is one object, replaced whole by every save, so
// what an edit changed is told per top-level key (`content`, or an aspect
// field's id). `was.body` holds, for each key the edit changes, the text that
// key held when the edit began. Two people editing the same key is a clash;
// there is no text merge. Title, type and aspect type are compared as they are.
type Texts = Record<string, string>
const textsOf = (value: unknown): Texts =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Texts) : {}

function clash(current: Doc, was: Record<string, unknown>): string[] {
    const found: string[] = []
    if ('title' in was && was.title !== current.title) found.push('title')
    if ('type' in was && was.type !== current.type) found.push('type')
    if ('aspect_type_id' in was && was.aspect_type_id !== current.aspect_type_id) found.push('aspect_type_id')
    if ('project_id' in was && was.project_id !== current.project_id) found.push('project_id')
    const body = textsOf(was.body)
    for (const key of Object.keys(body)) {
        if ((current.body[key] ?? '') !== (body[key] ?? '')) found.push(`body.${key}`)
    }
    return found
}

function merge(mine: DocFields, current: Doc, was: Record<string, unknown>): DocFields {
    const own = textsOf(was.body)
    const body: Texts = {}
    for (const key of Object.keys(current.body)) {
        if (key in own) {
            if (key in mine.body) body[key] = mine.body[key]
        } else {
            body[key] = current.body[key]
        }
    }
    for (const key of Object.keys(own)) if (!(key in current.body) && key in mine.body) body[key] = mine.body[key]
    return {
        title: 'title' in was ? mine.title : current.title,
        type: 'type' in was ? mine.type : current.type,
        aspect_type_id: 'aspect_type_id' in was ? mine.aspect_type_id : current.aspect_type_id,
        project_id: 'project_id' in was ? mine.project_id : current.project_id,
        body,
    }
}

function startOf(field: string, patched: unknown, given: unknown, acked: unknown, before: unknown): unknown {
    if (field !== 'body') return acked !== undefined ? acked : given !== undefined ? given : before
    const next = textsOf(patched)
    const old = textsOf(before)
    const start: Texts = {}
    for (const key of new Set([...Object.keys(next), ...Object.keys(old)])) {
        if (next[key] === old[key]) continue
        start[key] = textsOf(acked)[key] ?? textsOf(given)[key] ?? old[key] ?? ''
    }
    return start
}

function foldWas(earlier: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown> {
    const body = { ...textsOf(later.body), ...textsOf(earlier.body) }
    const folded = { ...later, ...earlier }
    return 'body' in folded ? { ...folded, body } : folded
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
        clash,
        merge,
        startOf,
        foldWas,
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
                    if (entry.kind === 'update') {
                        // The project only when this edit changed it: an edit of the text must not
                        // put back a project somebody else has since changed.
                        const { project_id, ...rest } = entry.payload
                        const moved = entry.was !== undefined && 'project_id' in entry.was
                        return api.PUT('/api/v1/documents/{id}', { params, body: moved ? { ...rest, project_id } : rest })
                    }
                    if (entry.kind === 'unarchive') return api.POST('/api/v1/documents/{id}/unarchive', { params })
                    return api.DELETE('/api/v1/documents/{id}', { params })
                },
                codec,
            )
        },

        parseEvent: (frame) => parseEvent(frame, 'document', readDoc),
    },
}
