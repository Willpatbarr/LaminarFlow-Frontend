import { api } from '@/api/client'
import type { components } from '@/api/schema'
import type { Result } from '@/features/aspects/api'

/*
┌─ search ────────────────────────────────────────
│  the search call (LAM-100) behind the command palette (LAM-115)
├─ out ───────────────────────────────────────────
│      SearchItem                      the server's result body
│      MAX_QUERY                       the longest `q` the server takes (200)
│      searchServer(q, signal?)        top results for q, best first, as a Result
*/
// Search is a read, not a sync entity: nothing is stored from it. An empty (or
// only-whitespace) `q` is a 422 on the server, so it is never sent: the answer
// to it is an empty list here.

export type SearchItem = components['schemas']['SearchItem']

export const MAX_QUERY = 200

export async function searchServer(q: string, signal?: AbortSignal): Promise<Result<SearchItem[]>> {
    const text = q.trim().slice(0, MAX_QUERY)
    if (text === '') return { ok: true, data: [] }
    try {
        const { data, error } = await api.POST('/api/v1/search/list', { body: { q: text }, signal })
        if (data !== undefined) return { ok: true, data: data.items ?? [] }
        const problem = typeof error === 'object' && error !== null ? (error as { code?: string; detail?: string }) : undefined
        return { ok: false, code: problem?.code ?? 'unknown', message: problem?.detail ?? 'The search failed.' }
    } catch {
        return { ok: false, code: 'network', message: 'Could not reach the server.' }
    }
}
