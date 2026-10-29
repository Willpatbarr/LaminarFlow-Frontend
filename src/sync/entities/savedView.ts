import type { components } from '@/api/schema'

import { answer, listAll, PAGE_SIZE, type Codec, type Outcome, type RemoteEvent } from '../http'
import type { SavedView, SavedViewFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  saved views: the ninth entity (LAM-118)
├─ out ───────────────────────────────────────────
│      savedViewEntity   the registry entry
│      toSavedView, savedViewFieldsOf, sameConfig
*/
// A saved view is a team's (or a person's) stored list or board setup. How it
// differs from a ticket, and nothing else:
//  - the server keeps NO version: no If-Match, no 409. Rows hold a constant 1
//    and `unversioned` makes the change feed an upsert / remove on the id.
//  - the server announces NOTHING on the change feed (LAM-86: "no realtime
//    events"), so `parseEvent` reads no frame. A teammate's new shared view, or
//    one of yours from another device, arrives with the next hydration (sign-in,
//    reload, or the "Try again" of a failed load).
//  - the list returns the caller's own private views plus the team's shared
//    ones, per team; this entity lists every team the account has.
//  - editing and deleting are owner-only: a 403 `saved_view_not_owner` parks the
//    entry as failed. The screens only offer them where `canEdit` says so.
//  - the create takes no Idempotency-Key. A name is not unique, so a create whose
//    answer was lost and is sent again would make a second view; this is the
//    one duplicate the entity cannot prevent.

type SavedViewBody = components['schemas']['SavedViewBody']

export const toSavedView = (body: SavedViewBody): SavedView => ({
    id: body.id,
    team_id: body.team_id,
    project_id: body.project_id,
    board_id: body.board_id,
    layout: body.layout,
    name: body.name,
    is_shared: body.is_shared,
    owner_account_id: body.owner_account_id,
    config: body.config,
    version: 1,
})

export const savedViewFieldsOf = (view: SavedViewFields): SavedViewFields => ({
    name: view.name,
    is_shared: view.is_shared,
    config: view.config,
})

/** Key order is not a difference: the server stores `config` as jsonb, which
 *  does not keep it. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
            .join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
}

export const sameConfig = (a: SavedViewFields['config'], b: SavedViewFields['config']) => canonical(a) === canonical(b)

const codec: Codec<SavedView, never> = { row: toSavedView, conflict: () => null }

// Nothing to read: see the header.
const parseSavedViewEvent = (): RemoteEvent<'saved_view', SavedView> | null => null

export const savedViewEntity: Entity<'saved_view'> = {
    name: 'saved_view',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_saved_view_',
        fieldsOf: savedViewFieldsOf,
        sameFields: (a, b) => a.name === b.name && a.is_shared === b.is_shared && sameConfig(a.config, b.config),
        fromCreate: (id, payload, stamp) => ({ id, ...payload, owner_account_id: stamp.accountId, version: 1 }),
        edit: (base, fields) => ({ ...base, ...savedViewFieldsOf(fields) }),
        // A saved view cannot be unarchived; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({
            ...savedViewFieldsOf(row),
            team_id: row.team_id,
            project_id: row.project_id,
            board_id: row.board_id,
            layout: row.layout,
        }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        async list(api) {
            const teams = await listAll((cursor) =>
                api.POST('/api/v1/teams/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const out: SavedView[] = []
            for (const team of teams) {
                const listed = await listAll((cursor) =>
                    api.POST('/api/v1/saved-views/list', { body: { team_id: team.id, limit: PAGE_SIZE, cursor } }),
                )
                out.push(...listed.map(toSavedView))
            }
            return out
        },

        async send(api, entry): Promise<Outcome<SavedView, never>> {
            if (entry.kind === 'unarchive') {
                return { type: 'http', error: { status: 400, code: 'unsupported', errors: [] } }
            }
            if (entry.kind === 'create') {
                const { team_id, project_id, board_id, layout, name, is_shared, config } = entry.payload
                return answer(
                    entry,
                    () =>
                        api.POST('/api/v1/saved-views', {
                            body: {
                                team_id,
                                layout,
                                name,
                                is_shared,
                                config,
                                ...(project_id ? { project_id } : {}),
                                ...(board_id ? { board_id } : {}),
                            },
                        }),
                    codec,
                )
            }
            const path = { id: entry.entity_id }
            if (entry.kind === 'archive') {
                return answer(entry, () => api.DELETE('/api/v1/saved-views/{id}', { params: { path } }), codec)
            }
            const { name, is_shared, config } = entry.payload
            return answer(
                entry,
                () => api.PUT('/api/v1/saved-views/{id}', { params: { path }, body: { name, is_shared, config } }),
                codec,
            )
        },

        parseEvent: parseSavedViewEvent,
    },
}
