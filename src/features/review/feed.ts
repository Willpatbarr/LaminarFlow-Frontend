import { createSignal } from 'solid-js'

import { commentsFor, resolveId, sync, type Comment } from '@/sync'

import { listReviewRequests, type ReviewRequest } from './api'

/*
┌─ review ────────────────────────────────────────
│  what the review screens read: which requests are open, and who was asked
├─ out ───────────────────────────────────────────
│      openRequestsFor(documentId)   the document's pending requests, oldest first
│      pendingSignature()            changes whenever the set of pending requests does
│      detailOf(id)                  reviewers and quoted text, once asked for
│      loadDetails(filter)           asks for them; true when the server answered
│      needsMine() · loadNeedsMine(accountId)   requests that name this account
*/
// A review request is a comment with `review_status` (LAM-113), so which ones
// exist, where they point and what state they are in come from the synced
// comment rows, and arrive live. The rows do not carry the reviewers or the
// quoted text; those are asked for from `POST /review-requests/list` and kept
// here, keyed by id (they never change after the request is made).

const [details, setDetails] = createSignal<Record<string, ReviewRequest>>({})
const [mine, setMine] = createSignal<ReviewRequest[]>([])

export const detailOf = (id: string): ReviewRequest | undefined => details()[id]
export const needsMine = mine

function remember(items: ReviewRequest[]) {
    setDetails((known) => ({ ...known, ...Object.fromEntries(items.map((item) => [item.id, item])) }))
}

export const isOpen = (comment: Comment) => comment.review_status === 'pending'

export function openRequestsFor(documentId: string): Comment[] {
    const id = resolveId(documentId)
    return commentsFor(id)
        .filter(isOpen)
        .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
}

/** A string that differs whenever the set of pending requests (or any status) does. */
export function pendingSignature(): string {
    return sync.comments
        .filter((comment) => comment.review_status !== null)
        .map((comment) => `${comment.id}:${comment.review_status}`)
        .toSorted()
        .join(',')
}

export async function loadDetails(filter: { documentId?: string; reviewerId?: string }): Promise<boolean> {
    const got = await listReviewRequests(filter)
    if (!got.ok) return false
    remember(got.data)
    return true
}

export async function loadNeedsMine(accountId: string): Promise<boolean> {
    const got = await listReviewRequests({ reviewerId: accountId })
    if (!got.ok) return false
    remember(got.data)
    setMine(got.data.toSorted((a, b) => b.created_at.localeCompare(a.created_at)))
    return true
}

/** Forgets what was held, for when the account changes. */
export function clearReviewFeed() {
    setDetails({})
    setMine([])
}
