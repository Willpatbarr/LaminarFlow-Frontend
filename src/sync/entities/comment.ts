import type { components } from '@/api/schema'

import { answer, isNullableString, isString, listAll, PAGE_SIZE, type Codec, type RemoteEvent } from '../http'
import type { Comment, CommentFields } from '../types'
import type { Entity } from './entity'

/*
┌─ sync/entities ─────────────────────────────────
│  comments: the tenth entity (LAM-112)
├─ out ───────────────────────────────────────────
│      commentEntity   the registry entry
│      toComment, commentFieldsOf
*/
// How a comment differs from a ticket, and nothing else:
//  - the server keeps NO version: no If-Match, no 409. Rows hold a constant 1
//    and `unversioned` makes the change feed an upsert / remove on the id.
//  - the create takes an `Idempotency-Key`, so a replay after a lost answer
//    returns the comment the first attempt made.
//  - an edit changes `body` only; the target is fixed at creation.
//  - editing and deleting are author-only: a 403 `comment_not_author` parks the
//    entry as failed. A 404 `comment_not_found` (someone deleted it first) does
//    the same. The screens only offer both to the author.
//  - `comment.deleted` is the entity's "archived". A comment on an archived
//    ticket or document is hidden by the server and announced by nothing but
//    the parent's own archive event; the screens read comments through their
//    parent, so the thread goes with it.
//  - the list takes no filter here: every comment the account may see.

type CommentBody = components['schemas']['CommentBody']

export const toComment = (body: CommentBody): Comment => ({
    id: body.id,
    ticket_id: body.ticket_id,
    document_id: body.document_id,
    field_id: body.field_id,
    region_start: body.region_start,
    region_end: body.region_end,
    author_id: body.author_id,
    body: body.body,
    review_status: body.review_status,
    created_at: body.created_at,
    updated_at: body.updated_at,
    version: 1,
})

export const commentFieldsOf = (comment: CommentFields): CommentFields => ({ body: comment.body })

const codec: Codec<Comment, never> = {
    row: toComment,
    conflict: () => null,
}

const isNullableInt = (value: unknown): value is number | null => value === null || Number.isInteger(value)

function readComment(frame: Record<string, unknown>): Comment | null {
    const body = frame.comment
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (
        !isString(row.id) ||
        !isNullableString(row.ticket_id) ||
        !isNullableString(row.document_id) ||
        !isNullableString(row.field_id) ||
        !isNullableString(row.author_id) ||
        !isNullableInt(row.region_start) ||
        !isNullableInt(row.region_end) ||
        !isString(row.body) ||
        !isString(row.created_at) ||
        !isString(row.updated_at)
    ) {
        return null
    }
    // The frame's own id must be the resource's, or something is wrong with it.
    if (frame.comment_id !== row.id) return null
    return toComment({ review_status: null, ...row } as unknown as CommentBody)
}

const EVENTS = { created: 'created', updated: 'updated', deleted: 'archived' } as const

// A review request is a comment with a status (LAM-113), and has two events of
// its own: `review_request.created` and `.updated`, carrying the whole request
// as `review_request` and the request's id as `comment_id`. They are applied to
// the same row a `comment.*` frame would be, so one list serves the thread and
// the review screens. Reviewers and the quoted text are not kept on the row;
// the review feature asks for them (features/review/feed.ts).
function readReviewRequest(frame: Record<string, unknown>): Comment | null {
    const body = frame.review_request
    if (typeof body !== 'object' || body === null) return null
    const row = body as Record<string, unknown>
    if (
        !isString(row.id) ||
        !isString(row.document_id) ||
        !isNullableString(row.field_id) ||
        !isNullableString(row.author_id) ||
        !isNullableInt(row.region_start) ||
        !isNullableInt(row.region_end) ||
        !isString(row.body) ||
        !isString(row.review_status) ||
        !isString(row.created_at) ||
        !isString(row.updated_at) ||
        frame.comment_id !== row.id
    ) {
        return null
    }
    return toComment({ ticket_id: null, ...row } as unknown as CommentBody)
}

function parseCommentEvent(frame: Record<string, unknown>): RemoteEvent<'comment', Comment> | null {
    if (!isString(frame.type)) return null
    if (frame.type === 'review_request.created' || frame.type === 'review_request.updated') {
        const row = readReviewRequest(frame)
        return row ? { entity: 'comment', type: frame.type === 'review_request.created' ? 'created' : 'updated', row } : null
    }
    if (!frame.type.startsWith('comment.')) return null
    const type = EVENTS[frame.type.slice('comment.'.length) as keyof typeof EVENTS]
    if (!type) return null
    const row = readComment(frame)
    return row ? { entity: 'comment', type, row } : null
}

export const commentEntity: Entity<'comment'> = {
    name: 'comment',

    rules: {
        unversioned: true,
        tempPrefix: 'tmp_comment_',
        fieldsOf: commentFieldsOf,
        sameFields: (a, b) => a.body === b.body,
        fromCreate: (id, payload, { at, accountId }) => ({
            id,
            ticket_id: payload.ticket_id,
            document_id: payload.document_id,
            field_id: null,
            region_start: null,
            region_end: null,
            author_id: accountId,
            body: payload.body,
            review_status: null,
            created_at: at,
            updated_at: at,
            version: 1,
        }),
        edit: (base, fields, { at }) => ({ ...base, ...fields, updated_at: at }),
        // A comment cannot be unarchived; the engine never asks.
        restore: (archived) => archived,
        copyOf: (row) => ({ ...commentFieldsOf(row), ticket_id: row.ticket_id, document_id: row.document_id }),
        conflictIsArchive: () => false,
        conflictIsBy: () => true,
    },

    remote: {
        async list(api) {
            const comments = await listAll((cursor) =>
                api.POST('/api/v1/comments/list', { body: { limit: PAGE_SIZE, cursor } }),
            )
            return comments.map(toComment)
        },

        send(api, entry) {
            if (entry.kind === 'unarchive') {
                return Promise.resolve({ type: 'http', error: { status: 400, code: 'unsupported', errors: [] } })
            }
            return answer(
                entry,
                () => {
                    if (entry.kind === 'create') {
                        const { ticket_id, document_id, body } = entry.payload
                        return api.POST('/api/v1/comments', {
                            params: { header: { 'Idempotency-Key': entry.idempotency_key } },
                            // Exactly one parent: the other member is left out, not null.
                            body: ticket_id ? { ticket_id, body } : { document_id, body },
                        })
                    }
                    const params = { path: { id: entry.entity_id } }
                    if (entry.kind === 'update') return api.PUT('/api/v1/comments/{id}', { params, body: { body: entry.payload.body } })
                    return api.DELETE('/api/v1/comments/{id}', { params })
                },
                codec,
            )
        },

        parseEvent: parseCommentEvent,
    },
}
