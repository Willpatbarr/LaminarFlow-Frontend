import { api } from '@/api/client'
import type { components } from '@/api/schema'
import type { Result } from '@/features/aspects/api'

/*
┌─ links ─────────────────────────────────────────
│  the ticket-document link calls (LAM-111), each answering a Result instead of throwing
├─ out ───────────────────────────────────────────
│      LinkedDocument · LinkedTicket   what each side lists
│      getTicketDocuments(ticketId) · getDocumentTickets(documentId)   the list from either side
│      linkDocument(ticketId, documentId) · unlinkDocument(ticketId, documentId)
*/
// A link is neither a ticket's nor a document's version, so it is not a sync
// entity: the lists are asked for (on opening, on a change-feed event, when the
// tab is shown again) and a write is a request whose answer the screen shows.
// Both writes are idempotent (204 whether or not anything changed).

export type LinkedDocument = components['schemas']['LinkedDocumentBody']
export type LinkedTicket = components['schemas']['LinkedTicketBody']

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

async function read<T>(call: () => Promise<{ data?: T; error?: unknown }>): Promise<Result<T>> {
    try {
        const { data, error } = await call()
        return data !== undefined ? { ok: true, data } : failed(error)
    } catch {
        return offline
    }
}

async function write(call: () => Promise<{ response: Response; error?: unknown }>): Promise<Result<null>> {
    try {
        const { response, error } = await call()
        return response.ok ? { ok: true, data: null } : failed(error)
    } catch {
        return offline
    }
}

export async function getTicketDocuments(ticketId: string): Promise<Result<LinkedDocument[]>> {
    const got = await read(() => api.GET('/api/v1/tickets/{id}', { params: { path: { id: ticketId } } }))
    return got.ok ? { ok: true, data: got.data.documents ?? [] } : got
}

export async function getDocumentTickets(documentId: string): Promise<Result<LinkedTicket[]>> {
    const got = await read(() => api.GET('/api/v1/documents/{id}', { params: { path: { id: documentId } } }))
    return got.ok ? { ok: true, data: got.data.tickets ?? [] } : got
}

export const linkDocument = (ticketId: string, documentId: string) =>
    write(() =>
        api.POST('/api/v1/tickets/{id}/documents', { params: { path: { id: ticketId } }, body: { document_id: documentId } }),
    )

export const unlinkDocument = (ticketId: string, documentId: string) =>
    write(() =>
        api.DELETE('/api/v1/tickets/{id}/documents/{document_id}', {
            params: { path: { id: ticketId, document_id: documentId } },
        }),
    )
