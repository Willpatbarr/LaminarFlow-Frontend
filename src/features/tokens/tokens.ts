import { api } from '@/api/client'
import { toProblem } from '@/api/problem'
import type { components } from '@/api/schema'

/*
┌─ tokens ────────────────────────────────────────
│  API tokens (LAM-101): direct calls, online only - no sync entity
├─ out ───────────────────────────────────────────
│      listTokens    POST /auth/tokens/list  →  active tokens, never the secret
│      createToken   POST /auth/tokens       →  the token, with its secret (once)
│      revokeToken   DELETE /auth/tokens/{id}
├─ note ──────────────────────────────────────────
│      The secret is returned by createToken and by nothing else. Callers hold it
│      in component state only: not the store, IndexedDB, localStorage, the URL or a log.
*/
export type Token = components['schemas']['TokenBody']
export type CreatedToken = components['schemas']['CreatedTokenBody']

export async function listTokens(): Promise<Token[]> {
    const { data, error, response } = await api.POST('/api/v1/auth/tokens/list')
    if (error || !data) throw toProblem(response, error)
    return data.tokens
}

// `expires_at` is always null: this screen has no expiry field yet.
export async function createToken(label: string, scopes: string[]): Promise<CreatedToken> {
    const { data, error, response } = await api.POST('/api/v1/auth/tokens', {
        body: { label, scopes, expires_at: null },
    })
    if (error || !data) throw toProblem(response, error)
    return data
}

export async function revokeToken(id: string): Promise<void> {
    const { error, response } = await api.DELETE('/api/v1/auth/tokens/{id}', {
        params: { path: { id } },
    })
    if (error) throw toProblem(response, error)
}
