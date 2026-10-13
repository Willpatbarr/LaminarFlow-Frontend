import { ApiProblem } from '@/api/problem'

/*
┌─ auth ──────────────────────────────────────────
│  turns a failed login or register call into text on the right field
├─ out ───────────────────────────────────────────
│      FormErrors    { form?, email?, password?, displayName? }
├─ example ───────────────────────────────────────
│      409 email_taken  →  { email: 'An account with this email already exists.' }
*/
export type AuthField = 'email' | 'password' | 'displayName'

export type FormErrors = Partial<Record<AuthField | 'form', string>>

// The part of an errors[].location after "body." mapped to the field it names.
const FIELD_OF_LOCATION: Record<string, AuthField> = {
    'body.email': 'email',
    'body.password': 'password',
    'body.display_name': 'displayName',
}

// Our wording for the validation failures the schema can raise, because the
// validator's own message is an engineering sentence ("expected string to be
// RFC 5322 email address"). Only fields with a format rule appear; the password
// is checked by code, not by schema.
const MESSAGE_OF_FIELD: Partial<Record<AuthField, string>> = {
    email: 'Enter a valid email address.',
    displayName: 'Enter a name of 1 to 100 characters.',
}

// Branches on `code`, never on prose. Each entry is a rule the backend states
// in docs/api-errors.md.
const MESSAGE_OF_CODE: Record<string, [AuthField, string]> = {
    email_taken: ['email', 'An account with this email already exists.'],
    password_too_short: ['password', 'Use at least 10 characters.'],
    password_too_long: ['password', 'That password is too long. Use 72 bytes or fewer.'],
}

export const GENERIC_FAILURE = 'Something went wrong. Try again.'

export function describeProblem(error: unknown): FormErrors {
    // Not an ApiProblem: fetch itself threw, so the server was never reached.
    if (!(error instanceof ApiProblem)) {
        return { form: 'Could not reach the server. Check your connection and try again.' }
    }

    // One 401 answer for both a wrong email and a wrong password, by design, so
    // it is a claim about the pair and belongs to the form, not to a field.
    if (error.status === 401) {
        return { form: 'That email and password do not match.' }
    }

    const byCode = MESSAGE_OF_CODE[error.code]
    if (byCode) {
        return { [byCode[0]]: byCode[1] }
    }

    const found: FormErrors = {}
    for (const detail of error.errors) {
        const field = detail.location ? FIELD_OF_LOCATION[detail.location] : undefined
        if (field && !found[field]) {
            found[field] = MESSAGE_OF_FIELD[field] ?? detail.message ?? GENERIC_FAILURE
        }
    }
    if (Object.keys(found).length > 0) return found

    return { form: GENERIC_FAILURE }
}
