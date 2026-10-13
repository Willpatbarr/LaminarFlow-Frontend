import type { components } from './schema'

type ErrorBody = components['schemas']['Error']

/*
┌─ api ───────────────────────────────────────────
│  a failed API call as an RFC 9457 problem document
├─ out ───────────────────────────────────────────
│      ApiProblem    status, code, errors[]
├─ example ───────────────────────────────────────
│      409 {"code":"email_taken"}  →  ApiProblem { status: 409, code: 'email_taken' }
*/
// Callers branch on `code`, never on the prose in `detail` (docs/api-errors.md
// in the backend): the prose is free to be reworded and nothing would fail.
export class ApiProblem extends Error {
    status: number
    code: string
    errors: NonNullable<ErrorBody['errors']>

    constructor(status: number, code: string, errors: ErrorBody['errors'], detail?: string) {
        super(detail ?? code)
        this.name = 'ApiProblem'
        this.status = status
        this.code = code
        this.errors = errors ?? []
    }
}

// openapi-fetch hands back whatever the body parsed to, which is a string when
// the response was not JSON at all (a proxy's 502 page, say). The code then
// falls back to `unknown` so callers still get an ApiProblem to branch on.
export function toProblem(response: Response, body: unknown): ApiProblem {
    const problem = typeof body === 'object' && body !== null ? (body as Partial<ErrorBody>) : {}
    return new ApiProblem(response.status, problem.code ?? 'unknown', problem.errors, problem.detail)
}
