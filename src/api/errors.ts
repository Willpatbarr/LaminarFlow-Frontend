/*
┌─ api ───────────────────────────────────────────
│  what kind of failure an answer (or the lack of one) is
├─ out ───────────────────────────────────────────
│      classify      status / ApiProblem / thrown error  →  FailureKind
│      FailureKind   validation · unauthorized · conflict · server · network
│                    and forbidden · not_found · rejected for the rest
│      isTransient   will the same request work later without anyone changing it
├─ example ───────────────────────────────────────
│      { status: 422, code: 'validation_failed' }  →  'validation'
│      new TypeError('Failed to fetch')            →  'network'
*/
// The one place a status code is read. The API callers (session, first-run
// setup, the forms) and the sync engine ask this what a failure means and
// branch on the answer, so "what does a 403 do" is a decision made once.
// `scripts/check-status-branching.mjs` fails the lint if another module starts
// comparing statuses itself.
//
// THE MAPPING
//   network       no response at all: offline, DNS, a dropped connection, or a
//                 thrown error that is not an API answer (status 0)
//   unauthorized  401 - there is no session, or it ended
//   forbidden     403 - signed in, and not allowed
//   not_found     404, 410 - gone, or outside the caller's scope
//   conflict      409, 412 - the request is fine and the state refuses it
//   validation    400, 422 - the server read it and said no; `errors[]` may
//                 name the fields
//   server        5xx, and 408 / 425 / 429 - the server's trouble or its
//                 backpressure, so the same request may work later
//   rejected      any other 4xx (405, 413, 415 ...) - wrong for good, and not
//                 something the user typed
//
// `code` is carried for callers that need to tell two answers of one kind
// apart (409 `email_taken` from 409 `ticket_conflict`); the kind itself comes
// from the status, as docs/api-errors.md in the backend lays out.

export type FailureKind =
    | 'validation'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'server'
    | 'network'
    | 'rejected'

/** Anything with a numeric `status`: an `ApiProblem`, an `EntryError`, a
 *  `Response`, or `{ status }` built by a caller that has only the number. */
export type HasStatus = { status: number }

export function classifyStatus(status: number): FailureKind {
    if (status === 401) return 'unauthorized'
    if (status === 403) return 'forbidden'
    if (status === 404 || status === 410) return 'not_found'
    if (status === 409 || status === 412) return 'conflict'
    if (status === 400 || status === 422) return 'validation'
    if (status >= 500 || status === 408 || status === 425 || status === 429) return 'server'
    // 0 is what an entry records for "no response"; below 100 is not HTTP at
    // all. Success statuses are not failures, and landing here with one means
    // the caller classified the wrong thing, so it is not dressed up as an
    // answer.
    if (status < 400) return 'network'
    return 'rejected'
}

function hasStatus(value: unknown): value is HasStatus {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { status?: unknown }).status === 'number'
    )
}

/** What a failure is. Never throws, whatever it is handed: a thrown `TypeError`
 *  from `fetch`, an `AbortError`, a string - none of those carries an HTTP
 *  answer, so they are all `network`. */
export function classify(failure: unknown): FailureKind {
    return hasStatus(failure) ? classifyStatus(failure.status) : 'network'
}

/** True when sending the identical request again later can succeed. */
export function isTransient(kind: FailureKind): boolean {
    return kind === 'server' || kind === 'network'
}
