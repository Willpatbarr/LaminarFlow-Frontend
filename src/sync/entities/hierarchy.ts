import type { components } from '@/api/schema'

import { isNullableString, isString, listAll, PAGE_SIZE, type RemoteEvent, type SyncApi } from '../http'
import type {
    Epic,
    EpicFields,
    Milestone,
    MilestoneFields,
    Sprint,
    SprintFields,
    EntityName,
    EntityRows,
    EntityFields,
} from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  epics, sprints and milestones: read-only entities (LAM-103; labels became writable in LAM-104)
├─ out ───────────────────────────────────────────
│      epicEntity, sprintEntity, milestoneEntity   the registry entries
│      toEpic, toSprint, toMilestone
*/
// The ticket page needs these to fill its pickers and to say what a ticket is
// filed under, offline included, and to follow the change feed. Nothing in the
// app writes them yet (creating and renaming them is LAM-105), so
// they are READ-ONLY entities: they have a list and an event reader, and a
// `send` that refuses, so an entry for one can never reach the server by
// accident. How they differ from a ticket, and nothing else:
//  - the server keeps NO version (no If-Match, no 409, none on a frame), so
//    the rows hold a constant 1 and the feed is an upsert / remove on the id,
//    as docs/realtime.md says ("replace the resource you hold").
//  - `<name>.deleted` is the entity's "archived". Epics and milestones
//    that are deleted also leave their id on tickets; the engine clears it
//    (see `releasedBy` in ../engine.ts).
//  - all three lists take a project and answer one page.

type EpicBody = components['schemas']['EpicBody']
type SprintBody = components['schemas']['SprintBody']
type MilestoneBody = components['schemas']['MilestoneBody']

export const toEpic = (body: EpicBody): Epic => ({
    id: body.id,
    project_id: body.project_id,
    name: body.name,
    description: body.description,
    version: 1,
})
export const toSprint = (body: SprintBody): Sprint => ({
    id: body.id,
    project_id: body.project_id,
    name: body.name,
    start_date: body.start_date,
    end_date: body.end_date,
    version: 1,
})
export const toMilestone = (body: MilestoneBody): Milestone => ({
    id: body.id,
    project_id: body.project_id,
    name: body.name,
    description: body.description,
    target_date: body.target_date,
    version: 1,
})
const EVENTS = { created: 'created', updated: 'updated', deleted: 'archived' } as const

type Reader<Row> = (body: Record<string, unknown>) => Row | null

function parser<N extends EntityName>(name: N, read: Reader<EntityRows[N]>) {
    return (frame: Record<string, unknown>): RemoteEvent<N, EntityRows[N]> | null => {
        if (!isString(frame.type) || !frame.type.startsWith(`${name}.`)) return null
        const type = EVENTS[frame.type.slice(name.length + 1) as keyof typeof EVENTS]
        if (!type) return null
        const body = frame[name]
        if (typeof body !== 'object' || body === null) return null
        const row = read(body as Record<string, unknown>)
        // The frame's own id must be the resource's, or something is wrong with it.
        return row && frame[`${name}_id`] === row.id ? { entity: name, type, row } : null
    }
}

const readEpic: Reader<Epic> = (row) =>
    isString(row.id) && isString(row.project_id) && isString(row.name) && isString(row.description)
        ? toEpic(row as unknown as EpicBody)
        : null
const readSprint: Reader<Sprint> = (row) =>
    isString(row.id) &&
    isString(row.project_id) &&
    isString(row.name) &&
    isNullableString(row.start_date) &&
    isNullableString(row.end_date)
        ? toSprint(row as unknown as SprintBody)
        : null
const readMilestone: Reader<Milestone> = (row) =>
    isString(row.id) &&
    isString(row.project_id) &&
    isString(row.name) &&
    isString(row.description) &&
    isNullableString(row.target_date)
        ? toMilestone(row as unknown as MilestoneBody)
        : null
async function eachProject(api: SyncApi) {
    return listAll((cursor) => api.POST('/api/v1/projects/list', { body: { limit: PAGE_SIZE, cursor } }))
}

const refused = { type: 'http' as const, error: { status: 400, code: 'unsupported', errors: [] } }

// `fieldsOf` and friends exist because the engine asks every entity for them;
// with no way to edit one, they only have to be consistent.
function readOnly<N extends 'epic' | 'sprint' | 'milestone'>(
    name: N,
    fields: (row: EntityRows[N]) => EntityFields[N],
    list: (api: SyncApi) => Promise<EntityRows[N][]>,
    read: Reader<EntityRows[N]>,
): Entity<N> {
    const same = (a: EntityFields[N], b: EntityFields[N]) => JSON.stringify(a) === JSON.stringify(b)
    return {
        name,
        rules: {
            unversioned: true,
            tempPrefix: `tmp_${name}_`,
            fieldsOf: fields,
            sameFields: same,
            fromCreate: (id: string, payload: unknown) => ({ id, ...(payload as object), version: 1 }) as EntityRows[N],
            edit: (base, edited) => ({ ...base, ...edited }),
            restore: (archived) => archived,
            copyOf: (row) => ({ ...fields(row), ...('team_id' in row ? { team_id: row.team_id } : { project_id: (row as Epic).project_id }) }) as never,
            conflictIsArchive: () => false,
            conflictIsBy: () => true,
        },
        remote: {
            list,
            send: async () => refused,
            parseEvent: parser(name, read),
        },
    } as Entity<N>
}

export const epicEntity = readOnly<'epic'>(
    'epic',
    (row): EpicFields => ({ name: row.name, description: row.description }),
    async (api) => {
        const out: Epic[] = []
        for (const project of await eachProject(api)) {
            const listed = await listAll(() => api.POST('/api/v1/epics/list', { body: { project_id: project.id } }))
            out.push(...listed.map(toEpic))
        }
        return out
    },
    readEpic,
)

export const sprintEntity = readOnly<'sprint'>(
    'sprint',
    (row): SprintFields => ({ name: row.name, start_date: row.start_date, end_date: row.end_date }),
    async (api) => {
        const out: Sprint[] = []
        for (const project of await eachProject(api)) {
            const listed = await listAll(() => api.POST('/api/v1/sprints/list', { body: { project_id: project.id } }))
            out.push(...listed.map(toSprint))
        }
        return out
    },
    readSprint,
)

export const milestoneEntity = readOnly<'milestone'>(
    'milestone',
    (row): MilestoneFields => ({ name: row.name, description: row.description, target_date: row.target_date }),
    async (api) => {
        const out: Milestone[] = []
        for (const project of await eachProject(api)) {
            const listed = await listAll(() => api.POST('/api/v1/milestones/list', { body: { project_id: project.id } }))
            out.push(...listed.map(toMilestone))
        }
        return out
    },
    readMilestone,
)
