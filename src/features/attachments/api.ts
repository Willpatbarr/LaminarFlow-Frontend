import { api } from '@/api/client'
import type { components } from '@/api/schema'
import type { Result } from '@/features/aspects/api'

import { MAX_ATTACHMENT_BYTES, oversizeMessage } from './limits'

/*
┌─ attachments ───────────────────────────────────────
│  the attachment calls (LAM-116), each answering a Result instead of throwing
├─ out ───────────────────────────────────────────────
│      Attachment · AttachmentParent   the server's body · whose it is
│      uploadAttachment(parent, file, opts)   multipart upload with progress
│      listAttachments(parent) · deleteAttachment(id)
│      isInlineImage(type) · humanSize(bytes) · attachmentTooLargeMessage(name, limit)
*/
// Attachments are blobs, not a sync entity: nothing is stored on this device
// and nothing is queued. Every call here is online-only, and a failure is
// reported to the screen that asked (an upload that cannot reach the server
// says so; it is never retried behind the user's back).
//
// The upload uses XMLHttpRequest, not fetch, because fetch cannot report how
// much of a request body has been sent. The server needs `ticket_id` or
// `document_id` BEFORE `file` in the form (the owner is checked before a byte
// is stored), so the order of the `append` calls below is part of the contract.

export type Attachment = components['schemas']['AttachmentBody']
export type AttachmentParent = { ticketId: string; documentId?: never } | { documentId: string; ticketId?: never }

export type UploadFailure = { ok: false; code: string; message: string; limitBytes?: number }
export type UploadResult = { ok: true; data: Attachment } | UploadFailure

type Problem = { code?: string; detail?: string; limit_bytes?: number; errors?: { message: string }[] } | undefined

/** Types the server serves inline, so `<img src>` works. */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const isInlineImage = (contentType: string) => INLINE_IMAGES.has(contentType)

export function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    const mb = bytes / (1024 * 1024)
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

// The server's 413 does not say how big the file was, so this form has no size.
export function attachmentTooLargeMessage(name: string, limitBytes: number | undefined): string {
    return limitBytes !== undefined
        ? `${name} is over the limit of ${humanSize(limitBytes)}.`
        : `${name} is too large.`
}

const OFFLINE: UploadFailure = {
    ok: false,
    code: 'network',
    message: 'Could not reach the server. Uploads need a connection: check it and try again.',
}

function isAttachment(body: unknown): body is Attachment {
    return typeof body === 'object' && body !== null && typeof (body as Attachment).url === 'string'
}

function failure(body: unknown, name: string): UploadFailure {
    const problem = (typeof body === 'object' && body !== null ? body : undefined) as Problem
    const code = problem?.code ?? 'unknown'
    if (code === 'attachment_too_large') {
        return { ok: false, code, limitBytes: problem?.limit_bytes, message: attachmentTooLargeMessage(name, problem?.limit_bytes) }
    }
    if (code === 'attachment_type_not_allowed') {
        return { ok: false, code, message: `${name} is a kind of file that cannot be attached (web pages, SVG, scripts, audio and video are refused).` }
    }
    if (code === 'not_found') {
        return { ok: false, code, message: 'This item is gone or you can no longer see it, so nothing was attached.' }
    }
    const detail = problem?.errors?.[0]?.message ?? problem?.detail
    return { ok: false, code, message: detail ? `The server did not accept ${name}: ${detail}` : `The server did not accept ${name}.` }
}

type UploadOptions = {
    /** 0 to 1, as the request body is sent. */
    onProgress?: (fraction: number) => void
    signal?: AbortSignal
    /** Makes a retry after a lost answer safe. A fresh key by default. */
    idempotencyKey?: string
}

export function uploadAttachment(parent: AttachmentParent, file: File, options: UploadOptions = {}): Promise<UploadResult> {
    return new Promise((resolve) => {
        // Over the limit: say so now, before a byte is sent.
        const tooBig = oversizeMessage(file)
        if (tooBig) {
            resolve({ ok: false, code: 'attachment_too_large', limitBytes: MAX_ATTACHMENT_BYTES, message: tooBig })
            return
        }
        const form = new FormData()
        // The owner first, then the file: the server reads the form as a stream.
        if (parent.ticketId !== undefined) form.append('ticket_id', parent.ticketId)
        else form.append('document_id', parent.documentId)
        form.append('file', file, file.name)

        const request = new XMLHttpRequest()
        request.open('POST', '/api/v1/attachments')
        request.withCredentials = true
        request.setRequestHeader('Idempotency-Key', options.idempotencyKey ?? crypto.randomUUID())
        request.setRequestHeader('Accept', 'application/json')
        request.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total))
        }
        request.onerror = () => resolve(OFFLINE)
        request.ontimeout = () => resolve(OFFLINE)
        request.onabort = () => resolve({ ok: false, code: 'aborted', message: `Upload of ${file.name} was cancelled.` })
        request.onload = () => {
            let body: unknown
            try {
                body = JSON.parse(request.responseText)
            } catch {
                body = undefined
            }
            // A stored attachment carries its `url`; a problem document carries a `code`.
            if (isAttachment(body)) {
                options.onProgress?.(1)
                resolve({ ok: true, data: body })
            } else {
                resolve(failure(body, file.name))
            }
        }
        options.signal?.addEventListener('abort', () => request.abort(), { once: true })
        request.send(form)
    })
}

const filterOf = (parent: AttachmentParent) => ({
    op: 'and',
    conditions: [
        parent.ticketId !== undefined
            ? { field: 'ticket_id', op: 'eq', value: parent.ticketId }
            : { field: 'document_id', op: 'eq', value: parent.documentId },
    ],
})

function problemOf(error: unknown): { code: string; message: string } {
    const problem = (typeof error === 'object' && error !== null ? error : undefined) as Problem
    return {
        code: problem?.code ?? 'unknown',
        message: problem?.errors?.[0]?.message ?? problem?.detail ?? 'The server refused this.',
    }
}

/** Every attachment of the ticket or document, oldest first, across pages. */
export async function listAttachments(parent: AttachmentParent): Promise<Result<Attachment[]>> {
    const items: Attachment[] = []
    let cursor: string | undefined
    try {
        for (let page = 0; page < 20; page++) {
            const { data, error } = await api.POST('/api/v1/attachments/list', {
                body: { filter: filterOf(parent), cursor, limit: 100, sort: [{ field: 'created_at', desc: false }] },
            })
            if (!data) return { ok: false, ...problemOf(error) }
            items.push(...(data.items ?? []))
            cursor = data.next_cursor ?? undefined
            if (!cursor) break
        }
        return { ok: true, data: items }
    } catch {
        return { ok: false, code: 'network', message: 'Could not reach the server. Check the connection and try again.' }
    }
}

/** Deleting something already gone is a success: the end state is the one asked for. */
export async function deleteAttachment(id: string): Promise<Result<null>> {
    try {
        const { response, error } = await api.DELETE('/api/v1/attachments/{id}', { params: { path: { id } } })
        if (response.ok) return { ok: true, data: null }
        const problem = problemOf(error)
        return problem.code === 'not_found' ? { ok: true, data: null } : { ok: false, ...problem }
    } catch {
        return { ok: false, code: 'network', message: 'Could not reach the server. Check the connection and try again.' }
    }
}
