import type { components } from '@/api/schema'

import { answer, isString, listAll, PAGE_SIZE, type Codec, type Outcome, type RemoteEvent } from '../http'
import type { Label, LabelFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  labels: writable (LAM-104); they were read-only from LAM-103
├─ out ───────────────────────────────────────────
│      labelEntity   the registry entry
│      toLabel
*/
// Like a status, a label is unversioned: the server keeps no version, a PUT
// carries no If-Match, there is no 409 conflict, and a frame is applied by upsert
// or remove on the id (docs/realtime.md). The rows hold a constant 1.
//  - `label.deleted` is the entity's "archived". Deleting also drops the id from
//    every ticket; the engine does the same to the tickets it holds.
//  - the create takes no Idempotency-Key. A create whose answer was lost and is
//    sent again meets its own label as a 409 `label_name_taken`; `send` then
//    adopts the team's label of that name rather than parking the create.
//  - a name is unique in its team: a 409 `label_name_taken` on a rename is the
//    entry parked as failed, with the code, and the editor says so.

type LabelBody = components['schemas']['LabelBody']

export const toLabel = (body: LabelBody): Label => ({
    id: body.id,
    team_id: body.team_id,
    name: body.name,
    color: body.color,
    version: 1,
})

const codec: Codec<Label, never> = {
    row: toLabel,
    conflict: () => null,
}

export const labelFieldsOf = (label: LabelFields): LabelFields => ({ name: label.name, color: label.color })

function readLabel(frame: Record<string, unknown>): Label | null {
    const body = frame.label
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (!isString(row.id) || !isString(row.team_id) || !isString(row.name) || !isString(row.color)) return null
    // The frame's own id must be the resource's, or something is wrong with it.
    return frame.label_id === row.id ? toLabel(row as unknown as LabelBody) : null
}

const EVENTS = { created: 'created', updated: 'updated', deleted: 'archived' } as const

function parseLabelEvent(frame: Record<string, unknown>): RemoteEvent<'label', Label> | null {
    if (!isString(frame.type) || !frame.type.startsWith('label.')) return null
    const type = EVENTS[frame.type.slice('label.'.length) as keyof typeof EVENTS]
    if (!type) return null
    const row = readLabel(frame)
    return row ? { entity: 'label', type, row } : null
}

export const labelEntity: Entity<'label'> = {
    name: 'label',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_label_',
        fieldsOf: labelFieldsOf,
        sameFields: (a, b) => a.name === b.name && a.color === b.color,
        fromCreate: (id, payload) => ({ id, ...payload, version: 1 }),
        edit: (base, fields) => ({ ...base, ...fields }),
        // A label cannot be unarchived; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({ ...labelFieldsOf(row), team_id: row.team_id }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        async list(api) {
            const teams = await listAll((cursor) =>
                api.POST('/api/v1/teams/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const out: Label[] = []
            for (const team of teams) {
                const listed = await listAll(() => api.POST('/api/v1/labels/list', { body: { team_id: team.id } }))
                out.push(...listed.map(toLabel))
            }
            return out
        },

        async send(api, entry): Promise<Outcome<Label, never>> {
            if (entry.kind === 'unarchive') {
                return { type: 'http', error: { status: 400, code: 'unsupported', errors: [] } }
            }

            if (entry.kind === 'create') {
                const { team_id, name, color } = entry.payload
                const sent = await answer(entry, () => api.POST('/api/v1/labels', { body: { team_id, name, color } }), codec)
                if (sent.type !== 'http' || sent.error.code !== 'label_name_taken') return sent
                // Probably this very create, sent before and answered to nobody.
                try {
                    const listed = await listAll(() => api.POST('/api/v1/labels/list', { body: { team_id } }))
                    const mine = listed.find((label) => label.name === name)
                    return mine ? { type: 'ok', row: toLabel(mine) } : sent
                } catch {
                    return sent
                }
            }

            const path = { id: entry.entity_id }
            if (entry.kind === 'archive') {
                return answer(entry, () => api.DELETE('/api/v1/labels/{id}', { params: { path } }), codec)
            }
            const { name, color } = entry.payload
            return answer(entry, () => api.PUT('/api/v1/labels/{id}', { params: { path }, body: { name, color } }), codec)
        },

        parseEvent: parseLabelEvent,
    },
}

