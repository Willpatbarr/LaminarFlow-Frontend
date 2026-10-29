import { api } from '@/api/client'

import type { FilterGroup } from './config'

/*
┌─ tickets/listView ──────────────────────────────
│  serverMatches: the list's filter run on the server
├─ out ───────────────────────────────────────────
│      serverMatches, scoped
├─ example ───────────────────────────────────────
│      await serverMatches('p-1', filter)  →  Set { 't-1', 't-7' }   (null when it could not be asked)
*/
// The second half of "run it against the local store first, then the server".
// The list has already answered from the local store; this asks POST
// /tickets/list the same question and hands back the ids it would show. Null
// means "could not be asked" (offline, a refusal, a server error) and the
// caller keeps the local answer: the server is a confirmation, never a
// precondition.

const PAGE = 200
// A project of 10,000 tickets filtered to all of them is the ceiling; past it
// the answer is unknown rather than partial.
const MAX_PAGES = 50

/** The user's filter, narrowed to one project. The project is the list's scope,
 *  not part of the view, so it is added here and never saved with the config. */
export function scoped(projectId: string, filter: FilterGroup): FilterGroup {
    const project = { field: 'project', op: 'eq', value: projectId }
    return filter.op === 'and'
        ? { op: 'and', conditions: [project, ...(filter.conditions ?? [])], groups: filter.groups }
        : { op: 'and', conditions: [project], groups: [filter] }
}

export async function serverMatches(projectId: string, filter: FilterGroup): Promise<Set<string> | null> {
    const ids = new Set<string>()
    let cursor: string | undefined
    try {
        for (let page = 0; page < MAX_PAGES; page++) {
            const { data } = await api.POST('/api/v1/tickets/list', {
                body: {
                    limit: PAGE,
                    cursor,
                    filter: scoped(projectId, filter),
                    // Fixed, so an edit made while the pages are read cannot move a ticket across a boundary.
                    sort: [{ field: 'created_at', desc: false }],
                },
            })
            if (!data) return null
            for (const item of data.items ?? []) ids.add(item.id)
            if (!data.has_more || !data.next_cursor) return ids
            cursor = data.next_cursor
        }
    } catch {
        return null
    }
    return null
}
