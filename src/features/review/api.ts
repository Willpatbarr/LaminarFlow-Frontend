import { api } from '@/api/client'
import type { components } from '@/api/schema'
import type { Result } from '@/features/aspects/api'

/*
┌─ review ────────────────────────────────────────
│  the review request calls (LAM-121), each answering a Result instead of throwing
├─ out ───────────────────────────────────────────
│      ReviewRequest · ReviewStatus
│      createReviewRequest(input)       POST /review-requests, safe to retry (Idempotency-Key)
│      listReviewRequests(filter)       every page of POST /review-requests/list
│      decideReviewRequest(id, status)  PUT /review-requests/{id}
│      reviewMessage(code, fallback)    the neutral sentence for a refusal
*/
// Creating and deciding are requests whose answer the screen shows, not outbox
// entries: a review is a question put to other people, so there is nothing to
// show for it until the server has it. The request, once made, is a comment
// and reaches every screen through the comment entity (sync/entities/comment.ts).

export type ReviewRequest = components['schemas']['ReviewRequestBody']
export type ReviewStatus = ReviewRequest['review_status']

type Problem = { code?: string; detail?: string; errors?: { message: string }[] } | undefined

// Said without blame: this is the surface where a refusal is easiest to read as a verdict.
const MESSAGES: Record<string, string> = {
    not_a_reviewer: 'Only the people asked to review can do this.',
    review_request_not_found: 'This review request is no longer there.',
    validation: 'The server could not use that. Check the note and the reviewers and try again.',
}

export function reviewMessage(code: string, fallback: string): string {
    return MESSAGES[code] ?? fallback
}

function failed(error: unknown): { ok: false; code: string; message: string } {
    const problem = typeof error === 'object' && error !== null ? (error as Problem) : undefined
    const code = problem?.code ?? 'unknown'
    const detail = problem?.errors?.[0]?.message ?? problem?.detail ?? 'The server could not do that.'
    return { ok: false, code, message: code === 'validation' && problem?.errors?.[0]?.message ? detail : reviewMessage(code, detail) }
}

const offline = { ok: false, code: 'network', message: 'Could not reach the server. Check the connection and try again.' } as const

export type NewReviewRequest = {
    documentId: string
    /** The aspect field; omitted for a normal document. */
    fieldId: string | null
    /** Code point offsets into the field's stored Markdown. */
    start: number
    end: number
    note: string
    reviewerIds: string[]
    /** One per attempt of the same request, so a retry cannot ask twice. */
    idempotencyKey: string
}

export async function createReviewRequest(input: NewReviewRequest): Promise<Result<ReviewRequest>> {
    try {
        const { data, error } = await api.POST('/api/v1/review-requests', {
            params: { header: { 'Idempotency-Key': input.idempotencyKey } },
            body: {
                document_id: input.documentId,
                ...(input.fieldId ? { field_id: input.fieldId } : {}),
                region_start: input.start,
                region_end: input.end,
                body: input.note,
                reviewer_ids: input.reviewerIds,
            },
        })
        return data ? { ok: true, data } : failed(error)
    } catch {
        return offline
    }
}

export async function listReviewRequests(filter: { documentId?: string; reviewerId?: string }): Promise<Result<ReviewRequest[]>> {
    const conditions = [
        ...(filter.documentId ? [{ field: 'document_id', op: 'eq' as const, value: filter.documentId }] : []),
        ...(filter.reviewerId ? [{ field: 'reviewer_id', op: 'eq' as const, value: filter.reviewerId }] : []),
    ]
    try {
        const found: ReviewRequest[] = []
        let cursor: string | undefined
        for (;;) {
            const { data, error } = await api.POST('/api/v1/review-requests/list', {
                body: { limit: 200, cursor, filter: { op: 'and', conditions } },
            })
            if (!data) return failed(error)
            found.push(...(data.items ?? []))
            if (!data.has_more || !data.next_cursor) return { ok: true, data: found }
            cursor = data.next_cursor
        }
    } catch {
        return offline
    }
}

export async function decideReviewRequest(id: string, status: ReviewStatus): Promise<Result<ReviewRequest>> {
    try {
        const { data, error } = await api.PUT('/api/v1/review-requests/{id}', {
            params: { path: { id } },
            body: { review_status: status },
        })
        return data ? { ok: true, data } : failed(error)
    } catch {
        return offline
    }
}
