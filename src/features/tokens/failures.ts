import { classify } from '@/api/errors'
import { ApiProblem } from '@/api/problem'

/*
┌─ tokens ────────────────────────────────────────
│  a failed token call as text, on the field it is about when it names one
├─ out ───────────────────────────────────────────
│      describeFailure   error  →  { label?, scopes?, form? }
*/
export type TokenFailure = { label?: string; scopes?: string; form?: string }

export function describeFailure(error: unknown): TokenFailure {
    if (!(error instanceof ApiProblem)) {
        return { form: 'Could not reach the server. Check your connection and try again.' }
    }
    // Branch on `code`, never on prose (docs/api-errors.md).
    if (error.code === 'unknown_scope') {
        return { scopes: 'One of those permissions is not recognised. Reload the page and try again.' }
    }
    switch (classify(error)) {
        case 'validation': {
            const found: TokenFailure = {}
            for (const detail of error.errors) {
                if (detail.location === 'body.label') {
                    found.label = 'Enter a name of 1 to 100 characters.'
                } else if (detail.location?.startsWith('body.scopes')) {
                    found.scopes = detail.message ?? 'Choose at least one permission.'
                }
            }
            return Object.keys(found).length > 0 ? found : { form: "The server didn't accept that. Check it and try again." }
        }
        case 'unauthorized':
            return { form: "You've been signed out. Sign in from the banner above, then try again." }
        case 'forbidden':
            return { form: "You don't have permission to manage API tokens." }
        case 'not_found':
            return { form: 'That token is already gone.' }
        case 'network':
            return { form: 'Could not reach the server. Check your connection and try again.' }
        default:
            return { form: 'That did not work. The server had a problem; try again in a moment.' }
    }
}
