import { api } from '@/api/client'
import type { Result } from '@/features/aspects/api'
import type { ActivityEntry } from '@/sync'

/*
┌─ activity ──────────────────────────────────────
│  the activity list call (LAM-114), answering a Result instead of throwing
├─ out ───────────────────────────────────────────
│      ActivityPage                    { items, next } - newest first
│      listActivity(type, id, cursor)  POST /activity/list, one page
*/
// Online-only and read-only: nothing is written and nothing is kept locally.
// A 404 is an entity that is archived or gone (its history is hidden).

export type ActivityPage = { items: ActivityEntry[]; next: string | null }

export const PAGE = 20

export async function listActivity(
    entityType: 'ticket' | 'document',
    entityId: string,
    cursor?: string,
): Promise<Result<ActivityPage>> {
    try {
        const { data, error } = await api.POST('/api/v1/activity/list', {
            body: {
                limit: PAGE,
                cursor,
                filter: {
                    op: 'and',
                    conditions: [
                        { field: 'entity_type', op: 'eq', value: entityType },
                        { field: 'entity_id', op: 'eq', value: entityId },
                    ],
                },
            },
        })
        if (data)
            return {
                ok: true,
                data: {
                    items: data.items ?? [],
                    next: data.has_more ? data.next_cursor : null,
                },
            }
        const code = (error as { code?: string } | undefined)?.code ?? 'unknown'
        return { ok: false, code, message: 'The history could not be loaded.' }
    } catch {
        return {
            ok: false,
            code: 'network',
            message: 'Could not reach the server.',
        }
    }
}
