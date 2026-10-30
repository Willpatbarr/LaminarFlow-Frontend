import { listAll, oncePerPass, PAGE_SIZE, type Outcome, type RemoteEvent, type SyncApi } from './http'
import { ENTITIES, entityFor } from './entities'
import type { SendContext } from './entities/entity'
import type { EntityConflicts, EntityName, EntityRows, OutboxEntry, Project, Team } from './types'

/*
┌─ sync ──────────────────────────────────────────
│  the HTTP calls the engine makes, each reduced to an outcome it can switch on
├─ out ───────────────────────────────────────────
│      createRemote   send(entry) → Outcome, listEverything() → ServerState, parseEvent(frame)
│      SyncApi        the typed client it needs (src/api/client.ts in the app)
├─ example ───────────────────────────────────────
│      PUT answered 409 {code:"ticket_conflict", current:{…}}  →  { type: 'conflict', conflict }
*/
// Teams and projects are read-only context and are listed here. Every
// entity that can be written is listed, sent and parsed by its own definition
// in ./entities; this file only dispatches on the entry's `entity`.

export { ListFailure, type EventType, type Outcome, type RemoteEvent, type SyncApi } from './http'
export { parseTicketEvent } from './entities/ticket'

export type ServerState = {
    teams: Team[]
    projects: Project[]
    /** Every live row of every entity, by entity name. */
    rows: { [N in EntityName]: EntityRows[N][] }
}

export type AnyOutcome = { [N in EntityName]: Outcome<EntityRows[N], EntityConflicts[N]> }[EntityName]

export type AnyEvent = { [N in EntityName]: RemoteEvent<N, EntityRows[N]> }[EntityName]

export function createRemote(api: SyncApi) {
    return {
        /** Everything this account can see, every page of it. Throws
         *  `ListFailure` if any page fails: half a list must never be mistaken
         *  for the whole one, because rows missing from it get removed. */
        async listEverything(): Promise<ServerState> {
            // One client for the whole pass, so each shared list is read once.
            const pass = oncePerPass(api)
            const teams = await listAll((cursor) =>
                pass.POST('/api/v1/teams/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const projects = await listAll((cursor) =>
                pass.POST('/api/v1/projects/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            const rows: Record<string, unknown[]> = {}
            for (const entity of ENTITIES) rows[entity.name] = await entity.remote.list(pass)
            return {
                teams: teams.map((team) => ({
                    id: team.id,
                    workspace_id: team.workspace_id,
                    name: team.name,
                })),
                projects: projects.map((project) => ({
                    id: project.id,
                    team_id: project.team_id,
                    name: project.name,
                })),
                rows: rows as ServerState['rows'],
            }
        },

        /** Sends one outbox entry. Never throws: every way it can go is an Outcome. */
        send(entry: OutboxEntry, context: SendContext<any>): Promise<AnyOutcome> {
            return entityFor(entry.entity).remote.send(api, entry as never, context as never) as Promise<AnyOutcome>
        },

        /** One frame of the change feed (`unknown`: it comes off the wire), or
         *  null if no registered entity understands it. */
        parseEvent(frame: unknown): AnyEvent | null {
            if (typeof frame !== 'object' || frame === null) return null
            for (const entity of ENTITIES) {
                const event = entity.remote.parseEvent(frame as Record<string, unknown>)
                if (event) return event as AnyEvent
            }
            return null
        },
    }
}

export type Remote = ReturnType<typeof createRemote>
