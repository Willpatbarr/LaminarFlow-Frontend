import type { components } from '@/api/schema'

import { answer, isString, listAll, PAGE_SIZE, toError, type Codec, type Outcome, type RemoteEvent } from '../http'
import { isTempId, type Status, type StatusConflict, type StatusFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  statuses: the third entity (LAM-95)
├─ out ───────────────────────────────────────────
│      statusEntity   the registry entry
│      toStatus, statusFieldsOf, sortStatuses
*/
// How it differs from a ticket or a document, and nothing else:
//  - the server keeps NO version: no If-Match, no 409, and a frame carries none.
//    The rows hold a constant 1 and `unversioned` tells the engine to apply the
//    feed by upsert (`status.created`, `status.updated`) and remove
//    (`status.deleted`) on the id, as docs/realtime.md says to.
//  - an archive is a DELETE, and it carries `move_to`: where the tickets that
//    still use the status go. The payload of the archive entry is that.
//  - there is no way to write one status's position. A reorder is one call that
//    names every status of the team, so an update that changes `position` is
//    sent as a reorder of the team's order as the screen has it (the rows of the
//    team, unsent changes included, sorted by position). Several statuses moved
//    by one drag each queue an update; the first reorder already carries the
//    whole new order and the rest find the server where they wanted it.
//  - the create takes no Idempotency-Key. A create whose answer was lost and is
//    retried can therefore make a second status; the next hydration shows both.

type StatusBody = components['schemas']['StatusBody']
type Category = components['schemas']['CreateStatusInputBody']['category']

export function toStatus(body: StatusBody, teamId: string): Status {
    return {
        id: body.id,
        team_id: teamId,
        name: body.name,
        color: body.color,
        position: body.position,
        category: body.category,
        version: 1,
    }
}

export function statusFieldsOf(status: StatusFields): StatusFields {
    return { name: status.name, color: status.color, category: status.category, position: status.position }
}

/** Board order: by position, then name, so equal positions (the server does not
 *  keep them unique) still come out the same way every time. */
export function sortStatuses<S extends Pick<Status, 'position' | 'name' | 'id'>>(statuses: S[]): S[] {
    return statuses.toSorted((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function sameFields(a: StatusFields, b: StatusFields): boolean {
    return a.name === b.name && a.color === b.color && a.category === b.category && a.position === b.position
}

const codec: Codec<Status, StatusConflict> = {
    // The team is not in the body; `send` puts it back.
    row: () => {
        throw new Error('a status answer is read by the entity, which knows the team')
    },
    conflict: () => null,
}

function readStatus(frame: Record<string, unknown>): Status | null {
    const body = frame.status
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (
        !isString(frame.team_id) ||
        !isString(row.id) ||
        !isString(row.name) ||
        !isString(row.color) ||
        !isString(row.category) ||
        typeof row.position !== 'number' ||
        frame.status_id !== row.id
    ) {
        return null
    }
    return toStatus(row as unknown as StatusBody, frame.team_id)
}

// `status.deleted` is the entity's "archived": the row is gone and does not come
// back under the same id.
const EVENTS = { created: 'created', updated: 'updated', deleted: 'archived' } as const

function parseStatusEvent(frame: Record<string, unknown>): RemoteEvent<'status', Status> | null {
    if (!isString(frame.type) || !frame.type.startsWith('status.')) return null
    const type = EVENTS[frame.type.slice('status.'.length) as keyof typeof EVENTS]
    if (!type) return null
    const row = readStatus(frame)
    return row ? { entity: 'status', type, row } : null
}

export const statusEntity: Entity<'status'> = {
    name: 'status',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_status_',
        fieldsOf: statusFieldsOf,
        sameFields,
        fromCreate: (id, payload) => ({ id, ...payload, version: 1 }),
        edit: (base, fields) => ({ ...base, ...fields }),
        // A status cannot be unarchived; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({ ...statusFieldsOf(row), team_id: row.team_id }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        // Statuses ride on the team list; this reads it again rather than
        // sharing the read with `listEverything`, so each entity stays
        // independent of the others.
        async list(api) {
            const teams = await listAll((cursor) =>
                api.POST('/api/v1/teams/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            return teams.flatMap((team) => (team.statuses ?? []).map((status) => toStatus(status, team.id)))
        },

        async send(api, entry, context): Promise<Outcome<Status, StatusConflict>> {
            if (entry.kind === 'unarchive') {
                return { type: 'http', error: { status: 400, code: 'unsupported', errors: [] } }
            }

            // The team: in the create, otherwise on the row the server last sent.
            const known = entry.kind === 'create' ? undefined : await context.server(entry.entity_id)
            const teamId = entry.kind === 'create' ? entry.payload.team_id : known?.team_id
            if (!teamId) return { type: 'http', error: { status: 404, code: 'status_not_found', errors: [] } }
            const path = { id: teamId }

            if (entry.kind === 'create') {
                const { name, color, category, position } = entry.payload
                return answer(
                    entry,
                    () => api.POST('/api/v1/teams/{id}/statuses', { params: { path }, body: { name, color, category: category as Category, position } }),
                    { ...codec, row: (body: StatusBody) => toStatus(body, teamId) },
                )
            }

            if (entry.kind === 'archive') {
                const moveTo = entry.payload.move_to
                return answer(
                    entry,
                    () =>
                        api.DELETE('/api/v1/teams/{id}/statuses/{status_id}', {
                            params: { path: { ...path, status_id: entry.entity_id }, query: moveTo ? { move_to: moveTo } : {} },
                        }),
                    codec,
                )
            }

            // An update: a rename / colour / category change, a reorder, or both.
            const wants = entry.payload
            const was = known ?? (await context.rows()).find((row) => row.id === entry.entity_id)
            const changed = !was || was.name !== wants.name || was.color !== wants.color || was.category !== wants.category
            const moved = !was || was.position !== wants.position
            const read = { ...codec, row: (body: StatusBody) => toStatus(body, teamId) }

            let latest: Outcome<Status, StatusConflict> | null = null
            if (changed) {
                latest = await answer(
                    entry,
                    () =>
                        api.PUT('/api/v1/teams/{id}/statuses/{status_id}', {
                            params: { path: { ...path, status_id: entry.entity_id } },
                            body: { name: wants.name, color: wants.color, category: wants.category as Category },
                        }),
                    read,
                )
                if (latest.type !== 'ok' || !moved) return latest
            }
            if (!moved) return latest ?? { type: 'http', error: { status: 404, code: 'status_not_found', errors: [] } }

            // Statuses this client has not created yet are not the server's to
            // order; their own create carries the position.
            const order = sortStatuses((await context.rows()).filter((row) => row.team_id === teamId))
                .map((row) => row.id)
                .filter((id) => !isTempId(id))
            let result
            try {
                result = await api.POST('/api/v1/teams/{id}/statuses/reorder', {
                    params: { path },
                    body: { status_ids: order },
                })
            } catch {
                return { type: 'network' }
            }
            if (!result.response.ok || !result.data) {
                return { type: 'http', error: toError(result.response, result.error) }
            }
            const mine = (result.data.statuses ?? []).find((status) => status.id === entry.entity_id)
            // Not in the team's answer: someone deleted it meanwhile. `ok` with no
            // row would read as our own delete, so it is said as what it is.
            return mine
                ? { type: 'ok', row: toStatus(mine, teamId) }
                : { type: 'http', error: { status: 404, code: 'status_not_found', errors: [] } }
        },

        parseEvent: parseStatusEvent,
    },
}
