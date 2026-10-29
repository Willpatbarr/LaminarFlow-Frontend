import { api } from '@/api/client'
import type { components } from '@/api/schema'

/*
┌─ aspects ───────────────────────────────────────
│  the aspect type calls (LAM-98), each answering a Result instead of throwing
├─ out ───────────────────────────────────────────
│      AspectType · AspectField   the server's bodies
│      Result<T>                  { ok: true, data } or { ok: false, code, message }
│      listAspectTypes · getAspectType · createAspectType · renameAspectType
│      addField · renameField · removeField · fieldUsage · reorderFields
*/
// Aspect types are not a sync entity: the server publishes no change for them,
// so there is nothing to keep a local copy current. An edit is a request, and
// the screen shows what the server answered. Field edits are row operations
// (LAM-44); none of them rewrites a document.

export type AspectType = components['schemas']['AspectTypeBody']
export type AspectField = components['schemas']['FieldBody']

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

type Problem = { code?: string; detail?: string; errors?: { message: string }[] } | undefined

function failed(error: unknown): { ok: false; code: string; message: string } {
    const problem = typeof error === 'object' && error !== null ? (error as Problem) : undefined
    return {
        ok: false,
        code: problem?.code ?? 'unknown',
        message: problem?.errors?.[0]?.message ?? problem?.detail ?? 'The server refused this change.',
    }
}

const offline = { ok: false, code: 'network', message: 'Could not reach the server. Check the connection and try again.' } as const

async function settle<T>(call: () => Promise<{ data?: T; error?: unknown }>): Promise<Result<T>> {
    try {
        const { data, error } = await call()
        return data !== undefined ? { ok: true, data } : failed(error)
    } catch {
        return offline
    }
}

export const listAspectTypes = (teamId: string) =>
    settle(() => api.GET('/api/v1/aspect-types', { params: { query: { team_id: teamId } } }))

export const getAspectType = (id: string) => settle(() => api.GET('/api/v1/aspect-types/{id}', { params: { path: { id } } }))

export const createAspectType = (teamId: string, name: string) =>
    settle(() => api.POST('/api/v1/aspect-types', { body: { team_id: teamId, name } }))

export const renameAspectType = (id: string, name: string) =>
    settle(() => api.PUT('/api/v1/aspect-types/{id}', { params: { path: { id } }, body: { name } }))

export const addField = (id: string, label: string) =>
    settle(() => api.POST('/api/v1/aspect-types/{id}/fields', { params: { path: { id } }, body: { label } }))

export const renameField = (id: string, fieldId: string, label: string) =>
    settle(() =>
        api.PUT('/api/v1/aspect-types/{id}/fields/{field_id}', { params: { path: { id, field_id: fieldId } }, body: { label } }),
    )

export async function removeField(id: string, fieldId: string): Promise<Result<null>> {
    try {
        const { response, error } = await api.DELETE('/api/v1/aspect-types/{id}/fields/{field_id}', {
            params: { path: { id, field_id: fieldId } },
        })
        return response.ok ? { ok: true, data: null } : failed(error)
    } catch {
        return offline
    }
}

export const fieldUsage = (id: string, fieldId: string) =>
    settle(() => api.GET('/api/v1/aspect-types/{id}/fields/{field_id}/usage', { params: { path: { id, field_id: fieldId } } }))

export const reorderFields = (id: string, fieldIds: string[]) =>
    settle(() => api.POST('/api/v1/aspect-types/{id}/reorder', { params: { path: { id } }, body: { field_ids: fieldIds } }))
